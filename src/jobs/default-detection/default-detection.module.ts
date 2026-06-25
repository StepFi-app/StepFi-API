import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { DefaultDetectionService } from './default-detection.service';
import { DefaultDetectionProcessor } from './default-detection.processor';
import { SupabaseService } from '../../database/supabase.client';
import { StellarModule } from '../../stellar/stellar.module';
import { BlockchainService } from '../../modules/blockchain/blockchain.service';

@Module({
  imports: [
    ConfigModule,
    StellarModule,
    BullModule.registerQueue({ name: 'default-detection' }),
  ],
  providers: [
    DefaultDetectionService,
    DefaultDetectionProcessor,
    SupabaseService,
    BlockchainService,
  ],
})
export class DefaultDetectionModule {}
