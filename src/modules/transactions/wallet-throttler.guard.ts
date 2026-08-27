import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * ThrottlerGuard variant that keys rate limits on the authenticated wallet
 * (from the JWT payload) instead of the client IP. Used alongside the global
 * IP-based guard so POST /transactions/submit is bounded per wallet AND per
 * IP, preventing a single wallet from being used as an open relay to Horizon.
 */
@Injectable()
export class WalletThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: { user?: { wallet?: string } }): Promise<string> {
    const wallet = req.user?.wallet;
    return wallet ? `wallet:${wallet}` : super.getTracker(req);
  }
}
