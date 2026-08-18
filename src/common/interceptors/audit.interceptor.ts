import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
<<<<<<< Updated upstream
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../../modules/admin/audit.service';
import { AUDIT_ACTION_KEY, AuditActionOptions } from '../decorators/audit-action.decorator';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auditAction = this.reflector.get<AuditActionOptions>(
      AUDIT_ACTION_KEY,
      context.getHandler(),
    );

    if (!auditAction) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest & { user?: { wallet: string } }>();
    const user = request.user;
    const actorWallet = user?.wallet ?? 'system';
    const body = request.body ?? {};
    const params = request.params as Record<string, unknown>;
    const query = request.query ?? {};
    const resourceId =
      (params?.id as string) ??
      (params?.resourceId as string) ??
      (body && typeof body === 'object' && 'id' in body ? (body as Record<string, unknown>).id as string : null);

    const logEntry = {
      actor_wallet: actorWallet,
      action: auditAction.action,
      resource: auditAction.resource,
      resource_id: resourceId ?? null,
      before_state: null,
      after_state: body && typeof body === 'object' && Object.keys(body).length > 0 ? body : null,
      ip_address: request.ip ?? null,
      user_agent: (request.headers?.['user-agent'] as string) ?? null,
      metadata: { params, query },
    };

    return next.handle().pipe(
      tap((responseBody: unknown) => {
        const afterState = responseBody
          && typeof responseBody === 'object'
          && 'data' in (responseBody as Record<string, unknown>)
          ? (responseBody as Record<string, unknown>).data
          : responseBody ?? logEntry.after_state;

        this.auditService
          .log({
            ...logEntry,
            after_state: afterState as Record<string, unknown> | null,
          })
          .catch((err: Error) => {
            console.error('Failed to persist audit log:', err);
          });
=======
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUDIT_ACTION_KEY } from '../decorators/audit-action.decorator';

/**
 * Audit log interceptor.
 *
 * Inspects execution context for @AuditAction metadata. If present, logs the
 * privileged action attempt and execution outcome alongside acting wallet and route params.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const action = this.reflector.get<string>(AUDIT_ACTION_KEY, context.getHandler());

    if (!action) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const userWallet = request.user?.wallet ?? 'anonymous';
    const params = request.params;

    this.logger.log({
      event: 'AUDIT_ACTION_INITIATED',
      action,
      actor: userWallet,
      params,
      timestamp: new Date().toISOString(),
    });

    return next.handle().pipe(
      tap(() => {
        this.logger.log({
          event: 'AUDIT_ACTION_SUCCESS',
          action,
          actor: userWallet,
          targetId: params?.id,
          timestamp: new Date().toISOString(),
        });
>>>>>>> Stashed changes
      }),
    );
  }
}
