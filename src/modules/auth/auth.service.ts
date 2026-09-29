import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Keypair, StrKey, Account, Operation, TransactionBuilder, Transaction, BASE_FEE } from 'stellar-sdk';
import { SupabaseService } from '../../database/supabase.client';
import { UsersRepository, UploadedAvatarFile } from '../../database/repositories/users.repository';
import { NonceResponseDto } from './dto/nonce-response.dto';
import { VerifyRequestDto } from './dto/verify-request.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import { AuditService } from '../admin/audit.service';
import {
  ACCESS_TOKEN_EXPIRATION,
  ACCESS_TOKEN_EXPIRATION_SECONDS,
  REFRESH_TOKEN_EXPIRATION,
  REFRESH_TOKEN_EXPIRATION_MS,
} from '../../config/jwt.config';

const NONCE_EXPIRATION_SECONDS = 300;

const SEP_53_PREFIX = 'Stellar Signed Message:\n';
const CHALLENGE_VERSION = '1.0.0';
const CHALLENGE_STATEMENT =
  'StepFi requests that you sign this message to authenticate your wallet. ' +
  'This message does not trigger any blockchain transaction.';
const DEFAULT_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
export const LEGACY_RAW_SIGNATURES_SUNSET = '2026-10-31';

// Name of the single manageData operation carried by the SEP-10-style
// challenge transaction. Its value binds the transaction to the nonce row's
// stored challenge hash, so a signed challenge can only ever authenticate the
// exact nonce it was issued for.
const CHALLENGE_DATA_NAME = 'stepfi_auth_challenge';

interface StoredNonce {
  id: string;
  expires_at: string;
  issued_at: string | null;
  message_hash: string | null;
}

interface ChallengeEnvelope {
  domain: string;
  address: string;
  uri: string;
  version: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
  networkPassphrase: string;
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === '') return defaultValue;
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}

interface RefreshTokenPayload {
  type?: string;
  wallet?: string;
  fam?: string;
}

export interface RegisterResponse extends AuthResponseDto {
  user: {
    id: string;
    walletAddress: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    createdAt: string;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly challengeDomain: string;
  private readonly challengeUri: string;
  private readonly networkPassphrase: string;
  private readonly allowLegacyRawSignatures: boolean;
  private readonly legacySignaturesSunset: Date;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersRepository: UsersRepository,
    private readonly auditService: AuditService,
  ) {
    const apiUrl = (this.configService.get<string>('API_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
    const apiPrefix = this.configService.get<string>('API_PREFIX') ?? 'api/v1';
    this.challengeDomain = this.configService.get<string>('AUTH_CHALLENGE_DOMAIN') ?? this.resolveHost(apiUrl);
    this.challengeUri = `${apiUrl}/${apiPrefix}/auth/verify`;
    this.networkPassphrase =
      this.configService.get<string>('STELLAR_NETWORK_PASSPHRASE') ?? DEFAULT_NETWORK_PASSPHRASE;
    this.allowLegacyRawSignatures = parseBooleanEnv(
      this.configService.get<string>('AUTH_ALLOW_LEGACY_RAW_SIGNATURES'),
      true,
    );
    this.legacySignaturesSunset = this.resolveLegacySunset(
      this.configService.get<string>('AUTH_LEGACY_SIGNATURES_SUNSET'),
    );
  }

  async register(dto: RegisterRequestDto, profileImage?: UploadedAvatarFile): Promise<RegisterResponse> {
    let avatarUrl: string | null = null;
    let createdUserId: string | null = null;
    try {
      if (profileImage) {
        avatarUrl = await this.usersRepository.uploadAvatar(dto.walletAddress, profileImage);
      }
      const user = await this.usersRepository.createProfile({
        wallet: dto.walletAddress,
        username: dto.username,
        displayName: dto.displayName,
        avatarUrl,
      });
      createdUserId = user.id;

      const tokens = await this.generateTokens(dto.walletAddress);

      return {
        user: {
          id: user.id,
          walletAddress: user.wallet_address,
          username: user.username,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
          createdAt: user.created_at,
        },
        ...tokens,
      };
    } catch (error) {
      if (avatarUrl) {
        await this.usersRepository.deleteAvatar(avatarUrl).catch(() => {});
      }
      if (createdUserId) {
        await this.usersRepository.deleteUserById(createdUserId).catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Issues a single-use nonce together with the canonical, domain-bound
   * challenge message the wallet must sign. A SHA-256 digest of the exact
   * message is stored on the nonce row so verification can only ever run
   * against that message — never against client-supplied alternatives.
   */
  async generateNonce(wallet: string): Promise<NonceResponseDto> {
    const nonce = randomBytes(32).toString('hex');
    const issuedAt = new Date();
    const expiresAt = new Date(Date.now() + NONCE_EXPIRATION_SECONDS * 1000);
    const message = this.buildChallengeMessage({ wallet, nonce, issuedAt, expiresAt });
    const messageHash = createHash('sha256').update(message, 'utf8').digest('hex');
    const challengeXdr = this.buildChallengeTransaction({ wallet, issuedAt, expiresAt, messageHash });
    const client = this.supabaseService.getServiceRoleClient();
    const { error } = await client.from('nonces').insert({
      wallet_address: wallet,
      nonce,
      expires_at: expiresAt.toISOString(),
      issued_at: issuedAt.toISOString(),
      message_hash: messageHash,
    });
    if (error) {
      throw new InternalServerErrorException({ code: 'DATABASE_NONCE_INSERT_FAILED', message: 'Failed to generate nonce.' });
    }
    return { nonce, expiresAt: expiresAt.toISOString(), message, challengeXdr };
  }

  /**
   * Verifies the wallet signature and marks the nonce used.
   *
   * Security model (issue #118): the server never tries multiple message
   * formats. Exactly one scheme is used per request, selected by
   * `signatureType`, and every canonical scheme verifies the signature
   * against the exact message bound to the nonce row (SHA-256 digest stored
   * at issue time) plus strict domain/URI/network/expiry validation.
   */
  async verifySignature(dto: VerifyRequestDto): Promise<void> {
    const client = this.supabaseService.getServiceRoleClient();
    const { data: nonceRecord, error: nonceError } = await client
      .from('nonces')
      .select('id, expires_at, issued_at, message_hash')
      .eq('wallet_address', dto.wallet)
      .eq('nonce', dto.nonce)
      .is('used_at', null)
      .single();
    if (nonceError || !nonceRecord) {
      throw new UnauthorizedException({ code: 'AUTH_NONCE_NOT_FOUND', message: 'Nonce not found or already used.' });
    }

    // Atomic nonce claim: consume the row BEFORE expensive signature verification.
    // The conditional UPDATE ... WHERE id = ? AND used_at IS NULL is a single
    // atomic statement in Postgres. Two concurrent verify requests that both
    // observed the same unused row above will race here; only one UPDATE will
    // affect a row (count === 1). The loser gets count === 0 / empty data and
    // is rejected as already consumed. This eliminates the TOCTOU window that
    // previously existed between the SELECT and the trailing UPDATE.
    //
    // SECURITY TRADEOFF: if signature verification subsequently fails (or the
    // nonce is expired), the nonce stays burned. Callers must request a fresh
    // nonce and re-sign. This converts a replay of a stolen nonce+signature
    // into a DoS-on-self (one wasted challenge) which is the correct tradeoff
    // versus allowing unlimited session creation from a single intercepted pair.
    const claimedAt = new Date().toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase builder count typings for update().select() chain are incomplete; need runtime count check
    const claimResult: any = await (client.from('nonces') as any)
      .update({ used_at: claimedAt }, { count: 'exact' })
      .eq('id', (nonceRecord as { id: string }).id)
      .is('used_at', null)
      .select('id');
    const claimError = claimResult?.error as { message: string } | null | undefined;
    const claimData = claimResult?.data as unknown[] | null | undefined;
    const claimCount = claimResult?.count as number | null | undefined;
    if (claimError) {
      throw new InternalServerErrorException({
        code: 'DATABASE_NONCE_CLAIM_FAILED',
        message: 'Failed to claim nonce.',
      });
    }
    const claimedCount = typeof claimCount === 'number' ? claimCount : (claimData?.length ?? 0);
    if (claimedCount === 0) {
      throw new UnauthorizedException({ code: 'AUTH_NONCE_NOT_FOUND', message: 'Nonce not found or already used.' });
    }

    // Nonce is now burned regardless of outcome below. Check expiry AFTER the
    // claim so an expired row is still consumed and cannot be retried.
    if (new Date((nonceRecord as { expires_at: string }).expires_at) < new Date()) {
      throw new UnauthorizedException({ code: 'AUTH_NONCE_EXPIRED', message: 'Nonce has expired.' });
    }

    if (!StrKey.isValidEd25519PublicKey(dto.wallet)) {
      throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
    }
    try {
      const keypair = Keypair.fromPublicKey(dto.wallet);
      // The DTO default ('raw') is applied by the validation layer; the
      // service treats an absent value the same way for direct callers.
      const signatureType = dto.signatureType ?? 'raw';

      if (signatureType === 'sep0010') {
        // SEP-10-style scheme: the wallet signs a server-issued challenge
        // TRANSACTION (not a message), so wallets that only expose
        // stellar_signXDR (e.g. mobile Lobstr over WalletConnect) can still
        // authenticate. The signature is carried inside the signed XDR.
        this.verifySep0010Challenge(dto, nonceRecord as StoredNonce, keypair);
        return;
      }

      if (!dto.signature) {
        throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
      }
      const signatureBuffer = Buffer.from(dto.signature, 'base64');

      if (signatureType === 'raw') {
        // Legacy mobile scheme: signature over the bare nonce hex bytes.
        // Deprecated — no domain binding, gated behind a config flag.
        this.verifyLegacyRawSignature(keypair, dto.nonce, signatureBuffer);
      } else {
        const message = this.resolveChallengeMessage(dto, nonceRecord);
        this.assertChallengeBinding(message, nonceRecord, dto);

        if (signatureType === 'sep0043') {
          // Browser wallets (SEP-53): signature over SHA-256 of
          // "Stellar Signed Message:\n" + envelope.
          const digest = createHash('sha256').update(SEP_53_PREFIX + message, 'utf8').digest();
          if (!keypair.verify(digest, signatureBuffer)) {
            throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
          }
        } else {
          // Native clients: raw Ed25519 over the envelope UTF-8 bytes.
          if (!keypair.verify(Buffer.from(message, 'utf8'), signatureBuffer)) {
            throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
          }
        }
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
    }
  }

  /**
   * Builds the SEP-10-style challenge transaction the wallet must sign.
   *
   * Deviation from strict SEP-10: the transaction is server-ISSUED but not
   * server-SIGNED, and its source is the user's own wallet with sequence 0
   * (built on an Account seeded at "-1"). We do not run a server signing key;
   * forgery/replay is instead prevented by the single-use nonce row, the
   * stored `message_hash` binding carried in the manageData value, and the
   * transaction timebounds. A `.build()`ed transaction with a source account
   * of sequence 0 can never be submitted to the network, so this is a pure
   * authentication artifact.
   */
  private buildChallengeTransaction(opts: {
    wallet: string;
    issuedAt: Date;
    expiresAt: Date;
    messageHash: string;
  }): string {
    // Account seeded at "-1" so the first (and only) built transaction has
    // sequence 0 — asserted on verification.
    const account = new Account(opts.wallet, '-1');
    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
      timebounds: {
        minTime: Math.floor(opts.issuedAt.getTime() / 1000),
        maxTime: Math.floor(opts.expiresAt.getTime() / 1000),
      },
    })
      .addOperation(
        Operation.manageData({
          name: CHALLENGE_DATA_NAME,
          value: Buffer.from(opts.messageHash, 'hex'),
        }),
      )
      .build();
    return transaction.toXDR();
  }

  /**
   * Verifies a signed SEP-10-style challenge transaction. Asserts the parsed
   * transaction is exactly the challenge we issued for this nonce — same
   * source wallet, sequence 0, a single `manageData` op whose value equals the
   * stored challenge hash, valid (non-expired) timebounds — and that it carries
   * a valid signature from the wallet over the transaction hash. The network
   * passphrase is bound implicitly: the signature is over `tx.hash()`, which
   * only matches when the client signed for this exact network.
   */
  private verifySep0010Challenge(dto: VerifyRequestDto, stored: StoredNonce, keypair: Keypair): void {
    if (!dto.signedXdr) {
      throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
    }
    if (!stored.message_hash) {
      throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
    }

    let transaction: Transaction;
    try {
      transaction = new Transaction(dto.signedXdr, this.networkPassphrase);
    } catch {
      throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
    }

    if (transaction.source !== dto.wallet || transaction.sequence !== '0') {
      throw new UnauthorizedException({
        code: 'AUTH_CHALLENGE_MISMATCH',
        message: 'Signed transaction does not match the issued challenge.',
      });
    }

    if (transaction.operations.length !== 1) {
      throw new UnauthorizedException({
        code: 'AUTH_CHALLENGE_MISMATCH',
        message: 'Signed transaction does not match the issued challenge.',
      });
    }
    const [operation] = transaction.operations;
    if (operation.type !== 'manageData' || operation.name !== CHALLENGE_DATA_NAME) {
      throw new UnauthorizedException({
        code: 'AUTH_CHALLENGE_MISMATCH',
        message: 'Signed transaction does not match the issued challenge.',
      });
    }
    const value = operation.value;
    if (!value || Buffer.from(value).toString('hex') !== stored.message_hash) {
      throw new UnauthorizedException({
        code: 'AUTH_CHALLENGE_MISMATCH',
        message: 'Signed transaction does not match the issued challenge.',
      });
    }

    const timeBounds = transaction.timeBounds;
    if (!timeBounds || Number(timeBounds.maxTime) * 1000 <= Date.now()) {
      throw new UnauthorizedException({ code: 'AUTH_NONCE_EXPIRED', message: 'Challenge has expired.' });
    }

    const hash = transaction.hash();
    const signed = transaction.signatures.some((sig) => {
      try {
        return keypair.verify(hash, sig.signature());
      } catch {
        return false;
      }
    });
    if (!signed) {
      throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
    }
  }

  /**
   * Resolves the exact bytes to verify the signature against. Prefers the
   * message the client echoes back (must still hash-match the stored
   * challenge); falls back to reconstructing the canonical message from the
   * stored nonce row.
   */
  private resolveChallengeMessage(dto: VerifyRequestDto, stored: StoredNonce): string {
    if (dto.message) {
      return dto.message;
    }
    if (!stored.issued_at || !stored.message_hash) {
      throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
    }
    return this.buildChallengeMessage({
      wallet: dto.wallet,
      nonce: dto.nonce,
      issuedAt: new Date(stored.issued_at),
      expiresAt: new Date(stored.expires_at),
    });
  }

  /**
   * Enforces that the message being verified is exactly the challenge bound
   * to the nonce row (stored SHA-256 digest) and that its envelope matches
   * this environment and is not expired.
   */
  private assertChallengeBinding(message: string, stored: StoredNonce, dto: VerifyRequestDto): void {
    if (!stored.message_hash) {
      throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
    }
    const messageHash = createHash('sha256').update(message, 'utf8').digest('hex');
    if (messageHash !== stored.message_hash) {
      throw new UnauthorizedException({
        code: 'AUTH_CHALLENGE_MISMATCH',
        message: 'Signed message does not match the issued challenge.',
      });
    }

    const envelope = this.parseChallengeEnvelope(message);

    if (envelope.domain !== this.challengeDomain) {
      throw new UnauthorizedException({
        code: 'AUTH_CHALLENGE_DOMAIN_MISMATCH',
        message: 'Challenge domain does not match this environment.',
      });
    }
    if (envelope.uri !== this.challengeUri) {
      throw new UnauthorizedException({
        code: 'AUTH_CHALLENGE_URI_MISMATCH',
        message: 'Challenge URI does not match this environment.',
      });
    }
    if (envelope.networkPassphrase !== this.networkPassphrase) {
      throw new UnauthorizedException({
        code: 'AUTH_CHALLENGE_NETWORK_MISMATCH',
        message: 'Challenge network does not match this environment.',
      });
    }
    if (envelope.address !== dto.wallet || envelope.nonce !== dto.nonce || envelope.version !== CHALLENGE_VERSION) {
      throw new UnauthorizedException({
        code: 'AUTH_CHALLENGE_MISMATCH',
        message: 'Signed message does not match the issued challenge.',
      });
    }
    const expirationTime = Date.parse(envelope.expirationTime);
    if (Number.isNaN(expirationTime) || expirationTime <= Date.now()) {
      throw new UnauthorizedException({ code: 'AUTH_NONCE_EXPIRED', message: 'Challenge has expired.' });
    }
  }

  /**
   * Legacy verification: raw Ed25519 over the nonce hex bytes. No domain
   * binding — accepted only while AUTH_ALLOW_LEGACY_RAW_SIGNATURES is
   * enabled AND the runtime-enforced sunset (legacySignaturesSunset) has not
   * passed. The sunset check runs before any signature verification, so the
   * replayable scheme closes automatically on LEGACY_RAW_SIGNATURES_SUNSET
   * even if an operator never flips the flag (issue #118).
   */
  private verifyLegacyRawSignature(keypair: Keypair, nonce: string, signatureBuffer: Buffer): void {
    if (!this.allowLegacyRawSignatures) {
      throw new UnauthorizedException({
        code: 'AUTH_LEGACY_SIGNATURE_DISABLED',
        message:
          'Legacy raw nonce signatures are no longer accepted. ' +
          'Please sign the canonical challenge message returned by POST /auth/nonce.',
      });
    }
    if (Date.now() >= this.legacySignaturesSunset.getTime()) {
      this.logger.warn(
        `Rejecting legacy raw nonce signature: the migration window closed on ` +
          `${LEGACY_RAW_SIGNATURES_SUNSET}. AUTH_ALLOW_LEGACY_RAW_SIGNATURES is still enabled but ` +
          'the scheme is hard-disabled; flip the flag to false to silence this warning.',
      );
      throw new UnauthorizedException({
        code: 'AUTH_LEGACY_SIGNATURE_DISABLED',
        message:
          `Legacy raw nonce signatures were disabled on ${LEGACY_RAW_SIGNATURES_SUNSET}. ` +
          'Please sign the canonical challenge message returned by POST /auth/nonce.',
      });
    }
    this.logger.warn(
      `Legacy raw nonce signature accepted — AUTH_ALLOW_LEGACY_RAW_SIGNATURES is still enabled. ` +
        `The scheme is hard-disabled at runtime after ${LEGACY_RAW_SIGNATURES_SUNSET}.`,
    );
    if (!keypair.verify(Buffer.from(nonce), signatureBuffer)) {
      throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
    }
  }

  /**
   * Resolves the legacy signature sunset as a UTC Date. Falls back to
   * LEGACY_RAW_SIGNATURES_SUNSET when the env var is unset or malformed, so
   * a bad value can never silently disable the cutoff.
   */
  private resolveLegacySunset(raw: string | undefined): Date {
    if (raw !== undefined && raw.trim() !== '') {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
      this.logger.warn(
        `Ignoring invalid AUTH_LEGACY_SIGNATURES_SUNSET="${raw}"; falling back to ${LEGACY_RAW_SIGNATURES_SUNSET}.`,
      );
    }
    return new Date(`${LEGACY_RAW_SIGNATURES_SUNSET}T00:00:00.000Z`);
  }

  /**
   * Builds the canonical StepFi challenge envelope. Deterministic: fixed key
   * order and 2-space indentation, so the server can reproduce the exact
   * bytes it issued (and clients sign exactly what they received).
   */
  private buildChallengeMessage(opts: { wallet: string; nonce: string; issuedAt: Date; expiresAt: Date }): string {
    const envelope = {
      domain: this.challengeDomain,
      address: opts.wallet,
      statement: CHALLENGE_STATEMENT,
      uri: this.challengeUri,
      version: CHALLENGE_VERSION,
      nonce: opts.nonce,
      issuedAt: opts.issuedAt.toISOString(),
      expirationTime: opts.expiresAt.toISOString(),
      networkPassphrase: this.networkPassphrase,
    };
    return JSON.stringify(envelope, null, 2);
  }

  /** Strictly parses the challenge envelope, rejecting malformed messages. */
  private parseChallengeEnvelope(message: string): ChallengeEnvelope {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
    }
    const obj = parsed as Record<string, unknown>;
    const { domain, address, uri, version, nonce, issuedAt, expirationTime, networkPassphrase } = obj;
    if (
      typeof domain !== 'string' ||
      typeof address !== 'string' ||
      typeof uri !== 'string' ||
      typeof version !== 'string' ||
      typeof nonce !== 'string' ||
      typeof issuedAt !== 'string' ||
      typeof expirationTime !== 'string' ||
      typeof networkPassphrase !== 'string'
    ) {
      throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
    }
    return { domain, address, uri, version, nonce, issuedAt, expirationTime, networkPassphrase };
  }

  /** Extracts the host from an API URL, tolerating bare hosts. */
  private resolveHost(apiUrl: string): string {
    try {
      return new URL(apiUrl).host;
    } catch {
      return apiUrl.split('/')[0] || 'localhost';
    }
  }

  private async findOrCreateUser(wallet: string): Promise<{ id: string; role: string | null }> {
    const client = this.supabaseService.getServiceRoleClient();
    const { data: user, error } = await client
      .from('users')
      .upsert({ wallet_address: wallet, last_seen_at: new Date().toISOString() }, { onConflict: 'wallet_address' })
      .select('id, status, role')
      .single();
    if (error || !user) {
      throw new InternalServerErrorException({ code: 'DATABASE_USER_UPSERT_FAILED', message: 'Failed to create or update user.' });
    }
    if (user.status === 'blocked') {
      throw new UnauthorizedException({ code: 'AUTH_USER_BLOCKED', message: 'This account has been suspended.' });
    }
    const { data: profile } = await client
      .from('learner_profiles')
      .select('id')
      .eq('wallet_address', wallet)
      .maybeSingle();
    if (!profile) {
      await client.from('learner_profiles').insert({
        wallet_address: wallet,
      });
    }
    return { id: user.id, role: user.role ?? null };
  }

  async generateTokens(wallet: string, familyId?: string): Promise<AuthResponseDto> {
    const { id: userId, role } = await this.findOrCreateUser(wallet);
    const client = this.supabaseService.getServiceRoleClient();
    // Role is read fresh from the users table on every token generation,
    // so POST /auth/refresh naturally mints a token with the latest role.
    const accessToken = this.jwtService.sign(
      { wallet, type: 'access', role },
      { secret: this.configService.get<string>('JWT_SECRET'), expiresIn: ACCESS_TOKEN_EXPIRATION },
    );
    // All tokens minted from one login (or any of its refreshes) share a
    // family id, enabling theft containment when a rotated token is replayed.
    const sessionFamilyId = familyId ?? randomUUID();
    const refreshToken = this.jwtService.sign(
      { wallet, type: 'refresh', fam: sessionFamilyId },
      { secret: this.configService.get<string>('JWT_REFRESH_SECRET'), expiresIn: REFRESH_TOKEN_EXPIRATION },
    );
    const refreshTokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRATION_MS);
    const { error: sessionError } = await client.from('sessions').insert({
      user_id: userId,
      refresh_token_hash: refreshTokenHash,
      family_id: sessionFamilyId,
      expires_at: refreshExpiresAt.toISOString(),
    });
    if (sessionError) {
      throw new InternalServerErrorException({ code: 'DATABASE_SESSION_CREATE_FAILED', message: 'Failed to create session.' });
    }
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_EXPIRATION_SECONDS, tokenType: 'Bearer' };
  }

  async refreshTokens(refreshToken: string): Promise<AuthResponseDto> {
    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({ code: 'AUTH_REFRESH_TOKEN_INVALID', message: 'Refresh token is invalid or expired.' });
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException({ code: 'AUTH_REFRESH_TOKEN_INVALID', message: 'Invalid token type.' });
    }
    const client = this.supabaseService.getServiceRoleClient();
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const { data: session, error } = await client
      .from('sessions')
      .select('id, family_id, expires_at')
      .eq('refresh_token_hash', tokenHash)
      .single();
    if (error || !session) {
      await this.handleRefreshReplay(payload);
      // Tokens minted before session families existed fall back to the
      // original error so legacy clients see a stable response shape.
      if (payload.fam) {
        throw new UnauthorizedException({
          code: 'AUTH_REFRESH_TOKEN_REUSED',
          message: 'Refresh token reuse detected. All sessions have been revoked. Please sign in again.',
        });
      }
      throw new UnauthorizedException({ code: 'AUTH_SESSION_NOT_FOUND', message: 'Session not found. Please sign in again.' });
    }
    if (new Date(session.expires_at) < new Date()) {
      throw new UnauthorizedException({ code: 'AUTH_SESSION_EXPIRED', message: 'Session expired. Please sign in again.' });
    }
    await client.from('sessions').delete().eq('id', session.id);
    return this.generateTokens(payload.wallet as string, session.family_id);
  }

  /**
   * A validly-signed refresh token whose session row no longer exists means
   * the token was already rotated — i.e. it is being replayed, most likely
   * by an attacker who stole it. Contain the compromise by revoking every
   * session in the family and recording a security audit event.
   */
  private async handleRefreshReplay(payload: RefreshTokenPayload): Promise<void> {
    const familyId = payload.fam;
    const wallet = payload.wallet ?? 'unknown';
    this.logger.error(`Refresh token replay detected for wallet ${wallet}${familyId ? ` (family ${familyId})` : ''}`);
    if (!familyId) {
      // Legacy token minted before families existed — nothing to revoke.
      return;
    }
    const client = this.supabaseService.getServiceRoleClient();
    const { error: revokeError, count } = await client
      .from('sessions')
      .delete({ count: 'exact' })
      .eq('family_id', familyId);
    if (revokeError) {
      this.logger.error(`Failed to revoke session family ${familyId}: ${revokeError.message}`);
    } else {
      this.logger.error(`Revoked ${count ?? 0} session(s) in family ${familyId} after refresh-token replay`);
    }
    try {
      await this.auditService.logWithBeforeAfter({
        actorWallet: wallet,
        action: 'auth.refresh_token_reuse',
        resource: 'session',
        resourceId: null,
        beforeState: null,
        afterState: { revoked_sessions: count ?? 0 },
        metadata: { family_id: familyId },
      });
    } catch (auditError) {
      this.logger.error('Failed to write refresh-token-reuse audit log', auditError);
    }
  }
}
