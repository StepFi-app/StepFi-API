import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SorobanService } from '../../../blockchain/soroban/soroban.service';
import {
  ProtocolParameters,
  PARAMETERS_CONTRACT_ID_KEY,
} from '../interfaces/parameters.interface';
import { ContractNotConfiguredError, ContractReadError } from '../errors';

@Injectable()
export class ParametersContractClient {
  private readonly logger = new Logger(ParametersContractClient.name);
  private readonly contractId: string;

  constructor(
    private readonly sorobanService: SorobanService,
    private readonly configService: ConfigService,
  ) {
    this.contractId = this.configService.get<string>(PARAMETERS_CONTRACT_ID_KEY) || '';

    if (this.contractId) {
      this.logger.log(`Parameters contract loaded: ${this.contractId.slice(0, 8)}...`);
    } else {
      this.logger.warn(`${PARAMETERS_CONTRACT_ID_KEY} is not set - contract calls will fail`);
    }
  }

  async getInterestRateBps(): Promise<number> {
    return this.readU32('get_interest_rate_bps', 'interest rate BPS');
  }

  async getGracePeriod(): Promise<number> {
    return this.readU32('get_grace_period', 'grace period');
  }

  async getMinReputation(): Promise<number> {
    return this.readU32('get_min_reputation', 'minimum reputation');
  }

  async getAllParameters(): Promise<ProtocolParameters> {
    if (!this.contractId) {
      throw new ContractNotConfiguredError('Parameters contract');
    }

    try {
      const result = await this.sorobanService.simulateContractCall(
        this.contractId,
        'get_all_parameters',
        [],
      );
      const raw = StellarSdk.scValToNative(result) as Record<string, unknown>;

      return {
        interestRateBps: Number(raw['interest_rate_bps'] ?? 0),
        gracePeriod: Number(raw['grace_period'] ?? 0),
        minReputation: Number(raw['min_reputation'] ?? 0),
      };
    } catch (error) {
      this.logger.error(`Failed to read all parameters: ${error.message}`);
      throw new ContractReadError('all protocol parameters');
    }
  }

  private async readU32(method: string, label: string): Promise<number> {
    if (!this.contractId) {
      throw new ContractNotConfiguredError('Parameters contract');
    }

    try {
      const result = await this.sorobanService.simulateContractCall(
        this.contractId,
        method,
        [],
      );
      return Number(StellarSdk.scValToNative(result));
    } catch (error) {
      this.logger.error(`Failed to read ${label}: ${error.message}`);
      throw new ContractReadError(label);
    }
  }
}
