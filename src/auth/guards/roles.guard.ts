import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatusService } from '../../modules/auth/user-status.service';

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
 * Enforces user role authorization based on server truth in the datastore
 * (resolved via short-TTL cached UserStatusService).
 *
 * - Routes without @Roles metadata are unaffected.
 * - The JWT role claim is treated as a hint only; live datastore role is enforced.
 * - Roles revoked or changed server-side take effect within USER_STATUS_CACHE_TTL_MS (30s)
 *   or immediately upon cache invalidation.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly userStatusService?: UserStatusService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: { wallet: string; role?: string | null } }>();

    if (!user) {
      throw new ForbiddenException({
        code: 'AUTH_ROLE_FORBIDDEN',
        message: `This action requires one of the following roles: ${requiredRoles.join(', ')}.`,
      });
    }

    let currentRole: string | null = null;
    if (this.userStatusService && user.wallet) {
      currentRole = await this.userStatusService.getRole(user.wallet);
    } else {
      currentRole = user.role ?? null;
    }

    if (!currentRole || !requiredRoles.includes(currentRole)) {
      throw new ForbiddenException({
        code: 'AUTH_ROLE_FORBIDDEN',
        message: `This action requires one of the following roles: ${requiredRoles.join(', ')}. If you just selected your role, refresh your access token.`,
      });
    }
    return true;
  }
}


