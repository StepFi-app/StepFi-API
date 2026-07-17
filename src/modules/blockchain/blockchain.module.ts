import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BlockchainService } from './blockchain.service';
import { SequenceManagerModule } from '../../blockchain/sequence-manager/sequence-manager.module';

@Module({
  imports: [ConfigModule, SequenceManagerModule],
  providers: [BlockchainService],
  exports: [BlockchainService],
})
export class BlockchainModule {}
