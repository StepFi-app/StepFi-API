import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { AdminGuard } from '../../../../src/auth/guards/admin.guard';
import { AUDIT_ACTION_KEY } from '../../../../src/common/decorators/audit-action.decorator';
import { AuditInterceptor } from '../../../../src/common/interceptors/audit.interceptor';
import { JwtAuthGuard } from '../../../../src/common/guards/jwt-auth.guard';
import { VendorsController } from '../../../../src/modules/vendors/vendors.controller';

describe('VendorsController admin status routes', () => {
  it.each([
    ['approveVendor', 'APPROVE_VENDOR'],
    ['suspendVendor', 'SUSPEND_VENDOR'],
  ] as const)('protects and audits %s', (method, auditAction) => {
    const handler = VendorsController.prototype[method];
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as Array<new (...args: never[]) => unknown>;
    const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, handler) as Array<new (...args: never[]) => unknown>;

    expect(guards).toEqual([JwtAuthGuard, AdminGuard]);
    expect(interceptors).toEqual([AuditInterceptor]);
    expect(Reflect.getMetadata(AUDIT_ACTION_KEY, handler)).toEqual({
      resource: 'vendors',
      action: auditAction,
    });
  });
});
