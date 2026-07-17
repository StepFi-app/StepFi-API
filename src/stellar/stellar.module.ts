import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SorobanService } from '../blockchain/soroban/soroban.service';
import { HorizonClientService } from './horizon-client.service';
import { StellarService } from './stellar.service';
import { CreditLineContractClient } from './contracts/clients/creditline.client';
import { ReputationContractClient } from './contracts/clients/reputation.client';
import { LiquidityPoolContractClient } from './contracts/clients/liquidity-pool.client';
import { VendorRegistryContractClient } from './contracts/clients/vendor-registry.client';
import { ParametersContractClient } from './contracts/clients/parameters.client';

@Module({
  imports: [ConfigModule],
  providers: [
    HorizonClientService,
    StellarService,
    SorobanService,
    CreditLineContractClient,
    ReputationContractClient,
    LiquidityPoolContractClient,
    VendorRegistryContractClient,
    ParametersContractClient,
  ],
  exports: [
    HorizonClientService,
    StellarService,
    SorobanService,
    CreditLineContractClient,
    ReputationContractClient,
    LiquidityPoolContractClient,
    VendorRegistryContractClient,
    ParametersContractClient,
  ],
})
export class StellarModule {}
