import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { BlockchainIndexerService } from './blockchain-indexer.service';
import { BlockchainIndexerProcessor } from './blockchain-indexer.processor';
import { EventParserService } from './event-parser.service';
import { SupabaseService } from '../../database/supabase.client';
import { StellarModule } from '../../stellar/stellar.module';

@Module({
  imports: [
    ConfigModule,
    StellarModule,
    BullModule.registerQueue({ name: 'blockchain-indexer' }),
  ],
  providers: [
    BlockchainIndexerService,
    BlockchainIndexerProcessor,
    EventParserService,
    SupabaseService,
  ],
})
export class BlockchainIndexerModule {}
