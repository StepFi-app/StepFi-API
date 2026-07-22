import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SorobanService } from './soroban/soroban.service';
import { LiquidityContractClient } from './contracts/liquidity-contract.client';

@Module({
  imports: [ConfigModule],
  providers: [SorobanService, LiquidityContractClient],
  exports: [SorobanService, LiquidityContractClient],
})
export class BlockchainModule {}
