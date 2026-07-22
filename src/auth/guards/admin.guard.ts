import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseAdminWallets } from '../../config/env';

interface AuthenticatedRequest {
  user?: { wallet?: string };
}

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);
  private readonly adminWallets: ReadonlySet<string>;

  constructor(configService: ConfigService) {
    this.adminWallets = new Set(parseAdminWallets(configService.get<string>('ADMIN_WALLETS')));
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const wallet = request.user?.wallet;

    if (!wallet || !this.adminWallets.has(wallet)) {
      this.logger.warn(`Admin access denied for wallet ${wallet ?? 'unknown'}`);
      throw new ForbiddenException({
        code: 'AUTH_ADMIN_FORBIDDEN',
        message: 'Admin access required.',
      });
    }

    return true;
  }
}
