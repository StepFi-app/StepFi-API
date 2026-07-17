import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'audit_action';

export interface AuditActionOptions {
  resource: string;
  action: string;
}

export const AuditAction = (resource: string, action: string) =>
  SetMetadata(AUDIT_ACTION_KEY, { resource, action } as AuditActionOptions);
