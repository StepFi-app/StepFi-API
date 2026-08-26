import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { AuthService } from '../../../../src/modules/auth/auth.service';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { UsersRepository } from '../../../../src/database/repositories/users.repository';
import { AuditService } from '../../../../src/modules/admin/audit.service';

// Mock Stellar SDK to avoid real crypto operations in unit tests
jest.mock('stellar-sdk', () => ({
  Keypair: { fromPublicKey: jest.fn() },
  StrKey: { isValidEd25519PublicKey: jest.fn().mockReturnValue(true) },
}));

import { Keypair, StrKey } from 'stellar-sdk';

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
    get: jest.fn().mockReturnValue('mock-secret'),
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

  beforeEach(async () => {
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
    mockConfigService.get.mockReturnValue('mock-secret');
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
    it('should return nonce and expiresAt', async () => {
      const result = await service.generateNonce(validWallet);

      expect(result).toHaveProperty('nonce');
      expect(result).toHaveProperty('expiresAt');
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

    it('should store nonce in database with correct data', async () => {
      await service.generateNonce(validWallet);

      expect(mockSupabaseService.getServiceRoleClient).toHaveBeenCalled();
      expect(mockFrom).toHaveBeenCalledWith('nonces');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          wallet_address: validWallet,
          nonce: expect.any(String),
          expires_at: expect.any(String),
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
  // verifySignature — validates nonce + Ed25519 signature, marks nonce used
  // ---------------------------------------------------------------------------
  describe('verifySignature', () => {
    const validNonce = 'a1b2c3d4e5f67890abcdef1234567890a1b2c3d4e5f67890abcdef1234567890';
    const validSignature = Buffer.alloc(64).toString('base64');
    const futureExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const defaultNonceRecord = { id: 'nonce-uuid', expires_at: futureExpiry };

    function setupMocks({
      nonceResult = { data: defaultNonceRecord, error: null },
      markUsedResult = { error: null },
      signatureValid = true,
      strKeyValid = true,
    } = {}) {
      const mockKeypair = { verify: jest.fn().mockReturnValue(signatureValid) };
      (Keypair.fromPublicKey as jest.Mock).mockReturnValue(mockKeypair);
      (StrKey.isValidEd25519PublicKey as jest.Mock).mockReturnValue(strKeyValid);

      mockFrom.mockImplementation((table: string) => {
        if (table === 'nonces') {
          const updateChain = { eq: jest.fn().mockResolvedValue(markUsedResult) };
          const chain: Record<string, jest.Mock> = {
            select: jest.fn(),
            eq: jest.fn(),
            is: jest.fn(),
            single: jest.fn().mockResolvedValue(nonceResult),
            update: jest.fn().mockReturnValue(updateChain),
          };
          chain.select.mockReturnValue(chain);
          chain.eq.mockReturnValue(chain);
          chain.is.mockReturnValue(chain);
          return chain;
        }
        return { insert: mockInsert };
      });

      return { mockKeypair };
    }

    const validDto = { wallet: validWallet, nonce: validNonce, signature: validSignature };

    it('should resolve without error when nonce and signature are valid', async () => {
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

    it('should throw UnauthorizedException (AUTH_NONCE_EXPIRED) when nonce is past expiry', async () => {
      const expiredDate = new Date(Date.now() - 1000).toISOString();
      setupMocks({
        nonceResult: { data: { id: 'nonce-uuid', expires_at: expiredDate }, error: null },
      });

      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_NONCE_EXPIRED' },
      });
    });

    it('should throw UnauthorizedException (AUTH_SIGNATURE_INVALID) when StrKey validation fails', async () => {
      setupMocks({ strKeyValid: false });

      await expect(service.verifySignature(validDto)).rejects.toMatchObject({
        response: { code: 'AUTH_SIGNATURE_INVALID' },
      });
    });

    it('should throw UnauthorizedException (AUTH_SIGNATURE_INVALID) when signature does not verify', async () => {
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

    it('should verify signature using Stellar Keypair with nonce bytes and base64 signature', async () => {
      const { mockKeypair } = setupMocks();
      await service.verifySignature(validDto);

      expect(Keypair.fromPublicKey).toHaveBeenCalledWith(validWallet);
      expect(mockKeypair.verify).toHaveBeenCalledWith(
        Buffer.from(validNonce),
        Buffer.from(validSignature, 'base64'),
      );
    });

    it('should verify using SEP-0043 if raw verification fails', async () => {
      const { mockKeypair } = setupMocks({ signatureValid: false });
      // First call (raw) returns false, second call (sep0043) should return true
      mockKeypair.verify.mockImplementationOnce(() => false).mockImplementationOnce(() => true);

      await expect(service.verifySignature(validDto)).resolves.toBeUndefined();

      expect(Keypair.fromPublicKey).toHaveBeenCalledWith(validWallet);
      expect(mockKeypair.verify).toHaveBeenCalledWith(Buffer.from(validNonce), Buffer.from(validSignature, 'base64'));
      expect(mockKeypair.verify).toHaveBeenCalledWith(
        Buffer.from('Stellar Signing Key: ' + validNonce),
        Buffer.from(validSignature, 'base64'),
      );
    });

    it('should mark nonce as used after successful verification', async () => {
      const { } = setupMocks();
      await service.verifySignature(validDto);

      expect(mockFrom).toHaveBeenCalledWith('nonces');
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
