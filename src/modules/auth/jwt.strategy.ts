import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

interface JwtPayload {
  wallet: string;
  type: string;
  role?: string | null;
  iat: number;
  exp: number;
}

/**
 * Passport JWT strategy for validating access tokens.
 *
 * Extracts the Bearer token from the Authorization header, verifies its
 * signature using JWT_SECRET, and returns the wallet address as req.user.
 *
 * Only tokens with type === 'access' are accepted to prevent refresh tokens
 * from being used to authenticate API requests.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  /**
   * Called by Passport after the token signature is verified.
   * The returned value is injected into req.user.
   *
   * @param payload - Decoded JWT payload
   * @returns User object containing the wallet address
   */
  validate(payload: JwtPayload): { wallet: string; role: string | null } {
    if (payload.type !== 'access') {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_INVALID',
        message: 'Invalid or missing access token.',
      });
    }

    // Tokens issued before the role claim existed simply carry role: null;
    // RolesGuard will deny role-gated routes until the client refreshes.
    return { wallet: payload.wallet, role: payload.role ?? null };
  }
}
