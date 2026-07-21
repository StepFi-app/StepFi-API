import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { SupabaseService } from '../database/supabase.client';
import { getJwtConfig } from '../config/jwt.config';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getJwtConfig,
    }),
  ],
  providers: [RealtimeGateway, RealtimeService, SupabaseService],
  exports: [RealtimeService, RealtimeGateway],
})
export class RealtimeModule {}
