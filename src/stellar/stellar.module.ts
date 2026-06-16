import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SorobanService } from '../blockchain/soroban/soroban.service';
import { CreditLineContractClient } from './contracts/clients/creditline.client';
import { ReputationContractClient } from './contracts/clients/reputation.client';
import { LiquidityPoolContractClient } from './contracts/clients/liquidity-pool.client';
import { VendorRegistryContractClient } from './contracts/clients/vendor-registry.client';
import { ParametersContractClient } from './contracts/clients/parameters.client';

@Module({
  imports: [ConfigModule],
  providers: [
    SorobanService,
    CreditLineContractClient,
    ReputationContractClient,
    LiquidityPoolContractClient,
    VendorRegistryContractClient,
    ParametersContractClient,
  ],
  exports: [
    SorobanService,
    CreditLineContractClient,
    ReputationContractClient,
    LiquidityPoolContractClient,
    VendorRegistryContractClient,
    ParametersContractClient,
  ],
})
export class StellarModule {}
