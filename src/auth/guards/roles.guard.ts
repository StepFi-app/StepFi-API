import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';

/**
 * Route decorator declaring which user roles may access a handler.
 * Must be combined with JwtAuthGuard so req.user is populated first:
 *
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles('sponsor')
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Enforces the role claim carried in the JWT (set by JwtStrategy.validate).
 *
 * - Routes without @Roles metadata are unaffected.
 * - Tokens without a role claim (role not chosen yet, or token issued
 *   before the role was set) are rejected with 403; the client must call
 *   POST /auth/refresh after setting a role to obtain the claim.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: { wallet: string; role?: string | null } }>();

    if (!user?.role || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException({
        code: 'AUTH_ROLE_FORBIDDEN',
        message: `This action requires one of the following roles: ${requiredRoles.join(', ')}. If you just selected your role, refresh your access token.`,
      });
    }
    return true;
  }
}
