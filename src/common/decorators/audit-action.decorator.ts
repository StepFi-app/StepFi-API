import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'audit_action';

<<<<<<< Updated upstream
export interface AuditActionOptions {
  resource: string;
  action: string;
}

export const AuditAction = (resource: string, action: string) =>
  SetMetadata(AUDIT_ACTION_KEY, { resource, action } as AuditActionOptions);
=======
/**
 * Decorator to flag a controller method for audit logging.
 *
 * @param action - Descriptive audit action name, e.g., 'vendor.approve'
 */
export const AuditAction = (action: string) => SetMetadata(AUDIT_ACTION_KEY, action);
>>>>>>> Stashed changes
