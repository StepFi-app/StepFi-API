import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { SupabaseService } from '../../database/supabase.client';

@Module({
  imports: [
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
