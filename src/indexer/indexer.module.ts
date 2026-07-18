import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IndexerService } from './indexer.service';
import { EventParserService } from './event-parser.service';
import { SupabaseService } from '../database/supabase.client';
import { StellarModule } from '../stellar/stellar.module';
import { IndexerController } from './indexer.controller';
import { IndexerStatusService } from './indexer-status.service';
import { AuthoritativeStateReader } from './authoritative-state.reader';

@Module({
  imports: [ConfigModule, StellarModule],
  controllers: [IndexerController],
  providers: [
    IndexerService,
    EventParserService,
    SupabaseService,
    IndexerStatusService,
    AuthoritativeStateReader,
  ],
  exports: [AuthoritativeStateReader],
})
export class IndexerModule {}
