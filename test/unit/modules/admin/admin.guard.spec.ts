import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from '../../../../src/modules/admin/admin.guard';
import { UserStatusService } from '../../../../src/modules/auth/user-status.service';
import { AuditService } from '../../../../src/modules/admin/audit.service';

describe('AdminGuard (src/modules/admin/admin.guard.ts)', () => {
  let guard: AdminGuard;
  let userStatusService: jest.Mocked<UserStatusService>;
  let auditService: jest.Mocked<AuditService>;

  const ADMIN_WALLET = 'GAQWQJJBC2D5YCR6WUFFZSL6DIFJ5CA4774QB6QWPRNHSUUVRNQ2BHXJ';
  const SPONSOR_WALLET = 'GBXH6BL5Z7R5Y6RJSJRMJQH4YZVMYTCX2L4X2L4X2L4X2L4X2L4X2L4X';
  const BLOCKED_ADMIN_WALLET = 'GDBLOCKEDADMINWALLET12345678901234567890123456789012345678';

  function createMockExecutionContext(user?: { wallet: string; role?: string | null }) {
    const request = {
      user,
      url: '/admin/audit-logs',
      method: 'GET',
    };
    return {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(request),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    userStatusService = {
      getUserState: jest.fn(),
      getStatus: jest.fn(),
      getRole: jest.fn(),
      ensureNotBlocked: jest.fn(),
      invalidate: jest.fn(),
    } as unknown as jest.Mocked<UserStatusService>;

    auditService = {
      log: jest.fn().mockResolvedValue(undefined),
      logWithBeforeAfter: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn(),
    } as unknown as jest.Mocked<AuditService>;

    guard = new AdminGuard(userStatusService, auditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return true for an active admin wallet', async () => {
    userStatusService.getUserState.mockResolvedValue({ status: 'active', role: 'admin' });
    const ctx = createMockExecutionContext({ wallet: ADMIN_WALLET });

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(userStatusService.getUserState).toHaveBeenCalledWith(ADMIN_WALLET);
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('should throw 403 (ADMIN_FORBIDDEN) for a non-admin wallet', async () => {
    userStatusService.getUserState.mockResolvedValue({ status: 'active', role: 'sponsor' });
    const ctx = createMockExecutionContext({ wallet: SPONSOR_WALLET });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'ADMIN_FORBIDDEN' },
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_wallet: SPONSOR_WALLET,
        action: 'ADMIN_ACCESS_DENIED',
        resource: 'admin',
      }),
    );
  });

  it('should throw 401 (AUTH_USER_BLOCKED) for a blocked admin wallet', async () => {
    userStatusService.getUserState.mockResolvedValue({ status: 'blocked', role: 'admin' });
    const ctx = createMockExecutionContext({ wallet: BLOCKED_ADMIN_WALLET });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'AUTH_USER_BLOCKED' },
    });
  });

  it('should throw 401 (AUTH_TOKEN_INVALID) when request user or wallet is missing', async () => {
    const ctxUnauthenticated = createMockExecutionContext(undefined);

    await expect(guard.canActivate(ctxUnauthenticated)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctxUnauthenticated)).rejects.toMatchObject({
      response: { code: 'AUTH_TOKEN_INVALID' },
    });
  });

  it('should throw 403 (ADMIN_FORBIDDEN) for a stale token with admin role claim when DB role is revoked', async () => {
    // JWT claim says 'admin', but server truth in Supabase/UserStatusService is now null / revoked
    userStatusService.getUserState.mockResolvedValue({ status: 'active', role: null });
    const ctx = createMockExecutionContext({ wallet: SPONSOR_WALLET, role: 'admin' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: 'ADMIN_FORBIDDEN' },
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_wallet: SPONSOR_WALLET,
        action: 'ADMIN_ACCESS_DENIED',
      }),
    );
  });
});
