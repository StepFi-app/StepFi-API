import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { UserStatusService } from './user-status.service';
import { ApiKeyGuard } from '../../auth/guards/api-key.guard';
import { SupabaseService } from '../../database/supabase.client';
import { UsersRepository } from '../../database/repositories/users.repository';
import { getJwtConfig } from '../../config/jwt.config';
import { AdminModule } from '../admin/admin.module';

import { RolesGuard } from '../../auth/guards/roles.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getJwtConfig,
    }),
    AdminModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, UserStatusService, ApiKeyGuard, RolesGuard, SupabaseService, ConfigService, UsersRepository],
  exports: [AuthService, JwtStrategy, UserStatusService, ApiKeyGuard, RolesGuard, PassportModule],
})
export class AuthModule {}
