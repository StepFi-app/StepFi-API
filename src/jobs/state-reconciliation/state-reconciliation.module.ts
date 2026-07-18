import { Module } from '@nestjs/common';
import { IndexerModule } from '../../indexer/indexer.module';
import { LoansModule } from '../../modules/loans/loans.module';
import { TransactionsModule } from '../../modules/transactions/transactions.module';
import { SupabaseService } from '../../database/supabase.client';
import { StateReconciliationProcessor } from './state-reconciliation.processor';

@Module({
  imports: [IndexerModule, LoansModule, TransactionsModule],
  providers: [StateReconciliationProcessor, SupabaseService],
})
export class StateReconciliationModule {}
