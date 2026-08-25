import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../../database/supabase.client';
import { AUDIT_ACTION_KEY } from '../../common/decorators/audit-action.decorator';
import { formatAuditAction } from '../../common/interceptors/audit.interceptor';

type AuthenticatedRequest = {
  user?: {
    wallet?: string;
    role?: string | null;
  };
  method?: string;
  url?: string;
  params?: Record<string, unknown>;
};

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger('AuditInterceptor');

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const action = this.resolveAction(context, request);
    const wallet = request.user?.wallet;

    if (!wallet) {
      this.logDeniedAttempt({
        action,
        wallet: 'anonymous',
        reason: 'UNAUTHENTICATED',
        request,
      });
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_INVALID',
        message: 'Invalid or missing access token.',
      });
    }

    const client = this.supabaseService.getServiceRoleClient();
    const { data: user, error } = await client
      .from('users')
      .select('wallet_address, role, status')
      .eq('wallet_address', wallet)
      .maybeSingle();

    if (error) {
      this.logger.error({
        event: 'ADMIN_AUTH_LOOKUP_FAILED',
        action,
        actor: wallet,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      throw new InternalServerErrorException({
        code: 'ADMIN_AUTH_LOOKUP_FAILED',
        message: 'Failed to verify admin access.',
      });
    }

    const role = user?.role ?? null;
    const status = user?.status ?? null;

    if (!user || role !== 'admin' || status === 'blocked') {
      this.logDeniedAttempt({
        action,
        wallet,
        reason: !user ? 'USER_NOT_FOUND' : status === 'blocked' ? 'BLOCKED' : 'NOT_ADMIN',
        request,
        tokenRole: request.user?.role ?? null,
        dbRole: role,
        dbStatus: status,
      });

      throw new ForbiddenException({
        code: 'ADMIN_FORBIDDEN',
        message: 'Admin access required.',
      });
    }

    return true;
  }

  private resolveAction(context: ExecutionContext, request: AuthenticatedRequest): string {
    const actionMeta = this.reflector.getAllAndOverride<unknown>(AUDIT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const action = formatAuditAction(actionMeta);
    if (action !== 'unknown') {
      return action;
    }

    const method = request.method ?? 'UNKNOWN';
    const url = request.url ?? 'unknown';
    return `${method} ${url}`;
  }

  private logDeniedAttempt(params: {
    action: string;
    wallet: string;
    reason: string;
    request: AuthenticatedRequest;
    tokenRole?: string | null;
    dbRole?: string | null;
    dbStatus?: string | null;
  }): void {
    this.logger.warn({
      event: 'AUDIT_ACTION_DENIED',
      action: params.action,
      actor: params.wallet,
      reason: params.reason,
      tokenRole: params.tokenRole ?? null,
      dbRole: params.dbRole ?? null,
      dbStatus: params.dbStatus ?? null,
      params: params.request.params ?? {},
      timestamp: new Date().toISOString(),
    });
  }
}
