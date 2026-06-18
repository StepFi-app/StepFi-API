import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { IndexerService } from './indexer.service';
import { IndexerProcessor } from './indexer.processor';
import { EventParserService } from './event-parser.service';
import { SupabaseService } from '../database/supabase.client';
import { StellarModule } from '../stellar/stellar.module';
import { IndexerController } from './indexer.controller';
import { IndexerStatusService } from './indexer-status.service';

@Module({
  imports: [
    ConfigModule,
    StellarModule,
    BullModule.registerQueue({ name: 'blockchain-indexer' }),
  ],
  controllers: [IndexerController],
  providers: [
    IndexerService,
    IndexerProcessor,
    EventParserService,
    SupabaseService,
    IndexerStatusService,
  ],
})
export class IndexerModule {}
