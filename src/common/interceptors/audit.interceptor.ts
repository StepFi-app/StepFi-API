import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
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

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
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
      }),
    );
  }
}
