import { ForbiddenException, Logger } from '@nestjs/common';
import { AdminGuard } from '../../../../src/auth/guards/admin.guard';
import * as env from '../../../../src/config/env';

const ALLOWED_WALLET = 'GAQWQJJBC2D5YCR6WUFFZSL6DIFJ5CA4774QB6QWPRNHSUUVRNQ2BHXJ';
const OTHER_WALLET = 'GBXH6BL5Z7R5Y6RJSJRMJQH4YZVMYTCX2L4X2L4X2L4X2L4X2L4X2L4X';

describe('AdminGuard', () => {
  let guard: AdminGuard;
  let warnSpy: jest.SpyInstance;

  function createContext(user?: { wallet: string }) {
    const request = { user };
    return {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(request),
      }),
    } as never;
  }

  beforeEach(() => {
    guard = new AdminGuard();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('allowlisted wallet', () => {
    it('should return true for a wallet on the allowlist', () => {
      jest.spyOn(env, 'getAdminWallets').mockReturnValue([ALLOWED_WALLET]);
      const ctx = createContext({ wallet: ALLOWED_WALLET });

      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('non-allowlisted wallet', () => {
    it('should throw ForbiddenException for a wallet not on the allowlist', () => {
      jest.spyOn(env, 'getAdminWallets').mockReturnValue([ALLOWED_WALLET]);
      const ctx = createContext({ wallet: OTHER_WALLET });

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(ctx)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'ADMIN_ACCESS_DENIED' }),
        }),
      );
    });

    it('should not disclose allowlist contents in the response body', () => {
      jest.spyOn(env, 'getAdminWallets').mockReturnValue([ALLOWED_WALLET]);
      const ctx = createContext({ wallet: OTHER_WALLET });

      try {
        guard.canActivate(ctx);
        fail('Should have thrown');
      } catch (e) {
        const body = (e as ForbiddenException).getResponse() as Record<string, unknown>;
        const bodyStr = JSON.stringify(body);
        expect(bodyStr).not.toContain(ALLOWED_WALLET);
        expect(bodyStr).not.toContain('wallets');
        expect(bodyStr).not.toContain('allowlist');
      }
    });

    it('should log the denied wallet address', () => {
      jest.spyOn(env, 'getAdminWallets').mockReturnValue([ALLOWED_WALLET]);
      const ctx = createContext({ wallet: OTHER_WALLET });

      try {
        guard.canActivate(ctx);
        fail('Should have thrown');
      } catch {
        expect(warnSpy).toHaveBeenCalledWith(
          `Admin access denied: wallet not in allowlist (wallet: ${OTHER_WALLET})`,
        );
      }
    });
  });

  describe('empty or unset ADMIN_WALLETS', () => {
    it('should deny everyone when ADMIN_WALLETS is empty', () => {
      jest.spyOn(env, 'getAdminWallets').mockReturnValue([]);
      const ctx = createContext({ wallet: ALLOWED_WALLET });

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(ctx)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'ADMIN_ACCESS_DENIED' }),
        }),
      );
    });

    it('should deny everyone when ADMIN_WALLETS is unset (empty array)', () => {
      jest.spyOn(env, 'getAdminWallets').mockReturnValue([]);
      const ctx = createContext({ wallet: OTHER_WALLET });

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should log the denial when allowlist is empty', () => {
      jest.spyOn(env, 'getAdminWallets').mockReturnValue([]);
      const ctx = createContext({ wallet: ALLOWED_WALLET });

      try {
        guard.canActivate(ctx);
        fail('Should have thrown');
      } catch {
        expect(warnSpy).toHaveBeenCalledWith(
          `Admin access denied: ADMIN_WALLETS is unset or empty (wallet: ${ALLOWED_WALLET})`,
        );
      }
    });
  });

  describe('unauthenticated request (no user)', () => {
    it('should throw ForbiddenException when req.user is undefined', () => {
      jest.spyOn(env, 'getAdminWallets').mockReturnValue([ALLOWED_WALLET]);
      const ctx = createContext(undefined);

      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(ctx)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'AUTH_WALLET_MISSING' }),
        }),
      );
    });
  });
});
