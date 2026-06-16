import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SorobanService } from '../../../blockchain/soroban/soroban.service';
import { REPUTATION_CONTRACT_ID_KEY } from '../interfaces/reputation.interface';
import { ContractNotConfiguredError, ContractReadError } from '../errors';

@Injectable()
export class ReputationContractClient {
  private readonly logger = new Logger(ReputationContractClient.name);
  private readonly contractId: string;

  constructor(
    private readonly sorobanService: SorobanService,
    private readonly configService: ConfigService,
  ) {
    this.contractId = this.configService.get<string>(REPUTATION_CONTRACT_ID_KEY) || '';

    if (this.contractId) {
      this.logger.log(`Reputation contract loaded: ${this.contractId.slice(0, 8)}...`);
    } else {
      this.logger.warn(`${REPUTATION_CONTRACT_ID_KEY} is not set — contract calls will fail`);
    }
  }

  async getScore(wallet: string): Promise<number | null> {
    if (!this.contractId) {
      throw new ContractNotConfiguredError('Reputation contract');
    }

    const addressScVal = StellarSdk.nativeToScVal(StellarSdk.Address.fromString(wallet), {
      type: 'address',
    });

    try {
      const resultScVal = await this.sorobanService.simulateContractCall(
        this.contractId,
        'get_score',
        [addressScVal],
      );

      const score = StellarSdk.scValToNative(resultScVal);

      if (score === undefined || score === null) {
        return null;
      }

      return Number(score);
    } catch (error) {
      if (
        error.message?.includes('HostError') ||
        error.message?.includes('Status(ContractError')
      ) {
        this.logger.debug(`No on-chain score for wallet ${wallet.slice(0, 8)}...`);
        return null;
      }
      this.logger.error(`Failed to get reputation score for ${wallet.slice(0, 8)}...: ${error.message}`);
      throw new ContractReadError('reputation score');
    }
  }
}
