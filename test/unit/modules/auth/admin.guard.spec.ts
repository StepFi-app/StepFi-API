jest.unmock('stellar-sdk');

import { ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair } from 'stellar-sdk';
import { AdminGuard } from '../../../../src/auth/guards/admin.guard';

function contextFor(wallet?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: wallet ? { wallet } : undefined }),
    }),
  } as ExecutionContext;
}

describe('AdminGuard', () => {
  const allowedWallet = Keypair.random().publicKey();
  const otherWallet = Keypair.random().publicKey();

  it('allows an authenticated wallet on the allowlist', () => {
    const guard = new AdminGuard(
      new ConfigService({ ADMIN_WALLETS: allowedWallet }),
    );

    expect(guard.canActivate(contextFor(allowedWallet))).toBe(true);
  });

  it('returns a generic 403 for an authenticated wallet not on the allowlist', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const guard = new AdminGuard(
      new ConfigService({ ADMIN_WALLETS: allowedWallet }),
    );

    expect(() => guard.canActivate(contextFor(otherWallet))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextFor(otherWallet))).toThrow(
      expect.objectContaining({
        response: {
          code: 'AUTH_ADMIN_FORBIDDEN',
          message: 'Admin access required.',
        },
      }),
    );
    expect(warn).toHaveBeenCalledWith(`Admin access denied for wallet ${otherWallet}`);
  });

  it.each([undefined, ''])('denies everyone when ADMIN_WALLETS is %p', (value) => {
    const guard = new AdminGuard(new ConfigService({ ADMIN_WALLETS: value }));

    expect(() => guard.canActivate(contextFor(allowedWallet))).toThrow(ForbiddenException);
  });

  it('fails closed when no authenticated user is attached to the request', () => {
    const guard = new AdminGuard(
      new ConfigService({ ADMIN_WALLETS: allowedWallet }),
    );

    expect(() => guard.canActivate(contextFor())).toThrow(ForbiddenException);
  });
});
