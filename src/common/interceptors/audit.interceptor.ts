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

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const actionMeta = this.reflector.get<any>(AUDIT_ACTION_KEY, context.getHandler());

    if (!actionMeta) {
      return next.handle();
    }

    const action =
      typeof actionMeta === 'string'
        ? actionMeta
        : `${(actionMeta as Record<string, string>).resource ?? ''}.${(actionMeta as Record<string, string>).action ?? ''}`;

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
      }),
    );
  }
}
