import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from '../../../../src/auth/guards/api-key.guard';
import { SupabaseService } from '../../../../src/database/supabase.client';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let mockSupabaseClient: Record<string, jest.Mock>;
  let mockSupabaseService: { getServiceRoleClient: jest.Mock };
  let mockReflector: { get: jest.Mock };
  let mockContext: any;

  const activeKeyRecord = {
    id: 'key-uuid',
    vendor_id: 'vendor-uuid',
    name: 'Test Key',
    key_prefix: 'sfi_a1b2',
    key_hash: 'abc123hash',
    permissions: ['loans:read', 'loans:write'],
    is_active: true,
    last_used_at: null,
    expires_at: null,
    created_at: '2026-06-27T00:00:00Z',
    updated_at: '2026-06-27T00:00:00Z',
  };

  const validApiKey = 'sfi_' + 'a'.repeat(64);

  beforeEach(async () => {
    mockSupabaseClient = {
      from: jest.fn(),
    };

    mockSupabaseService = {
      getServiceRoleClient: jest.fn(() => mockSupabaseClient),
    };

    mockReflector = {
      get: jest.fn().mockReturnValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get<ApiKeyGuard>(ApiKeyGuard);

    mockContext = {
      switchToHttp: jest.fn().mockReturnThis(),
      getRequest: jest.fn(),
      getHandler: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // canActivate — basic scenarios
  // ---------------------------------------------------------------------------
  describe('canActivate', () => {
    function setupRequest(headers: Record<string, string | undefined>) {
      mockContext.switchToHttp.mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ headers }),
      });
    }

    function setupDbQuery(result: { data: any; error: any }) {
      const singleFn = jest.fn().mockResolvedValue(result);
      const eqFn = jest.fn().mockReturnValue({ single: singleFn });
      const selectFn = jest.fn().mockReturnValue({ eq: eqFn });
      const updateFn = jest.fn().mockResolvedValue({ error: null });
      const updateEqFn = jest.fn().mockReturnValue(updateFn);

      mockSupabaseClient.from.mockReturnValue({
        select: selectFn,
        update: jest.fn().mockReturnValue({ eq: updateEqFn }),
      });
    }

    it('should return true when X-API-Key is valid and active', async () => {
      setupRequest({ 'x-api-key': validApiKey });
      setupDbQuery({ data: activeKeyRecord, error: null });
      mockContext.getHandler.mockReturnValue(() => {});

      const result = await guard.canActivate(mockContext);
      expect(result).toBe(true);
    });

    it('should throw UnauthorizedException (API_KEY_MISSING) when X-API-Key header is absent', async () => {
      setupRequest({});

      await expect(guard.canActivate(mockContext)).rejects.toMatchObject({
        response: { code: 'API_KEY_MISSING' },
      });
    });

    it('should throw UnauthorizedException (API_KEY_MISSING) when X-API-Key is not a string', async () => {
      setupRequest({ 'x-api-key': ['key1', 'key2'] } as any);

      await expect(guard.canActivate(mockContext)).rejects.toMatchObject({
        response: { code: 'API_KEY_MISSING' },
      });
    });

    it('should throw UnauthorizedException (API_KEY_INVALID) when key_hash not found', async () => {
      setupRequest({ 'x-api-key': validApiKey });
      setupDbQuery({ data: null, error: { message: 'No rows found' } });
      mockContext.getHandler.mockReturnValue(() => {});

      await expect(guard.canActivate(mockContext)).rejects.toMatchObject({
        response: { code: 'API_KEY_INVALID' },
      });
    });

    it('should throw UnauthorizedException (API_KEY_INVALID) when database error occurs', async () => {
      setupRequest({ 'x-api-key': validApiKey });
      setupDbQuery({ data: null, error: { message: 'DB error' } });
      mockContext.getHandler.mockReturnValue(() => {});

      await expect(guard.canActivate(mockContext)).rejects.toMatchObject({
        response: { code: 'API_KEY_INVALID' },
      });
    });

    it('should throw UnauthorizedException (API_KEY_INACTIVE) when key is revoked', async () => {
      setupRequest({ 'x-api-key': validApiKey });
      setupDbQuery({
        data: { ...activeKeyRecord, is_active: false },
        error: null,
      });
      mockContext.getHandler.mockReturnValue(() => {});

      await expect(guard.canActivate(mockContext)).rejects.toMatchObject({
        response: { code: 'API_KEY_INACTIVE' },
      });
    });

    it('should throw UnauthorizedException (API_KEY_EXPIRED) when key is past expiry', async () => {
      setupRequest({ 'x-api-key': validApiKey });
      setupDbQuery({
        data: {
          ...activeKeyRecord,
          expires_at: new Date(Date.now() - 86400000).toISOString(),
        },
        error: null,
      });
      mockContext.getHandler.mockReturnValue(() => {});

      await expect(guard.canActivate(mockContext)).rejects.toMatchObject({
        response: { code: 'API_KEY_EXPIRED' },
      });
    });

    it('should not reject when expiry is in the future', async () => {
      setupRequest({ 'x-api-key': validApiKey });
      setupDbQuery({
        data: {
          ...activeKeyRecord,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
        error: null,
      });
      mockContext.getHandler.mockReturnValue(() => {});

      const result = await guard.canActivate(mockContext);
      expect(result).toBe(true);
    });

    it('should set request.apiKey with the key record', async () => {
      const request = { headers: { 'x-api-key': validApiKey } };
      mockContext.switchToHttp.mockReturnValue({
        getRequest: jest.fn().mockReturnValue(request),
      });
      setupDbQuery({ data: activeKeyRecord, error: null });
      mockContext.getHandler.mockReturnValue(() => {});

      await guard.canActivate(mockContext);
      expect(request).toHaveProperty('apiKey');
      expect((request as any).apiKey.id).toBe('key-uuid');
    });
  });

  // ---------------------------------------------------------------------------
  // canActivate — permission enforcement
  // ---------------------------------------------------------------------------
  describe('permission enforcement', () => {
    function setupRequest(headers: Record<string, string>) {
      mockContext.switchToHttp.mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ headers }),
      });
    }

    function setupDbQuery(result: { data: any; error: any }) {
      const singleFn = jest.fn().mockResolvedValue(result);
      const eqFn = jest.fn().mockReturnValue({ single: singleFn });
      const selectFn = jest.fn().mockReturnValue({ eq: eqFn });
      const updateFn = jest.fn().mockResolvedValue({ error: null });
      const updateEqFn = jest.fn().mockReturnValue(updateFn);

      mockSupabaseClient.from.mockReturnValue({
        select: selectFn,
        update: jest.fn().mockReturnValue({ eq: updateEqFn }),
      });
    }

    it('should pass when required permissions match key permissions', async () => {
      setupRequest({ 'x-api-key': validApiKey });
      setupDbQuery({ data: activeKeyRecord, error: null });
      mockReflector.get.mockReturnValue(['loans:read']);
      mockContext.getHandler.mockReturnValue(() => {});

      const result = await guard.canActivate(mockContext);
      expect(result).toBe(true);
    });

    it('should pass when key has any of the required permissions', async () => {
      setupRequest({ 'x-api-key': validApiKey });
      setupDbQuery({ data: activeKeyRecord, error: null });
      mockReflector.get.mockReturnValue(['loans:write', 'transactions:read']);
      mockContext.getHandler.mockReturnValue(() => {});

      const result = await guard.canActivate(mockContext);
      expect(result).toBe(true);
    });

    it('should throw ForbiddenException (API_KEY_INSUFFICIENT_PERMISSIONS) when key lacks required permissions', async () => {
      setupRequest({ 'x-api-key': validApiKey });
      setupDbQuery({ data: activeKeyRecord, error: null });
      mockReflector.get.mockReturnValue(['admin:write']);
      mockContext.getHandler.mockReturnValue(() => {});

      await expect(guard.canActivate(mockContext)).rejects.toMatchObject({
        response: { code: 'API_KEY_INSUFFICIENT_PERMISSIONS' },
      });
    });

    it('should pass when no permissions are required on the endpoint', async () => {
      setupRequest({ 'x-api-key': validApiKey });
      setupDbQuery({ data: activeKeyRecord, error: null });
      mockReflector.get.mockReturnValue(null);
      mockContext.getHandler.mockReturnValue(() => {});

      const result = await guard.canActivate(mockContext);
      expect(result).toBe(true);
    });

    it('should pass when required permissions is an empty array', async () => {
      setupRequest({ 'x-api-key': validApiKey });
      setupDbQuery({ data: activeKeyRecord, error: null });
      mockReflector.get.mockReturnValue([]);
      mockContext.getHandler.mockReturnValue(() => {});

      const result = await guard.canActivate(mockContext);
      expect(result).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // last_used_at update (fire-and-forget)
  // ---------------------------------------------------------------------------
  describe('last_used_at update', () => {
    function setupRequest(headers: Record<string, string>) {
      mockContext.switchToHttp.mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ headers }),
      });
    }

    it('should update last_used_at on successful authentication', async () => {
      setupRequest({ 'x-api-key': validApiKey });

      const singleFn = jest.fn().mockResolvedValue({ data: activeKeyRecord, error: null });
      const eqFn = jest.fn().mockReturnValue({ single: singleFn });
      const selectFn = jest.fn().mockReturnValue({ eq: eqFn });
      const updateEqFn = jest.fn().mockResolvedValue({ error: null });
      const updateFn = jest.fn().mockReturnValue({ eq: updateEqFn });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'api_keys') {
          return {
            select: selectFn,
            update: jest.fn().mockReturnValue({ eq: updateEqFn }),
          };
        }
        return { insert: jest.fn() };
      });

      mockContext.getHandler.mockReturnValue(() => {});

      await guard.canActivate(mockContext);
      expect(mockSupabaseService.getServiceRoleClient).toHaveBeenCalledTimes(2);
    });

    it('should not throw when last_used_at update fails (fire-and-forget)', async () => {
      setupRequest({ 'x-api-key': validApiKey });

      const singleFn = jest.fn().mockResolvedValue({ data: activeKeyRecord, error: null });
      const eqFn = jest.fn().mockReturnValue({ single: singleFn });
      const selectFn = jest.fn().mockReturnValue({ eq: eqFn });
      const updateEqFn = jest.fn().mockRejectedValue(new Error('Network error'));
      const updateFn = jest.fn().mockReturnValue({ eq: updateEqFn });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'api_keys') {
          return {
            select: selectFn,
            update: jest.fn().mockReturnValue({ eq: updateEqFn }),
          };
        }
        return { insert: jest.fn() };
      });

      mockContext.getHandler.mockReturnValue(() => {});

      const result = await guard.canActivate(mockContext);
      expect(result).toBe(true);
    });
  });
});
