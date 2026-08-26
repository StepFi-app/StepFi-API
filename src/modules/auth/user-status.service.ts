import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.client';

/**
 * How long a user's status and role may be served from cache before re-checking
 * the database. This is the documented staleness bound for server-truth enforcement:
 * role changes or blocked wallets take effect within AT MOST this many seconds
 * (or immediately when invalidate() is called after role/status changes).
 */
export const USER_STATUS_CACHE_TTL_MS = 30_000;

interface CachedUserState {
  status: string;
  role: string | null;
  expiresAt: number;
}

/**
 * Short-TTL in-memory cache of user account status and role, consulted on every
 * authenticated request by JwtStrategy and RolesGuard so that authorization decisions
 * rely on server truth rather than un-enforced JWT claims.
 *
 * A local in-memory Map is used deliberately instead of Redis: checks run on every
 * request, one Redis round trip per request would double auth latency, and a 30s
 * staleness bound does not justify shared state. On multi-instance deployments each
 * instance maintains its own cache with the same bound.
 */
@Injectable()
export class UserStatusService {
  private readonly logger = new Logger(UserStatusService.name);
  private readonly cache = new Map<string, CachedUserState>();

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Returns the user's current status and role, serving from cache when fresh.
   * Never throws for DB errors — fails open so a database blip cannot lock out
   * every authenticated user; the failure is logged.
   */
  async getUserState(wallet: string): Promise<{ status: string; role: string | null }> {
    const cached = this.cache.get(wallet);
    if (cached && cached.expiresAt > Date.now()) {
      return { status: cached.status, role: cached.role };
    }
    let status = 'active';
    let role: string | null = null;
    try {
      const client = this.supabaseService.getServiceRoleClient();
      const { data, error } = await client
        .from('users')
        .select('status, role')
        .eq('wallet_address', wallet)
        .maybeSingle();
      if (!error && data) {
        if (data.status) status = data.status;
        if (data.role !== undefined) role = data.role ?? null;
      }
      if (error) {
        this.logger.error(`Failed to read user state for ${wallet}: ${error.message}`);
      }
    } catch (err) {
      this.logger.error(`User state lookup failed for ${wallet}`, err);
    }
    this.cache.set(wallet, { status, role, expiresAt: Date.now() + USER_STATUS_CACHE_TTL_MS });
    return { status, role };
  }

  /** Returns the user's status ('active', 'blocked', ...), serving from cache when fresh. */
  async getStatus(wallet: string): Promise<string> {
    const state = await this.getUserState(wallet);
    return state.status;
  }

  /** Returns the user's current role ('sponsor', 'vendor', 'mentor', null), serving from cache when fresh. */
  async getRole(wallet: string): Promise<string | null> {
    const state = await this.getUserState(wallet);
    return state.role;
  }

  /** Throws AUTH_USER_BLOCKED when the wallet's account is suspended. */
  async ensureNotBlocked(wallet: string): Promise<void> {
    const status = await this.getStatus(wallet);
    if (status === 'blocked') {
      throw new UnauthorizedException({ code: 'AUTH_USER_BLOCKED', message: 'This account has been suspended.' });
    }
  }

  /** Test/admin helper: drops cached state so the next check hits the DB. */
  invalidate(wallet: string): void {
    this.cache.delete(wallet);
  }
}

