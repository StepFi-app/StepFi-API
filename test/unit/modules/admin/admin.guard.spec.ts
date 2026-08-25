import { Logger, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminGuard } from '../../../../src/modules/admin/admin.guard';
import { SupabaseService } from '../../../../src/database/supabase.client';

describe('AdminGuard', () => {
  let guard: AdminGuard;
  let warnSpy: jest.SpyInstance;

  const allowedWallet = 'GAQWQJJBC2D5YCR6WUFFZSL6DIFJ5CA4774QB6QWPRNHSUUVRNQ2BHXJ';
  const nonAdminWallet = 'GBXH6BL5Z7R5Y6RJSJRMJQH4YZVMYTCX2L4X2L4X2L4X2L4X2L4X2L4X';

  const mockMaybeSingle = jest.fn();
  const mockEq = jest.fn().mockReturnThis();
  const mockSelect = jest.fn().mockReturnThis();
  const mockFrom = jest.fn().mockReturnValue({
    select: mockSelect,
    eq: mockEq,
    maybeSingle: mockMaybeSingle,
  });
  const mockSupabaseService = {
    getServiceRoleClient: jest.fn().mockReturnValue({
      from: mockFrom,
    }),
  } as unknown as SupabaseService;

  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue('audit_logs.VIEW_AUDIT_LOGS'),
  } as unknown as Reflector;

  function createContext(user?: { wallet?: string; role?: string | null }, url = '/admin/audit-logs') {
    const request = {
      user,
      url,
      method: 'GET',
      params: {},
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => jest.fn(),
      getClass: () => ({ name: 'AuditController' }),
    } as never;
  }

  beforeEach(() => {
    guard = new AdminGuard(mockSupabaseService, reflector);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows a wallet whose latest Supabase row is admin and active', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { wallet_address: allowedWallet, role: 'admin', status: 'active' },
      error: null,
    });

    await expect(guard.canActivate(createContext({ wallet: allowedWallet, role: 'vendor' }))).resolves.toBe(true);
    expect(mockSupabaseService.getServiceRoleClient).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledWith('users');
    expect(mockSelect).toHaveBeenCalledWith('wallet_address, role, status');
    expect(mockEq).toHaveBeenCalledWith('wallet_address', allowedWallet);
  });

  it('denies a non-admin wallet even if the JWT role claim says admin', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { wallet_address: nonAdminWallet, role: 'vendor', status: 'active' },
      error: null,
    });

    const ctx = createContext({ wallet: nonAdminWallet, role: 'admin' });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ADMIN_FORBIDDEN' }),
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'AUDIT_ACTION_DENIED',
        actor: nonAdminWallet,
        reason: 'NOT_ADMIN',
        tokenRole: 'admin',
        dbRole: 'vendor',
        dbStatus: 'active',
      }),
    );
  });

  it('denies a blocked admin', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { wallet_address: allowedWallet, role: 'admin', status: 'blocked' },
      error: null,
    });

    await expect(guard.canActivate(createContext({ wallet: allowedWallet, role: 'admin' }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ADMIN_FORBIDDEN' }),
    });
  });

  it('denies a stale token whose role claim says admin after the user was revoked in Supabase', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { wallet_address: allowedWallet, role: 'vendor', status: 'active' },
      error: null,
    });

    await expect(guard.canActivate(createContext({ wallet: allowedWallet, role: 'admin' }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ADMIN_FORBIDDEN' }),
    });
  });

  it('denies unauthenticated requests with a 401', async () => {
    await expect(guard.canActivate(createContext(undefined))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AUTH_TOKEN_INVALID' }),
    });
  });

  it('surfaces a Supabase lookup failure as a server error', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'database unavailable' },
    });

    await expect(guard.canActivate(createContext({ wallet: allowedWallet, role: 'admin' }))).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
