import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { getAdminWallets } from '../../config/env';

/**
 * Guard that restricts access to wallets listed in the ADMIN_WALLETS
 * environment variable. Must be applied AFTER JwtAuthGuard so that
 * req.user is populated.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, AdminGuard)
 *
 * Design notes:
 * - Admin status is derived from the allowlist only; there is no "admin"
 *   role in USER_ROLES, so it cannot be self-assigned via POST /users/me/role.
 * - An unset or empty ADMIN_WALLETS denies all admin access rather than
 *   granting it — a config mistake cannot silently open the gate.
 * - The 403 response body is generic and does not leak the allowlist
 *   contents or its size.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: { wallet: string; role?: string | null };
    }>();

    const wallet = request.user?.wallet;

    if (!wallet) {
      throw new ForbiddenException({
        code: 'AUTH_WALLET_MISSING',
        message: 'Forbidden.',
      });
    }

    const allowlist = getAdminWallets();

    if (allowlist.length === 0) {
      this.logger.warn(
        `Admin access denied: ADMIN_WALLETS is unset or empty (wallet: ${wallet})`,
      );
      throw new ForbiddenException({
        code: 'ADMIN_ACCESS_DENIED',
        message: 'Forbidden.',
      });
    }

    if (!allowlist.includes(wallet)) {
      this.logger.warn(
        `Admin access denied: wallet not in allowlist (wallet: ${wallet})`,
      );
      throw new ForbiddenException({
        code: 'ADMIN_ACCESS_DENIED',
        message: 'Forbidden.',
      });
    }

    return true;
  }
}
