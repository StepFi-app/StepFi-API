import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TransactionStatusCheckerService } from './transaction-status-checker.service';
import { SupabaseService } from '../../database/supabase.client';

@Module({
  imports: [ConfigModule],
  providers: [TransactionStatusCheckerService, SupabaseService],
})
export class TransactionStatusCheckerModule {}
