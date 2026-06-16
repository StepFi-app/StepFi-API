import { 
  Controller, 
  Post, 
  Body, 
  HttpCode, 
  HttpStatus, 
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  UseInterceptors, 
  UploadedFile, 
  ParseFilePipe, 
  MaxFileSizeValidator, 
  FileTypeValidator 
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { NonceRequestDto } from './dto/nonce-request.dto';
import { NonceResponseDto } from './dto/nonce-response.dto';
import { VerifyRequestDto } from './dto/verify-request.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RegisterRequestDto } from './dto/register-request.dto';

class OptionalProfileImageInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle();
  }
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new user account with complete profile' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: RegisterRequestDto })
  @ApiResponse({ status: 201, description: 'User successfully registered and authenticated' })
  @ApiResponse({ status: 400, description: 'Validation failed or invalid image' })
  @ApiResponse({ status: 409, description: 'Wallet address or username already exists' })
  @UseInterceptors(OptionalProfileImageInterceptor)
  async register(
    @Body() dto: RegisterRequestDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /(jpg|jpeg|png|webp)$/i }),
        ],
        fileIsRequired: false,
      }),
    )
    profileImage?: any,
  ): Promise<any> {
    return this.authService.register(dto, profileImage);
  }

  @Post('nonce')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Generate nonce for wallet authentication' })
  @ApiResponse({ status: 201, description: 'Nonce generated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid wallet address format' })
  async getNonce(@Body() dto: NonceRequestDto): Promise<NonceResponseDto> {
    return this.authService.generateNonce(dto.wallet);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify wallet signature and issue JWT tokens' })
  @ApiResponse({ status: 200, description: 'Signature verified — JWT tokens issued', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid signature or nonce' })
  async verify(@Body() dto: VerifyRequestDto): Promise<AuthResponseDto> {
    await this.authService.verifySignature(dto);
    return this.authService.generateTokens(dto.wallet);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiBody({ schema: { type: 'object', properties: { refreshToken: { type: 'string', description: 'JWT refresh token obtained from POST /auth/verify' } }, required: ['refreshToken'] } })
  @ApiResponse({ status: 200, description: 'New tokens issued', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Refresh token invalid or expired' })
  async refresh(@Body('refreshToken') token: string): Promise<AuthResponseDto> {
    return this.authService.refreshTokens(token);
  }
}
