import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Admin authentication and authorization guard.
 *
 * Checks that the user is authenticated via JwtAuthGuard and that their wallet
 * is present in the ADMIN_WALLETS environment variable allowlist.
 *
 * Throws 401 Unauthorized if unauthenticated.
 * Throws 403 Forbidden if authenticated wallet is not an allowlisted admin.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.wallet) {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_INVALID',
        message: 'Invalid or missing access token.',
      });
    }

    const adminWalletsRaw = this.configService.get<string>('ADMIN_WALLETS') || '';
    const adminWallets = adminWalletsRaw
      .split(',')
      .map((w) => w.trim())
      .filter((w) => w.length > 0);

    const isAllowlisted = adminWallets.includes(user.wallet);

    if (!isAllowlisted) {
      throw new ForbiddenException({
        code: 'ADMIN_ACCESS_REQUIRED',
        message: 'This operation requires admin privileges.',
      });
    }

    return true;
  }
}
