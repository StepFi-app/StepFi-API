import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { Keypair, StrKey } from 'stellar-sdk';
import { SupabaseService } from '../../database/supabase.client';
import { UsersRepository } from '../../database/repositories/users.repository';
import { NonceResponseDto } from './dto/nonce-response.dto';
import { VerifyRequestDto } from './dto/verify-request.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RegisterRequestDto } from './dto/register-request.dto';
import {
  ACCESS_TOKEN_EXPIRATION,
  ACCESS_TOKEN_EXPIRATION_SECONDS,
  REFRESH_TOKEN_EXPIRATION,
  REFRESH_TOKEN_EXPIRATION_MS,
} from '../../config/jwt.config';

const NONCE_EXPIRATION_SECONDS = 300;

@Injectable()
export class AuthService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersRepository: UsersRepository,
  ) {}

  async register(dto: RegisterRequestDto, profileImage?: any): Promise<any> {
    const existingWallet = await this.usersRepository.findByWallet(dto.walletAddress);
    if (existingWallet) {
      throw new ConflictException({ code: 'AUTH_WALLET_EXISTS', message: 'Wallet address is already registered.' });
    }
    const usernameTaken = await this.usersRepository.checkUsernameExists(dto.username);
    if (usernameTaken) {
      throw new ConflictException({ code: 'AUTH_USERNAME_TAKEN', message: 'Username is already taken.' });
    }
    let avatarUrl: string | null = null;
    if (profileImage) {
      avatarUrl = await this.usersRepository.uploadAvatar(dto.walletAddress, profileImage);
    }
    const user = await this.usersRepository.createProfile({
      wallet: dto.walletAddress,
      username: dto.username,
      displayName: dto.displayName,
      avatarUrl,
    });
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
  }

  async generateNonce(wallet: string): Promise<NonceResponseDto> {
    const nonce = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + NONCE_EXPIRATION_SECONDS * 1000);
    const client = this.supabaseService.getServiceRoleClient();
    const { error } = await client.from('nonces').insert({
      wallet_address: wallet,
      nonce,
      expires_at: expiresAt.toISOString(),
    });
    if (error) {
      throw new InternalServerErrorException({ code: 'DATABASE_NONCE_INSERT_FAILED', message: 'Failed to generate nonce.' });
    }
    return { nonce, expiresAt: expiresAt.toISOString() };
  }

  async verifySignature(dto: VerifyRequestDto): Promise<void> {
    const client = this.supabaseService.getServiceRoleClient();
    const { data: nonceRecord, error: nonceError } = await client
      .from('nonces')
      .select('id, expires_at')
      .eq('wallet_address', dto.wallet)
      .eq('nonce', dto.nonce)
      .is('used_at', null)
      .single();
    if (nonceError || !nonceRecord) {
      throw new UnauthorizedException({ code: 'AUTH_NONCE_NOT_FOUND', message: 'Nonce not found or already used.' });
    }
    if (new Date(nonceRecord.expires_at) < new Date()) {
      throw new UnauthorizedException({ code: 'AUTH_NONCE_EXPIRED', message: 'Nonce has expired.' });
    }
    if (!StrKey.isValidEd25519PublicKey(dto.wallet)) {
      throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
    }
    try {
      const keypair = Keypair.fromPublicKey(dto.wallet);

      let isValid = false;

      // First attempt: raw Ed25519 signature (mobile clients)
      try {
        isValid = keypair.verify(Buffer.from(dto.nonce), Buffer.from(dto.signature, 'base64'));
      } catch (e) {
        isValid = false;
      }

      // If raw verification failed, try SEP-0043 (browser wallets like Freighter)
      if (!isValid) {
        try {
          const sepMessage = 'Stellar Signing Key: ' + dto.nonce;
          isValid = keypair.verify(Buffer.from(sepMessage), Buffer.from(dto.signature, 'base64'));
        } catch (e) {
          isValid = false;
        }
      }

      if (!isValid) {
        throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException({ code: 'AUTH_SIGNATURE_INVALID', message: 'Invalid signature.' });
    }
    await client.from('nonces').update({ used_at: new Date().toISOString() }).eq('id', nonceRecord.id);
  }

  private async findOrCreateUser(wallet: string): Promise<string> {
    const client = this.supabaseService.getServiceRoleClient();
    const { data: user, error } = await client
      .from('users')
      .upsert({ wallet_address: wallet, last_seen_at: new Date().toISOString() }, { onConflict: 'wallet_address' })
      .select('id, status')
      .single();
    if (error || !user) {
      throw new InternalServerErrorException({ code: 'DATABASE_USER_UPSERT_FAILED', message: 'Failed to create or update user.' });
    }
    if (user.status === 'blocked') {
      throw new UnauthorizedException({ code: 'AUTH_USER_BLOCKED', message: 'This account has been suspended.' });
    }
    return user.id;
  }

  async generateTokens(wallet: string): Promise<AuthResponseDto> {
    const userId = await this.findOrCreateUser(wallet);
    const client = this.supabaseService.getServiceRoleClient();
    const accessToken = this.jwtService.sign(
      { wallet, type: 'access' },
      { secret: this.configService.get<string>('JWT_SECRET'), expiresIn: ACCESS_TOKEN_EXPIRATION },
    );
    const refreshToken = this.jwtService.sign(
      { wallet, type: 'refresh' },
      { secret: this.configService.get<string>('JWT_REFRESH_SECRET'), expiresIn: REFRESH_TOKEN_EXPIRATION },
    );
    const refreshTokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRATION_MS);
    const { error: sessionError } = await client.from('sessions').insert({
      user_id: userId,
      refresh_token_hash: refreshTokenHash,
      expires_at: refreshExpiresAt.toISOString(),
    });
    if (sessionError) {
      throw new InternalServerErrorException({ code: 'DATABASE_SESSION_CREATE_FAILED', message: 'Failed to create session.' });
    }
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_EXPIRATION_SECONDS, tokenType: 'Bearer' };
  }

  async refreshTokens(refreshToken: string): Promise<AuthResponseDto> {
    let payload: any;
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
      .select('id, expires_at')
      .eq('refresh_token_hash', tokenHash)
      .single();
    if (error || !session) {
      throw new UnauthorizedException({ code: 'AUTH_SESSION_NOT_FOUND', message: 'Session not found. Please sign in again.' });
    }
    if (new Date(session.expires_at) < new Date()) {
      throw new UnauthorizedException({ code: 'AUTH_SESSION_EXPIRED', message: 'Session expired. Please sign in again.' });
    }
    await client.from('sessions').delete().eq('id', session.id);
    return this.generateTokens(payload.wallet);
  }
}
