import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { SequenceManagerService } from './sequence-manager.service';
import { AuthModule } from '../auth/auth.module';
import { SupabaseService } from '../../database/supabase.client';
import { getRedisConfig } from '../../config/redis.config';

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
  providers: [TransactionsService, SequenceManagerService, SupabaseService],
  exports: [TransactionsService, SequenceManagerService],
})
export class TransactionsModule {}
