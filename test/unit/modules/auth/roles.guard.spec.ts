import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard, ROLES_KEY } from '../../../../src/auth/guards/roles.guard';
import { UserStatusService } from '../../../../src/modules/auth/user-status.service';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;
  let userStatusService: UserStatusService;

  const mockUserStatusService = {
    getRole: jest.fn(),
    getUserState: jest.fn(),
    invalidate: jest.fn(),
  };

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

  function createMockExecutionContext(userPayload?: { wallet: string; role?: string | null }, handlerRoles?: string[]): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: userPayload,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesGuard,
        Reflector,
        { provide: UserStatusService, useValue: mockUserStatusService },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get<Reflector>(Reflector);
    userStatusService = module.get<UserStatusService>(UserStatusService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow access if no roles metadata is set on route', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockExecutionContext({ wallet: validWallet, role: 'vendor' });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(mockUserStatusService.getRole).not.toHaveBeenCalled();
  });

  it('should allow access if datastore role matches required role', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['vendor']);
    mockUserStatusService.getRole.mockResolvedValue('vendor');
    const context = createMockExecutionContext({ wallet: validWallet, role: 'vendor' });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(mockUserStatusService.getRole).toHaveBeenCalledWith(validWallet);
  });

  it('should reject access (403 AUTH_ROLE_FORBIDDEN) if JWT has role but datastore role is null/different (stale token attack)', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['vendor']);
    // Datastore role was reset to null by admin
    mockUserStatusService.getRole.mockResolvedValue(null);
    // User presents old JWT with role: 'vendor'
    const context = createMockExecutionContext({ wallet: validWallet, role: 'vendor' });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { code: 'AUTH_ROLE_FORBIDDEN' },
    });
  });

  it('should reject access (403 AUTH_ROLE_FORBIDDEN) if user role was downgraded in datastore', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['sponsor']);
    mockUserStatusService.getRole.mockResolvedValue('vendor'); // Changed in DB
    const context = createMockExecutionContext({ wallet: validWallet, role: 'sponsor' });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('should reject access (403 AUTH_ROLE_FORBIDDEN) if req.user is missing', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['vendor']);
    const context = createMockExecutionContext(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });
});
