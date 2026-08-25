import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUDIT_ACTION_KEY } from '../decorators/audit-action.decorator';

export function formatAuditAction(actionMeta: unknown): string {
  if (!actionMeta) {
    return 'unknown';
  }

  if (typeof actionMeta === 'string') {
    return actionMeta;
  }

  const meta = actionMeta as { resource?: string; action?: string };
  return `${meta.resource ?? ''}.${meta.action ?? ''}`;
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const actionMeta = this.reflector.get<unknown>(AUDIT_ACTION_KEY, context.getHandler());
    const action = formatAuditAction(actionMeta);

    const request = context.switchToHttp().getRequest();
    const userWallet = request.user?.wallet ?? 'anonymous';
    const params = request.params;

    if (action === 'unknown') {
      return next.handle();
    }

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
      }),
    );
  }
}
