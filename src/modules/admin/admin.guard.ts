import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  Logger,
  Optional,
} from '@nestjs/common';
import { UserStatusService } from '../auth/user-status.service';
import { AuditService } from './audit.service';
import { SupabaseService } from '../../database/supabase.client';

/**
 * Guard that enforces server-truth admin authorization for /admin routes.
 *
 * Rather than trusting the JWT role claim alone (which remains valid until token expiry),
 * this guard queries server truth (via UserStatusService / Supabase datastore) fresh for
 * req.user.wallet.
 *
 * Authorization rules:
 * - Unauthenticated / missing wallet => 401 Unauthorized (AUTH_TOKEN_INVALID)
 * - Blocked status => 401 Unauthorized (AUTH_USER_BLOCKED)
 * - Role is not explicitly 'admin' => 403 Forbidden (ADMIN_FORBIDDEN) & logs audit attempt
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(
    @Optional() private readonly userStatusService?: UserStatusService,
    @Optional() private readonly auditService?: AuditService,
    @Optional() private readonly supabaseService?: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: { wallet: string; role?: string | null };
      url?: string;
      method?: string;
    }>();

    const user = request.user;
    if (!user || !user.wallet) {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_INVALID',
        message: 'Invalid or missing access token.',
      });
    }

    const wallet = user.wallet;
    let status = 'active';
    let role: string | null = null;

    if (this.userStatusService) {
      const state = await this.userStatusService.getUserState(wallet);
      status = state.status;
      role = state.role;
    } else if (this.supabaseService) {
      try {
        const client = this.supabaseService.getServiceRoleClient();
        const { data } = await client
          .from('users')
          .select('status, role')
          .eq('wallet_address', wallet)
          .maybeSingle();
        if (data) {
          status = data.status ?? 'active';
          role = data.role ?? null;
        }
      } catch (err) {
        this.logger.error(`Database query for admin check failed for ${wallet}: ${(err as Error).message}`);
      }
    } else {
      role = user.role ?? null;
    }

    if (status === 'blocked') {
      throw new UnauthorizedException({
        code: 'AUTH_USER_BLOCKED',
        message: 'This account has been suspended.',
      });
    }

    if (role !== 'admin') {
      this.logger.warn(
        `Admin access denied: wallet ${wallet} (status: ${status}, role: ${role ?? 'none'}) attempted to access ${request.method ?? 'GET'} ${request.url ?? '/admin'}`,
      );

      if (this.auditService) {
        try {
          await this.auditService.log({
            actor_wallet: wallet,
            action: 'ADMIN_ACCESS_DENIED',
            resource: 'admin',
            resource_id: null,
            before_state: null,
            after_state: null,
            ip_address: null,
            user_agent: null,
            metadata: {
              path: request.url ?? null,
              method: request.method ?? null,
              attemptedRole: role,
              status,
            },
          });
        } catch (auditErr) {
          this.logger.error(
            `Failed to log denied admin attempt for ${wallet}: ${(auditErr as Error).message}`,
          );
        }
      }

      throw new ForbiddenException({
        code: 'ADMIN_FORBIDDEN',
        message: 'Forbidden. Explicit admin role required.',
      });
    }

    return true;
  }
}
