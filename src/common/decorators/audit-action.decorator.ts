import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'audit_action';

export const AuditAction = (actionOrResource: string, actionName?: string) => {
  const action = actionName ? `${actionOrResource}.${actionName}` : actionOrResource;
  return SetMetadata(AUDIT_ACTION_KEY, action);
};
