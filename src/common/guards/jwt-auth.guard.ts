import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT authentication guard.
 *
 * Extends Passport's AuthGuard('jwt') which delegates to JwtStrategy.
 * handleRequest() catches Passport errors and maps them to structured
 * UnauthorizedException responses with error codes.
 *
 * Usage: Apply @UseGuards(JwtAuthGuard) to any protected endpoint.
 * The authenticated wallet address is then accessible via @CurrentUser().
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(err: unknown, user: TUser, info: { name?: string } | undefined): TUser {
    if (info?.name === 'TokenExpiredError') {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_EXPIRED',
        message: 'Access token has expired. Please refresh your token.',
      });
    }
    if (err || !user) {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_INVALID',
        message: 'Invalid or missing access token.',
      });
    }
    return user;
  }
}