import { ServiceUnavailableException } from '@nestjs/common';

export class ContractNotConfiguredError extends ServiceUnavailableException {
  constructor(contractName: string) {
    super({
      code: 'BLOCKCHAIN_CONTRACT_NOT_CONFIGURED',
      message: `${contractName} is not configured. Please contact support.`,
    });
  }
}

export class ContractSimulationError extends ServiceUnavailableException {
  constructor(operation: string) {
    super({
      code: 'BLOCKCHAIN_SIMULATION_FAILED',
      message: `Failed to simulate ${operation}. Please try again later.`,
    });
  }
}

export class ContractReadError extends ServiceUnavailableException {
  constructor(label: string) {
    super({
      code: 'BLOCKCHAIN_CONTRACT_READ_FAILED',
      message: `Failed to read ${label} from the contract. Please try again later.`,
    });
  }
}

export class ContractTxBuildError extends ServiceUnavailableException {
  constructor(operation: string) {
    super({
      code: 'BLOCKCHAIN_TX_BUILD_FAILED',
      message: `Failed to construct ${operation} transaction. Please try again later.`,
    });
  }
}
