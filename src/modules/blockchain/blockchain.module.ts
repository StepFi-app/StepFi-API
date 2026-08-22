import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BlockchainService } from './blockchain.service';
import { BlockchainController } from './blockchain.controller';
import { SupabaseService } from '../../database/supabase.client';

@Module({
  imports: [ConfigModule],
  controllers: [BlockchainController],
  providers: [BlockchainService, SupabaseService],
  exports: [BlockchainService],
})
export class BlockchainModule {}
