import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { AuthModule } from '../auth/auth.module';
import { SupabaseService } from '../../database/supabase.client';
import { getRedisConfig } from '../../config/redis.config';
import { TransactionsRepository } from './transactions.repository';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getRedisConfig,
    }),
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService, TransactionsRepository, SupabaseService],
  exports: [TransactionsService, TransactionsRepository],
})
export class TransactionsModule {}
