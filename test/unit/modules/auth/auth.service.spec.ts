import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { AuthService } from '../../../../src/modules/auth/auth.service';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { UsersRepository } from '../../../../src/database/repositories/users.repository';
import { AuditService } from '../../../../src/modules/admin/audit.service';
import { VerifyRequestDto } from '../../../../src/modules/auth/dto/verify-request.dto';

// Mock Stellar SDK to avoid real crypto operations in unit tests.
// The message-scheme tests only exercise Keypair/StrKey; the SEP-10 challenge
// builder needs Account/Operation/TransactionBuilder/BASE_FEE so generateNonce
// can produce a (mock) challenge XDR without real SDK crypto. Real-SDK SEP-10
// verification is covered in auth.service.sep0010.spec.ts (separate module
// registry, no mock).
jest.mock('stellar-sdk', () => ({
  Keypair: { fromPublicKey: jest.fn() },
  StrKey: { isValidEd25519PublicKey: jest.fn().mockReturnValue(true) },
  Account: jest.fn(),
  BASE_FEE: '100',
  Operation: { manageData: jest.fn(() => ({ type: 'manageData' })) },
  TransactionBuilder: jest.fn(() => ({
    addOperation: jest.fn().mockReturnThis(),
    build: jest.fn(() => ({ toXDR: () => 'MOCK_CHALLENGE_XDR' })),
  })),
  Transaction: jest.fn(),
}));

import { Keypair, StrKey } from 'stellar-sdk';

// Env values the service resolves in its constructor (matching the mocked
// ConfigService below) so challenge envelopes can be reproduced in tests.
// URL.host includes the port, so localhost:3000 is the challenge domain.
const CHALLENGE_DOMAIN = 'localhost:3000';
const CHALLENGE_URI = 'http://localhost:3000/api/v1/auth/verify';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const CHALLENGE_STATEMENT =
  'StepFi requests that you sign this message to authenticate your wallet. ' +
  'This message does not trigger any blockchain transaction.';
const SEP_53_PREFIX = 'Stellar Signed Message:\n';

/** Reproduces the service's canonical challenge envelope serialization. */
function buildChallengeMessage(wallet: string, nonce: string, issuedAt: Date, expiresAt: Date): string {
  return JSON.stringify(
    {
      domain: CHALLENGE_DOMAIN,
      address: wallet,
      statement: CHALLENGE_STATEMENT,
      uri: CHALLENGE_URI,
      version: '1.0.0',
      nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: expiresAt.toISOString(),
      networkPassphrase: NETWORK_PASSPHRASE,
    },
    null,
    2,
  );
}

describe('AuthService', () => {
  let service: AuthService;

  const mockInsert = jest.fn().mockResolvedValue({ error: null });
  const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });

  const mockSupabaseClient = { from: mockFrom };

  const mockSupabaseService = {
    getServiceRoleClient: jest.fn(() => mockSupabaseClient),
  };

  const mockJwtService: { sign: jest.Mock; verify: jest.Mock } = {
    sign: jest.fn().mockReturnValue('mock.jwt.token'),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockUsersRepository = {
    findByWallet: jest.fn(),
    checkUsernameExists: jest.fn(),
    uploadAvatar: jest.fn(),
    createProfile: jest.fn(),
    deleteAvatar: jest.fn(),
    deleteUserById: jest.fn(),
  };

  const mockAuditService = {
    log: jest.fn().mockResolvedValue(undefined),
    logWithBeforeAfter: jest.fn().mockResolvedValue(undefined),
  };

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

  /**
   * Builds an AuthService with a ConfigService whose `get` returns the given
   * overrides on top of the default test configuration.
   */
  function createServiceWithConfig(overrides: Record<string, unknown> = {}): AuthService {
    const config = {
      get: jest.fn((key: string) => {
        if (key in overrides) {
          return overrides[key];
        }
        switch (key) {
          case 'API_URL':
            return 'http://localhost:3000';
          case 'API_PREFIX':
            return 'api/v1';
          case 'STELLAR_NETWORK_PASSPHRASE':
            return NETWORK_PASSPHRASE;
          case 'AUTH_CHALLENGE_DOMAIN':
            return undefined;
          case 'AUTH_ALLOW_LEGACY_RAW_SIGNATURES':
            return undefined; // default: legacy accepted during migration window
          case 'AUTH_LEGACY_SIGNATURES_SUNSET':
            return undefined; // default: LEGACY_RAW_SIGNATURES_SUNSET (2026-10-31)
          default:
            return 'mock-secret';
        }
      }),
    };
    return new AuthService(
      mockSupabaseService as unknown as SupabaseService,
      mockJwtService as unknown as JwtService,
      config as unknown as ConfigService,
      mockUsersRepository as unknown as UsersRepository,
      { log: jest.fn(), logWithBeforeAfter: jest.fn() } as unknown as AuditService,
    );
  }

  /** Config mock matching the constructor's expectations. */
  function configureConfigService() {
    mockConfigService.get.mockImplementation((key: string) => {
      switch (key) {
        case 'API_URL':
          return 'http://localhost:3000';
        case 'API_PREFIX':
          return 'api/v1';
        case 'STELLAR_NETWORK_PASSPHRASE':
          return NETWORK_PASSPHRASE;
        case 'AUTH_CHALLENGE_DOMAIN':
          return undefined;
        case 'AUTH_ALLOW_LEGACY_RAW_SIGNATURES':
          return undefined; // default: legacy accepted during migration window
        case 'AUTH_LEGACY_SIGNATURES_SUNSET':
          return undefined; // default: LEGACY_RAW_SIGNATURES_SUNSET (2026-10-31)
        default:
          return 'mock-secret';
      }
    });
  }

  beforeEach(async () => {
    configureConfigService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    jest.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
    mockJwtService.sign.mockReturnValue('mock.jwt.token');
    configureConfigService();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'users') {
        const chain: Record<string, jest.Mock> = {
          upsert: jest.fn(),
          select: jest.fn(),
          single: jest.fn().mockResolvedValue({ data: { id: 'user-uuid', status: 'active' }, error: null }),
        };
        chain.upsert.mockReturnValue(chain);
        chain.select.mockReturnValue(chain);
        return chain;
      }
      if (table === 'learner_profiles') {
        const chain: Record<string, jest.Mock> = {
          select: jest.fn(),
          eq: jest.fn(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          insert: jest.fn().mockResolvedValue({ error: null }),
        };
        chain.select.mockReturnValue(chain);
        chain.eq.mockReturnValue(chain);
        return chain;
      }
      if (table === 'sessions') {
        return { insert: jest.fn().mockResolvedValue({ error: null }) };
      }
      return { insert: mockInsert };
    });
    (StrKey.isValidEd25519PublicKey as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // generateNonce
  // ---------------------------------------------------------------------------
  describe('generateNonce', () => {
    it('should return nonce, expiresAt and a canonical challenge message', async () => {
      const result = await service.generateNonce(validWallet);

      expect(result).toHaveProperty('nonce');
      expect(result).toHaveProperty('expiresAt');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('challengeXdr');
      expect(typeof result.nonce).toBe('string');
      expect(result.nonce).toHaveLength(64);
      expect(/^[a-f0-9]+$/.test(result.nonce)).toBe(true);
    });

    it('should generate unique nonces on each call', async () => {
      const result1 = await service.generateNonce(validWallet);
      const result2 = await service.generateNonce(validWallet);

      expect(result1.nonce).not.toBe(result2.nonce);
    });

    it('should set expiresAt to approximately 5 minutes from now', async () => {
      const before = Date.now();
      const result = await service.generateNonce(validWallet);
      const after = Date.now();

      const expiresAtTime = new Date(result.expiresAt).getTime();
      const fiveMinutes = 5 * 60 * 1000;
      const tolerance = 2000;

      expect(expiresAtTime).toBeGreaterThanOrEqual(before + fiveMinutes - tolerance);
      expect(expiresAtTime).toBeLessThanOrEqual(after + fiveMinutes + tolerance);
    });

    it('should return a challenge message bound to this environment, wallet and nonce', async () => {
      const result = await service.generateNonce(validWallet);

      const envelope = JSON.parse(result.message);
      expect(envelope.domain).toBe(CHALLENGE_DOMAIN);
      expect(envelope.address).toBe(validWallet);
      expect(envelope.uri).toBe(CHALLENGE_URI);
      expect(envelope.nonce).toBe(result.nonce);
      expect(envelope.version).toBe('1.0.0');
      expect(envelope.issuedAt).toBeDefined();
      expect(envelope.expirationTime).toBe(result.expiresAt);
      expect(envelope.networkPassphrase).toBe(NETWORK_PASSPHRASE);
    });

    it('should store nonce in database with the exact challenge message hash', async () => {
      const result = await service.generateNonce(validWallet);

      expect(mockSupabaseService.getServiceRoleClient).toHaveBeenCalled();
      expect(mockFrom).toHaveBeenCalledWith('nonces');
      const expectedHash = createHash('sha256').update(result.message, 'utf8').digest('hex');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          wallet_address: validWallet,
          nonce: expect.any(String),
          expires_at: expect.any(String),
          issued_at: expect.any(String),
          message_hash: expectedHash,
        }),
      );
    });

    it('should throw InternalServerErrorException when database insert fails', async () => {
      mockInsert.mockResolvedValue({ error: { message: 'Database connection failed' } });

      await expect(service.generateNonce(validWallet)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // verifySignature — domain-bound challenge verification
  // ---------------------------------------------------------------------------
  describe('verifySignature', () => {
    const validNonce = 'a1b2c3d4e5f67890abcdef1234567890a1b2c3d4e5f67890abcdef1234567890';
    const validSignature = Buffer.alloc(64).toString('base64');
    const futureExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const defaultNonceRecord = { id: 'nonce-uuid', expires_at: futureExpiry };

    type NonceResult = { data: object | null; error: { message: string } | null };

    interface TestNonceRecord {
      id: string;
      expires_at: string;
      issued_at: string;
      message_hash: string;
    }

    /** Nonce record for a challenge issued ~1 minute ago, valid for 5 more. */
    function buildNonceRecord(overrides: Partial<TestNonceRecord> = {}): TestNonceRecord {
      const issuedAt = new Date(Date.now() - 60 * 1000);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      const message = buildChallengeMessage(validWallet, validNonce, issuedAt, expiresAt);
      return {
        id: 'nonce-uuid',
        expires_at: expiresAt.toISOString(),
        issued_at: issuedAt.toISOString(),
        message_hash: createHash('sha256').update(message, 'utf8').digest('hex'),
        ...overrides,
      };
    }

    function setupMocks({
      nonceResult = { data: defaultNonceRecord, error: null },
      claimResult = { data: [{ id: 'nonce-uuid' }], error: null, count: 1 },
      signatureValid = true,
      strKeyValid = true,
    }: {
      nonceResult?: NonceResult;
      claimResult?: { data: unknown[] | null; error: unknown; count: number | null };
      signatureValid?: boolean;
      strKeyValid?: boolean;
    } = {}) {
      const mockKeypair = { verify: jest.fn().mockReturnValue(signatureValid) };
      (Keypair.fromPublicKey as jest.Mock).mockReturnValue(mockKeypair);
      (StrKey.isValidEd25519PublicKey as jest.Mock).mockReturnValue(strKeyValid);

      mockFrom.mockImplementation((table: string) => {
        if (table === 'nonces') {
          // Builder that supports both:
          // SELECT: select().eq().is().single()  -> nonceResult
          // CLAIM:  update().eq().is().select()   -> claimResult
          const builder: Record<string, jest.Mock> = {
            select: jest.fn(),
            eq: jest.fn(),
            is: jest.fn(),
            single: jest.fn().mockResolvedValue(nonceResult),
            update: jest.fn(),
          };
          let operation: 'select' | 'update' = 'select';
          builder.select.mockImplementation((..._args: unknown[]) => {
            if (operation === 'update') {
              // This is the terminal select after update().eq().is().select()
              return Promise.resolve(claimResult);
            }
            return builder;
          });
          builder.update.mockImplementation(() => {
            operation = 'update';
            return builder;
          });
          builder.eq.mockReturnValue(builder);
          builder.is.mockReturnValue(builder);
          return builder;
        }
        return { insert: mockInsert };
      });

      return { mockKeypair };
    }

    const validDto: VerifyRequestDto = { wallet: validWallet, nonce: validNonce, signature: validSignature };

    // --- legacy raw scheme (deprecated, migration window) -------------------

    it('should resolve without error when nonce and signature are valid (legacy raw)', async () => {
      setupMocks();
      await expect(service.verifySignature(validDto)).resolves.toBeUndefined();
    });

    it('should throw UnauthorizedException (AUTH_NONCE_NOT_FOUND) when nonce does not exist', async () => {
      setupMocks({ nonceResult: { data: null, error: { message: 'No rows found' } } });

      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_NONCE_NOT_FOUND' },
      });
    });

    it('should throw UnauthorizedException (AUTH_NONCE_NOT_FOUND) when nonce is already used', async () => {
      // A used nonce has used_at set — .is('used_at', null) excludes it → same NOT_FOUND error
      setupMocks({ nonceResult: { data: null, error: { message: 'No rows found' } } });

      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_NONCE_NOT_FOUND' },
      });
    });

    it('should throw UnauthorizedException (AUTH_NONCE_NOT_FOUND) when atomic claim loses the race (count === 0)', async () => {
      setupMocks({ claimResult: { data: [], error: null, count: 0 } });

      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_NONCE_NOT_FOUND' },
      });
    });

    it('should throw UnauthorizedException (AUTH_NONCE_EXPIRED) when nonce is past expiry (nonce stays burned)', async () => {
      const expiredDate = new Date(Date.now() - 1000).toISOString();
      setupMocks({
        nonceResult: { data: { id: 'nonce-uuid', expires_at: expiredDate }, error: null },
        claimResult: { data: [{ id: 'nonce-uuid' }], error: null, count: 1 },
      });

      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_NONCE_EXPIRED' },
      });
    });

    it('should throw UnauthorizedException (AUTH_SIGNATURE_INVALID) when StrKey validation fails', async () => {
      // StrKey check happens after claim; claim should have succeeded
      setupMocks({ strKeyValid: false });

      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_SIGNATURE_INVALID' },
      });
    });

    it('should throw UnauthorizedException (AUTH_SIGNATURE_INVALID) when legacy signature does not verify', async () => {
      setupMocks({ signatureValid: false });

      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_SIGNATURE_INVALID' },
      });
    });

    it('should throw UnauthorizedException (AUTH_SIGNATURE_INVALID) when Keypair throws an unexpected error', async () => {
      setupMocks();
      (Keypair.fromPublicKey as jest.Mock).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_SIGNATURE_INVALID' },
      });
    });

    it('should verify a legacy signature using Stellar Keypair with nonce bytes and base64 signature', async () => {
      const { mockKeypair } = setupMocks();
      await service.verifySignature(validDto);

      expect(Keypair.fromPublicKey).toHaveBeenCalledWith(validWallet);
      expect(mockKeypair.verify).toHaveBeenCalledWith(
        Buffer.from(validNonce),
        Buffer.from(validSignature, 'base64'),
      );
    });

    it('should reject legacy raw nonce signatures when AUTH_ALLOW_LEGACY_RAW_SIGNATURES is false', async () => {
      const serviceWithLegacyOff = createServiceWithConfig({ AUTH_ALLOW_LEGACY_RAW_SIGNATURES: 'false' });
      // A signature that WOULD verify (mock verify returns true) — the guard
      // must reject it purely because the legacy scheme is disabled.
      const { mockKeypair } = setupMocks({ signatureValid: true });
      const legacyDto: VerifyRequestDto = { ...validDto, signatureType: 'raw' };

      await expect(serviceWithLegacyOff.verifySignature(legacyDto)).rejects.toMatchObject({
        response: { code: 'AUTH_LEGACY_SIGNATURE_DISABLED' },
      });
      expect(mockKeypair.verify).not.toHaveBeenCalled();
    });

    it('should reject legacy raw nonce signatures after the sunset date even when the flag is still true', async () => {
      // AUTH_ALLOW_LEGACY_RAW_SIGNATURES=true but the sunset has passed — the
      // runtime cutoff must close the replayable scheme anyway (issue #118).
      const servicePastSunset = createServiceWithConfig({
        AUTH_ALLOW_LEGACY_RAW_SIGNATURES: 'true',
        AUTH_LEGACY_SIGNATURES_SUNSET: '2020-01-01',
      });
      const { mockKeypair } = setupMocks({ signatureValid: true });
      const legacyDto: VerifyRequestDto = { ...validDto, signatureType: 'raw' };

      await expect(servicePastSunset.verifySignature(legacyDto)).rejects.toMatchObject({
        response: { code: 'AUTH_LEGACY_SIGNATURE_DISABLED' },
      });
      expect(mockKeypair.verify).not.toHaveBeenCalled();
    });

    it('should accept legacy raw nonce signatures while the flag is true and the sunset is in the future', async () => {
      const serviceFutureSunset = createServiceWithConfig({
        AUTH_ALLOW_LEGACY_RAW_SIGNATURES: 'true',
        AUTH_LEGACY_SIGNATURES_SUNSET: '2999-01-01',
      });
      const { mockKeypair } = setupMocks();
      const legacyDto: VerifyRequestDto = { ...validDto, signatureType: 'raw' };

      await expect(serviceFutureSunset.verifySignature(legacyDto)).resolves.toBeUndefined();
      expect(mockKeypair.verify).toHaveBeenCalledWith(
        Buffer.from(validNonce),
        Buffer.from(validSignature, 'base64'),
      );
    });

    // --- canonical envelope: native (signatureType 'envelope') --------------

    it('should accept a native signature over the canonical envelope (signatureType envelope)', async () => {
      const record = buildNonceRecord();
      const { mockKeypair } = setupMocks({ nonceResult: { data: record, error: null } });
      const message = buildChallengeMessage(validWallet, validNonce, new Date(record.issued_at), new Date(record.expires_at));
      const dto: VerifyRequestDto = { ...validDto, signatureType: 'envelope', message };

      await expect(service.verifySignature(dto)).resolves.toBeUndefined();

      expect(mockKeypair.verify).toHaveBeenCalledWith(
        Buffer.from(message, 'utf8'),
        Buffer.from(validSignature, 'base64'),
      );
    });

    it('should verify a canonical signature against the reconstructed message when the client omits message', async () => {
      const record = buildNonceRecord();
      const { mockKeypair } = setupMocks({ nonceResult: { data: record, error: null } });
      const dto: VerifyRequestDto = { ...validDto, signatureType: 'envelope' };

      await expect(service.verifySignature(dto)).resolves.toBeUndefined();

      const message = buildChallengeMessage(validWallet, validNonce, new Date(record.issued_at), new Date(record.expires_at));
      expect(mockKeypair.verify).toHaveBeenCalledWith(
        Buffer.from(message, 'utf8'),
        Buffer.from(validSignature, 'base64'),
      );
    });

    it('should reject a client-supplied message that does not match the stored challenge hash', async () => {
      const record = buildNonceRecord();
      setupMocks({ nonceResult: { data: record, error: null } });
      const message = buildChallengeMessage(validWallet, validNonce, new Date(record.issued_at), new Date(record.expires_at));
      const tampered = message.replace('authenticate your wallet', 'authenticate');
      const dto: VerifyRequestDto = { ...validDto, signatureType: 'envelope', message: tampered };

      await expect(service.verifySignature(dto)).rejects.toMatchObject({
        response: { code: 'AUTH_CHALLENGE_MISMATCH' },
      });
    });

    it('should reject a canonical challenge whose envelope expirationTime has passed', async () => {
      const issuedAt = new Date(Date.now() - 10 * 60 * 1000);
      const expiresAt = new Date(Date.now() - 5 * 60 * 1000); // envelope expired
      const message = buildChallengeMessage(validWallet, validNonce, issuedAt, expiresAt);
      const record = buildNonceRecord({
        expires_at: futureExpiry, // DB row still valid — envelope expiry is enforced separately
        issued_at: issuedAt.toISOString(),
        message_hash: createHash('sha256').update(message, 'utf8').digest('hex'),
      });
      setupMocks({ nonceResult: { data: record, error: null } });
      const dto: VerifyRequestDto = { ...validDto, signatureType: 'envelope', message };

      await expect(service.verifySignature(dto)).rejects.toMatchObject({
        response: { code: 'AUTH_NONCE_EXPIRED' },
      });
    });

    it('should reject canonical verification when the nonce row has no stored challenge hash', async () => {
      setupMocks({
        nonceResult: {
          data: { id: 'nonce-uuid', expires_at: futureExpiry, issued_at: null, message_hash: null },
          error: null,
        },
      });
      const message = buildChallengeMessage(validWallet, validNonce, new Date(), new Date(Date.now() + 5 * 60 * 1000));
      const dto: VerifyRequestDto = { ...validDto, signatureType: 'envelope', message };

      await expect(service.verifySignature(dto)).rejects.toMatchObject({
        response: { code: 'AUTH_SIGNATURE_INVALID' },
      });
    });

    // --- canonical envelope: browser (signatureType 'sep0043', SEP-53) ------

    it('should accept a SEP-53 browser signature over the canonical envelope (signatureType sep0043)', async () => {
      const record = buildNonceRecord();
      const { mockKeypair } = setupMocks({ nonceResult: { data: record, error: null } });
      const message = buildChallengeMessage(validWallet, validNonce, new Date(record.issued_at), new Date(record.expires_at));
      const dto: VerifyRequestDto = { ...validDto, signatureType: 'sep0043', message };

      await expect(service.verifySignature(dto)).resolves.toBeUndefined();

      const digest = createHash('sha256').update(SEP_53_PREFIX + message, 'utf8').digest();
      expect(mockKeypair.verify).toHaveBeenCalledWith(digest, Buffer.from(validSignature, 'base64'));
    });

    it('should reject a SEP-53 signature whose envelope domain does not match our host', async () => {
      const record = buildNonceRecord();
      const message = buildChallengeMessage(validWallet, validNonce, new Date(record.issued_at), new Date(record.expires_at));
      const foreignMessage = message.replace('"domain": "localhost:3000"', '"domain": "evil.example.com"');
      // Simulates a nonce row whose stored binding points at a foreign domain
      // (e.g. a challenge issued by another environment being replayed here).
      const tamperedRecord = buildNonceRecord({
        message_hash: createHash('sha256').update(foreignMessage, 'utf8').digest('hex'),
      });
      setupMocks({ nonceResult: { data: tamperedRecord, error: null } });
      const dto: VerifyRequestDto = { ...validDto, signatureType: 'sep0043', message: foreignMessage };

      await expect(service.verifySignature(dto)).rejects.toMatchObject({
        response: { code: 'AUTH_CHALLENGE_DOMAIN_MISMATCH' },
      });
    });

    it('should reject a canonical signature when the envelope network passphrase does not match', async () => {
      const record = buildNonceRecord();
      const message = buildChallengeMessage(validWallet, validNonce, new Date(record.issued_at), new Date(record.expires_at));
      const foreignMessage = message.replace(NETWORK_PASSPHRASE, 'Public Global Stellar Network ; September 2015');
      const tamperedRecord = buildNonceRecord({
        message_hash: createHash('sha256').update(foreignMessage, 'utf8').digest('hex'),
      });
      setupMocks({ nonceResult: { data: tamperedRecord, error: null } });
      const dto: VerifyRequestDto = { ...validDto, signatureType: 'sep0043', message: foreignMessage };

      await expect(service.verifySignature(dto)).rejects.toMatchObject({
        response: { code: 'AUTH_CHALLENGE_NETWORK_MISMATCH' },
      });
    });

    it('should mark nonce as used via atomic claim before signature verification', async () => {
      setupMocks();
      await service.verifySignature(validDto);

      expect(mockFrom).toHaveBeenCalledWith('nonces');
    });

    it('should burn the nonce even when signature verification fails (DoS-on-self tradeoff)', async () => {
      // Claim succeeds, but signature invalid — nonce stays burned, replay should get NOT_FOUND
      const claimCallCount = { count: 0 };
      const mockKeypair = { verify: jest.fn().mockReturnValue(false) };
      (Keypair.fromPublicKey as jest.Mock).mockReturnValue(mockKeypair);
      (StrKey.isValidEd25519PublicKey as jest.Mock).mockReturnValue(true);

      mockFrom.mockImplementation((table: string) => {
        if (table === 'nonces') {
          const builder: Record<string, jest.Mock> = {
            select: jest.fn(),
            eq: jest.fn(),
            is: jest.fn(),
            single: jest.fn(),
            update: jest.fn(),
          };
          let operation: 'select' | 'update' = 'select';
          // First verify: SELECT returns the nonce, CLAIM succeeds (count 1)
          // Second verify (replay): claim would lose or SELECT already empty
          builder.single.mockImplementation(() => {
            // For this test we always return the nonce for SELECT, so the second
            // call's failure is due to claim burning semantics, not SELECT miss.
            // The service should still throw AUTH_NONCE_NOT_FOUND on second call
            // because count === 0 (simulated via claimCallCount).
            return Promise.resolve({ data: defaultNonceRecord, error: null });
          });
          builder.select.mockImplementation((..._args: unknown[]) => {
            if (operation === 'update') {
              claimCallCount.count += 1;
              if (claimCallCount.count === 1) {
                return Promise.resolve({ data: [{ id: 'nonce-uuid' }], error: null, count: 1 });
              }
              return Promise.resolve({ data: [], error: null, count: 0 });
            }
            return builder;
          });
          builder.update.mockImplementation(() => {
            operation = 'update';
            return builder;
          });
          builder.eq.mockReturnValue(builder);
          builder.is.mockReturnValue(builder);
          return builder;
        }
        return { insert: mockInsert };
      });

      // First call: claim succeeds but signature fails -> AUTH_SIGNATURE_INVALID, nonce burned
      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_SIGNATURE_INVALID' },
      });

      // Fix signature to be valid, but nonce is already burned -> should get NOT_FOUND, not success
      mockKeypair.verify.mockReturnValue(true);
      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_NONCE_NOT_FOUND' },
      });
    });
  });

  describe('verifySignature — atomicity / concurrency', () => {
    const validNonce = 'a1b2c3d4e5f67890abcdef1234567890a1b2c3d4e5f67890abcdef1234567890';
    const validSignature = Buffer.alloc(64).toString('base64');
    const futureExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const defaultNonceRecord = { id: 'nonce-uuid', expires_at: futureExpiry };
    const validDto = { wallet: validWallet, nonce: validNonce, signature: validSignature };

    it('parallel double-verify yields exactly one success (atomic claim)', async () => {
      const mockKeypair = { verify: jest.fn().mockReturnValue(true) };
      (Keypair.fromPublicKey as jest.Mock).mockReturnValue(mockKeypair);
      (StrKey.isValidEd25519PublicKey as jest.Mock).mockReturnValue(true);

      let claimAttempts = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === 'nonces') {
          const builder: Record<string, jest.Mock> = {
            select: jest.fn(),
            eq: jest.fn(),
            is: jest.fn(),
            single: jest.fn().mockResolvedValue({ data: defaultNonceRecord, error: null }),
            update: jest.fn(),
          };
          let op: 'select' | 'update' = 'select';
          builder.select.mockImplementation((..._args: unknown[]) => {
            if (op === 'update') {
              claimAttempts += 1;
              if (claimAttempts === 1) {
                return Promise.resolve({ data: [{ id: 'nonce-uuid' }], error: null, count: 1 });
              }
              return Promise.resolve({ data: [], error: null, count: 0 });
            }
            return builder;
          });
          builder.update.mockImplementation(() => {
            op = 'update';
            return builder;
          });
          builder.eq.mockReturnValue(builder);
          builder.is.mockReturnValue(builder);
          return builder;
        }
        return { insert: mockInsert };
      });

      const results = await Promise.allSettled([
        service.verifySignature(validDto),
        service.verifySignature(validDto),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const rejectedReason = (rejected[0] as PromiseRejectedResult).reason as { response: { code: string } };
      expect(rejectedReason.response.code).toBe('AUTH_NONCE_NOT_FOUND');
    });

    it('replay after success fails with AUTH_NONCE_NOT_FOUND', async () => {
      const mockKeypair = { verify: jest.fn().mockReturnValue(true) };
      (Keypair.fromPublicKey as jest.Mock).mockReturnValue(mockKeypair);
      (StrKey.isValidEd25519PublicKey as jest.Mock).mockReturnValue(true);

      // First call: both SELECT and CLAIM succeed
      mockFrom.mockImplementation((table: string) => {
        if (table === 'nonces') {
          const builder: Record<string, jest.Mock> = {
            select: jest.fn(),
            eq: jest.fn(),
            is: jest.fn(),
            single: jest.fn().mockResolvedValue({ data: defaultNonceRecord, error: null }),
            update: jest.fn(),
          };
          let op: 'select' | 'update' = 'select';
          builder.select.mockImplementation((..._args: unknown[]) => {
            if (op === 'update') return Promise.resolve({ data: [{ id: 'nonce-uuid' }], error: null, count: 1 });
            return builder;
          });
          builder.update.mockImplementation(() => {
            op = 'update';
            return builder;
          });
          builder.eq.mockReturnValue(builder);
          builder.is.mockReturnValue(builder);
          return builder;
        }
        return { insert: mockInsert };
      });

      await expect(service.verifySignature(validDto)).resolves.toBeUndefined();

      // Second call: nonce already used — SELECT returns no rows (or CLAIM count 0)
      mockFrom.mockImplementation((table: string) => {
        if (table === 'nonces') {
          const builder: Record<string, jest.Mock> = {
            select: jest.fn(),
            eq: jest.fn(),
            is: jest.fn(),
            single: jest.fn().mockResolvedValue({ data: null, error: { message: 'No rows found' } }),
            update: jest.fn(),
          };
          builder.select.mockReturnValue(builder);
          builder.eq.mockReturnValue(builder);
          builder.is.mockReturnValue(builder);
          builder.update.mockReturnValue(builder);
          return builder;
        }
        return { insert: mockInsert };
      });

      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_NONCE_NOT_FOUND' },
      });
    });

    it('replay during failure burns the nonce (invalid signature leaves it consumed)', async () => {
      const mockKeypair = { verify: jest.fn().mockReturnValue(false) };
      (Keypair.fromPublicKey as jest.Mock).mockReturnValue(mockKeypair);
      (StrKey.isValidEd25519PublicKey as jest.Mock).mockReturnValue(true);

      let firstClaim = true;
      mockFrom.mockImplementation((table: string) => {
        if (table === 'nonces') {
          const builder: Record<string, jest.Mock> = {
            select: jest.fn(),
            eq: jest.fn(),
            is: jest.fn(),
            single: jest.fn().mockResolvedValue({ data: defaultNonceRecord, error: null }),
            update: jest.fn(),
          };
          let op: 'select' | 'update' = 'select';
          builder.select.mockImplementation((..._args: unknown[]) => {
            if (op === 'update') {
              if (firstClaim) {
                firstClaim = false;
                return Promise.resolve({ data: [{ id: 'nonce-uuid' }], error: null, count: 1 });
              }
              return Promise.resolve({ data: [], error: null, count: 0 });
            }
            return builder;
          });
          builder.update.mockImplementation(() => {
            op = 'update';
            return builder;
          });
          builder.eq.mockReturnValue(builder);
          builder.is.mockReturnValue(builder);
          return builder;
        }
        return { insert: mockInsert };
      });

      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_SIGNATURE_INVALID' },
      });

      // Even with a now-valid signature, replay should fail because nonce was burned
      mockKeypair.verify.mockReturnValue(true);
      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_NONCE_NOT_FOUND' },
      });
    });

    it('expired nonce is rejected and stays burned', async () => {
      const expiredRecord = { id: 'nonce-uuid', expires_at: new Date(Date.now() - 1000).toISOString() };
      const mockKeypair = { verify: jest.fn().mockReturnValue(true) };
      (Keypair.fromPublicKey as jest.Mock).mockReturnValue(mockKeypair);
      (StrKey.isValidEd25519PublicKey as jest.Mock).mockReturnValue(true);

      let claimOnce = true;
      mockFrom.mockImplementation((table: string) => {
        if (table === 'nonces') {
          const builder: Record<string, jest.Mock> = {
            select: jest.fn(),
            eq: jest.fn(),
            is: jest.fn(),
            single: jest.fn().mockResolvedValue({ data: expiredRecord, error: null }),
            update: jest.fn(),
          };
          let op: 'select' | 'update' = 'select';
          builder.select.mockImplementation((..._args: unknown[]) => {
            if (op === 'update') {
              if (claimOnce) {
                claimOnce = false;
                return Promise.resolve({ data: [{ id: 'nonce-uuid' }], error: null, count: 1 });
              }
              return Promise.resolve({ data: [], error: null, count: 0 });
            }
            return builder;
          });
          builder.update.mockImplementation(() => {
            op = 'update';
            return builder;
          });
          builder.eq.mockReturnValue(builder);
          builder.is.mockReturnValue(builder);
          return builder;
        }
        return { insert: mockInsert };
      });

      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_NONCE_EXPIRED' },
      });

      // Second attempt should be NOT_FOUND because expired nonce was consumed
      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_NONCE_NOT_FOUND' },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // generateTokens — upserts user, signs JWT tokens, stores session
  // ---------------------------------------------------------------------------
  describe('generateTokens', () => {
    const defaultUserRecord = { id: 'user-uuid', status: 'active' };

    function setupMocks({
      userResult = { data: defaultUserRecord, error: null },
      sessionResult = { error: null },
    } = {}) {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'users') {
          const chain: Record<string, jest.Mock> = {
            upsert: jest.fn(),
            select: jest.fn(),
            single: jest.fn().mockResolvedValue(userResult),
          };
          chain.upsert.mockReturnValue(chain);
          chain.select.mockReturnValue(chain);
          return chain;
        }
        if (table === 'learner_profiles') {
          const chain: Record<string, jest.Mock> = {
            select: jest.fn(),
            eq: jest.fn(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            insert: jest.fn().mockResolvedValue({ error: null }),
          };
          chain.select.mockReturnValue(chain);
          chain.eq.mockReturnValue(chain);
          return chain;
        }
        if (table === 'sessions') {
          return { insert: jest.fn().mockResolvedValue(sessionResult) };
        }
        return { insert: mockInsert };
      });
    }

    it('should return accessToken, refreshToken, expiresIn and tokenType', async () => {
      setupMocks();
      const result = await service.generateTokens(validWallet);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.expiresIn).toBe(900);
      expect(result.tokenType).toBe('Bearer');
    });

    it('should sign access token with payload { wallet, type: access } and 15m expiration', async () => {
      setupMocks();
      await service.generateTokens(validWallet);

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        { wallet: validWallet, type: 'access', role: null },
        expect.objectContaining({ expiresIn: '15m' }),
      );
    });

    it('should sign refresh token with payload { wallet, type: refresh, fam } and 7d expiration', async () => {
      setupMocks();
      await service.generateTokens(validWallet);

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        { wallet: validWallet, type: 'refresh', fam: expect.any(String) },
        expect.objectContaining({ expiresIn: '7d' }),
      );
    });

    it('should store session row with the same family_id embedded in the refresh token', async () => {
      const sessionInsert = jest.fn().mockResolvedValue({ error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === 'users') {
          const chain: Record<string, jest.Mock> = {
            upsert: jest.fn(),
            select: jest.fn(),
            single: jest.fn().mockResolvedValue({ data: { id: 'user-uuid', status: 'active' }, error: null }),
          };
          chain.upsert.mockReturnValue(chain);
          chain.select.mockReturnValue(chain);
          return chain;
        }
        if (table === 'learner_profiles') {
          const chain: Record<string, jest.Mock> = {
            select: jest.fn(),
            eq: jest.fn(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            insert: jest.fn().mockResolvedValue({ error: null }),
          };
          chain.select.mockReturnValue(chain);
          chain.eq.mockReturnValue(chain);
          return chain;
        }
        if (table === 'sessions') {
          return { insert: sessionInsert };
        }
        return { insert: mockInsert };
      });

      await service.generateTokens(validWallet);

      const refreshCall = mockJwtService.sign.mock.calls.find((c) => c[0].type === 'refresh');
      expect(sessionInsert).toHaveBeenCalledWith(
        expect.objectContaining({ family_id: refreshCall?.[0].fam }),
      );
    });

    it('should throw UnauthorizedException (AUTH_USER_BLOCKED) when user account is blocked', async () => {
      setupMocks({ userResult: { data: { id: 'user-uuid', status: 'blocked' }, error: null } });

      await expect(service.generateTokens(validWallet)).rejects.toMatchObject({
        response: { code: 'AUTH_USER_BLOCKED' },
      });
    });

    it('should throw InternalServerErrorException (DATABASE_USER_UPSERT_FAILED) when user upsert fails', async () => {
      setupMocks({ userResult: { data: null, error: { message: 'DB error' } } });

      await expect(service.generateTokens(validWallet)).rejects.toMatchObject({
        response: { code: 'DATABASE_USER_UPSERT_FAILED' },
      });
    });

    it('should throw InternalServerErrorException (DATABASE_SESSION_CREATE_FAILED) when session insert fails', async () => {
      setupMocks({ sessionResult: { error: { message: 'DB error' } } });

      await expect(service.generateTokens(validWallet)).rejects.toMatchObject({
        response: { code: 'DATABASE_SESSION_CREATE_FAILED' },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // register
  // ---------------------------------------------------------------------------
  describe('register', () => {
    const registerDto = {
      walletAddress: validWallet,
      username: 'testuser',
      displayName: 'Test User',
      termsAccepted: 'true',
    };

    const mockUser = {
      id: 'user-uuid',
      wallet_address: validWallet,
      username: 'testuser',
      display_name: 'Test User',
      avatar_url: 'https://example.com/avatar.png',
      created_at: new Date().toISOString(),
    };

    beforeEach(() => {
      mockUsersRepository.findByWallet.mockResolvedValue(null);
      mockUsersRepository.checkUsernameExists.mockResolvedValue(false);
      mockUsersRepository.createProfile.mockResolvedValue(mockUser);
      mockUsersRepository.uploadAvatar.mockResolvedValue('https://example.com/avatar.png');
      mockUsersRepository.deleteAvatar.mockResolvedValue(undefined);
      mockUsersRepository.deleteUserById.mockResolvedValue(undefined);

      // Mock findOrCreateUser internal behavior via Supabase mock
      mockFrom.mockImplementation((table: string) => {
        if (table === 'users') {
          const chain: Record<string, jest.Mock> = {
            upsert: jest.fn(),
            select: jest.fn(),
            single: jest.fn().mockResolvedValue({ data: { id: 'user-uuid', status: 'active' }, error: null }),
          };
          chain.upsert.mockReturnValue(chain);
          chain.select.mockReturnValue(chain);
          return chain;
        }
        if (table === 'learner_profiles') {
          const chain: Record<string, jest.Mock> = {
            select: jest.fn(),
            eq: jest.fn(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            insert: jest.fn().mockResolvedValue({ error: null }),
          };
          chain.select.mockReturnValue(chain);
          chain.eq.mockReturnValue(chain);
          return chain;
        }
        if (table === 'sessions') {
          return { insert: jest.fn().mockResolvedValue({ error: null }) };
        }
        return { insert: mockInsert };
      });
    });

    it('should register a new user successfully without image', async () => {
      const result = await service.register(registerDto);

      expect(mockUsersRepository.createProfile).toHaveBeenCalledWith({
        wallet: validWallet,
        username: 'testuser',
        displayName: 'Test User',
        avatarUrl: null,
      });
      expect(result.user.walletAddress).toBe(validWallet);
      expect(result.accessToken).toBeDefined();
    });

    it('should register a new user successfully with profile image', async () => {
      const mockFile = { originalname: 'avatar.png', buffer: Buffer.from('test'), mimetype: 'image/png' };
      const result = await service.register(registerDto, mockFile);

      expect(mockUsersRepository.uploadAvatar).toHaveBeenCalledWith(validWallet, mockFile);
      expect(mockUsersRepository.createProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          avatarUrl: 'https://example.com/avatar.png',
        }),
      );
      expect(result.user.avatarUrl).toBe('https://example.com/avatar.png');
    });

    it('should throw ConflictException (AUTH_WALLET_EXISTS) if DB unique constraint on wallet is violated', async () => {
      mockUsersRepository.createProfile.mockRejectedValueOnce(
        new ConflictException({ code: 'AUTH_WALLET_EXISTS', message: 'Wallet address is already registered.' }),
      );

      await expect(service.register(registerDto)).rejects.toMatchObject({
        response: { code: 'AUTH_WALLET_EXISTS' },
      });
    });

    it('should throw ConflictException (AUTH_USERNAME_TAKEN) if DB unique constraint on username is violated', async () => {
      mockUsersRepository.createProfile.mockRejectedValueOnce(
        new ConflictException({ code: 'AUTH_USERNAME_TAKEN', message: 'Username is already taken.' }),
      );

      await expect(service.register(registerDto)).rejects.toMatchObject({
        response: { code: 'AUTH_USERNAME_TAKEN' },
      });
    });

    it('should handle parallel duplicate-wallet registrations yielding exactly one success and one 409 AUTH_WALLET_EXISTS', async () => {
      mockUsersRepository.createProfile
        .mockResolvedValueOnce(mockUser)
        .mockRejectedValueOnce(
          new ConflictException({ code: 'AUTH_WALLET_EXISTS', message: 'Wallet address is already registered.' }),
        );

      const [res1, res2] = await Promise.allSettled([
        service.register(registerDto),
        service.register(registerDto),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      if (rejected[0].status === 'rejected') {
        expect(rejected[0].reason).toBeInstanceOf(ConflictException);
        expect((rejected[0].reason as ConflictException).getResponse()).toEqual({
          code: 'AUTH_WALLET_EXISTS',
          message: 'Wallet address is already registered.',
        });
      }
    });

    it('should handle parallel duplicate-username registrations yielding exactly one success and one 409 AUTH_USERNAME_TAKEN', async () => {
      const dto2 = { ...registerDto, walletAddress: 'GDIFFERENTWALLETHDHSKDHFKSHDFKSHDFKSHDFKSHDFKSH' };

      mockUsersRepository.createProfile
        .mockResolvedValueOnce(mockUser)
        .mockRejectedValueOnce(
          new ConflictException({ code: 'AUTH_USERNAME_TAKEN', message: 'Username is already taken.' }),
        );

      const [res1, res2] = await Promise.allSettled([
        service.register(registerDto),
        service.register(dto2),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      if (rejected[0].status === 'rejected') {
        expect(rejected[0].reason).toBeInstanceOf(ConflictException);
        expect((rejected[0].reason as ConflictException).getResponse()).toEqual({
          code: 'AUTH_USERNAME_TAKEN',
          message: 'Username is already taken.',
        });
      }
    });

    it('should return same structured 409 AUTH_WALLET_EXISTS on sequential re-registration', async () => {
      // First registration succeeds
      await service.register(registerDto);

      // Second registration fails on unique constraint
      mockUsersRepository.createProfile.mockRejectedValueOnce(
        new ConflictException({ code: 'AUTH_WALLET_EXISTS', message: 'Wallet address is already registered.' }),
      );

      await expect(service.register(registerDto)).rejects.toMatchObject({
        response: { code: 'AUTH_WALLET_EXISTS' },
      });
    });

    it('should clean up avatar from storage when registration fails after avatar upload', async () => {
      const mockFile = { originalname: 'avatar.png', buffer: Buffer.from('test'), mimetype: 'image/png' };
      mockUsersRepository.uploadAvatar.mockResolvedValue('https://example.com/avatar.png');
      mockUsersRepository.createProfile.mockRejectedValueOnce(
        new ConflictException({ code: 'AUTH_WALLET_EXISTS', message: 'Wallet address is already registered.' }),
      );

      await expect(service.register(registerDto, mockFile)).rejects.toThrow(ConflictException);

      expect(mockUsersRepository.deleteAvatar).toHaveBeenCalledWith('https://example.com/avatar.png');
    });

    it('should clean up both avatar and created user if downstream token issuance fails', async () => {
      const mockFile = { originalname: 'avatar.png', buffer: Buffer.from('test'), mimetype: 'image/png' };
      mockUsersRepository.uploadAvatar.mockResolvedValue('https://example.com/avatar.png');
      mockUsersRepository.createProfile.mockResolvedValue(mockUser);

      // Mock session creation failure during generateTokens
      mockFrom.mockImplementation((table: string) => {
        if (table === 'users') {
          return {
            upsert: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: { id: 'user-uuid', status: 'active' }, error: null }),
          };
        }
        if (table === 'learner_profiles') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            insert: jest.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === 'sessions') {
          return { insert: jest.fn().mockResolvedValue({ error: { message: 'Session failed' } }) };
        }
        return { insert: mockInsert };
      });

      await expect(service.register(registerDto, mockFile)).rejects.toThrow(InternalServerErrorException);

      expect(mockUsersRepository.deleteAvatar).toHaveBeenCalledWith('https://example.com/avatar.png');
      expect(mockUsersRepository.deleteUserById).toHaveBeenCalledWith('user-uuid');
    });
  });

  // ---------------------------------------------------------------------------
  // refreshTokens — rotation within session family + replay detection
  // ---------------------------------------------------------------------------
  describe('refreshTokens', () => {
    const refreshToken = 'valid.refresh.token';
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const familyId = '11111111-2222-3333-4444-555555555555';
    const futureExpiry = new Date(Date.now() + 60 * 1000).toISOString();

    function setupSessionMocks({
      payload = { wallet: validWallet, type: 'refresh', fam: familyId } as Record<string, string>,
      sessionLookup = { data: { id: 'session-uuid', family_id: familyId, expires_at: futureExpiry }, error: null },
      userStatus = 'active',
    } = {}) {
      const deleteEq = jest.fn().mockResolvedValue({ error: null, count: 1 });
      const deleteFn = jest.fn().mockReturnValue({ eq: deleteEq });
      mockJwtService.verify.mockReturnValue(payload);
      mockFrom.mockImplementation((table: string) => {
        if (table === 'users') {
          const chain: Record<string, jest.Mock> = {
            upsert: jest.fn(),
            select: jest.fn(),
            single: jest.fn().mockResolvedValue({ data: { id: 'user-uuid', status: userStatus }, error: null }),
          };
          chain.upsert.mockReturnValue(chain);
          chain.select.mockReturnValue(chain);
          return chain;
        }
        if (table === 'learner_profiles') {
          const chain: Record<string, jest.Mock> = {
            select: jest.fn(),
            eq: jest.fn(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            insert: jest.fn().mockResolvedValue({ error: null }),
          };
          chain.select.mockReturnValue(chain);
          chain.eq.mockReturnValue(chain);
          return chain;
        }
        if (table === 'sessions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue(sessionLookup),
            insert: jest.fn().mockResolvedValue({ error: null }),
            delete: deleteFn,
          };
        }
        return { insert: mockInsert };
      });
      return { deleteFn, deleteEq };
    }

    beforeEach(() => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'JWT_REFRESH_SECRET' ? 'refresh-secret' : 'mock-secret',
      );
      mockJwtService.verify.mockReturnValue({ wallet: validWallet, type: 'refresh', fam: familyId });
    });

    it('should rotate tokens into the same session family', async () => {
      setupSessionMocks();

      await service.refreshTokens(refreshToken);

      const refreshCall = mockJwtService.sign.mock.calls.find((c) => c[0].type === 'refresh');
      expect(refreshCall?.[0]).toMatchObject({ wallet: validWallet, fam: familyId });
    });

    it('should delete the presented session row on successful rotation', async () => {
      const { deleteEq } = setupSessionMocks();

      await service.refreshTokens(refreshToken);

      expect(deleteEq).toHaveBeenCalledWith('id', 'session-uuid');
    });

    it('should revoke the entire family and write an audit event when a rotated token is replayed', async () => {
      // Session row is gone — the token was already rotated.
      const { deleteFn } = setupSessionMocks({
        sessionLookup: { data: null, error: { message: 'No rows found' } },
      });

      await expect(service.refreshTokens(refreshToken)).rejects.toMatchObject({
        response: { code: 'AUTH_REFRESH_TOKEN_REUSED' },
      });

      expect(deleteFn).toHaveBeenCalledWith({ count: 'exact' });
      expect(mockAuditService.logWithBeforeAfter).toHaveBeenCalledWith(
        expect.objectContaining({
          actorWallet: validWallet,
          action: 'auth.refresh_token_reuse',
          resource: 'session',
          metadata: { family_id: familyId },
        }),
      );
    });

    it('should throw AUTH_SESSION_NOT_FOUND for an unknown legacy token without a family claim', async () => {
      setupSessionMocks({
        payload: { wallet: validWallet, type: 'refresh' },
        sessionLookup: { data: null, error: { message: 'No rows found' } },
      });

      await expect(service.refreshTokens(refreshToken)).rejects.toMatchObject({
        response: { code: 'AUTH_SESSION_NOT_FOUND' },
      });
      // No family claim → nothing to revoke, no audit event for the family.
      expect(mockAuditService.logWithBeforeAfter).not.toHaveBeenCalled();
    });

    it('should throw AUTH_SESSION_EXPIRED when the session row exists but has expired', async () => {
      setupSessionMocks({
        sessionLookup: {
          data: { id: 'session-uuid', family_id: familyId, expires_at: new Date(Date.now() - 1000).toISOString() },
          error: null,
        },
      });

      await expect(service.refreshTokens(refreshToken)).rejects.toMatchObject({
        response: { code: 'AUTH_SESSION_EXPIRED' },
      });
    });

    it('should throw AUTH_USER_BLOCKED when refreshing for a blocked user', async () => {
      setupSessionMocks({ userStatus: 'blocked' });

      await expect(service.refreshTokens(refreshToken)).rejects.toMatchObject({
        response: { code: 'AUTH_USER_BLOCKED' },
      });
    });

    it('should throw AUTH_REFRESH_TOKEN_INVALID when JWT verification fails', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refreshTokens('garbage')).rejects.toMatchObject({
        response: { code: 'AUTH_REFRESH_TOKEN_INVALID' },
      });
    });
  });
});
