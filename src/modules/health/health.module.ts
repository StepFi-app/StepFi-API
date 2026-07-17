import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StellarModule } from '../../stellar/stellar.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { SupabaseService } from '../../database/supabase.client';

@Module({
  imports: [
    StellarModule,
    BullModule.registerQueue(
      { name: 'blockchain-indexer' },
      { name: 'payment-reminders' },
      { name: 'transaction-status-checker' },
      { name: 'nonce-cleanup' },
    ),
  ],
  controllers: [HealthController],
  providers: [HealthService, SupabaseService],
})
export class HealthModule {}
