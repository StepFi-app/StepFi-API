import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as redisStore from 'cache-manager-redis-store';
import { LiquidityController } from './liquidity.controller';
import { LiquidityService } from './liquidity.service';
import { AuthModule } from '../auth/auth.module';
import { SupabaseService } from '../../database/supabase.client';
import { BlockchainModule } from '../../blockchain/blockchain.module';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    BlockchainModule,
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        store: redisStore,
        url: configService.get<string>('REDIS_URL', 'redis://localhost:6379'),
      }),
    }),
  ],
  controllers: [LiquidityController],
  providers: [LiquidityService, SupabaseService],
  exports: [LiquidityService],
})
export class LiquidityModule {}
