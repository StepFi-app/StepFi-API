import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DefaultDetectionProcessor } from './default-detection.processor';
import { SupabaseService } from '../database/supabase.client';
import { StellarModule } from '../stellar/stellar.module';
import { TransactionsModule } from '../modules/transactions/transactions.module';

@Module({
  imports: [ConfigModule, StellarModule, TransactionsModule],
  providers: [DefaultDetectionProcessor, SupabaseService],
})
export class JobsModule {}
