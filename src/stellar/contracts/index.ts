export { CreditLineContractClient } from './clients/creditline.client';
export { ReputationContractClient } from './clients/reputation.client';
export { LiquidityPoolContractClient } from './clients/liquidity-pool.client';
export { VendorRegistryContractClient } from './clients/vendor-registry.client';
export { ParametersContractClient } from './clients/parameters.client';

export { MockCreditLineContractClient } from './mocks/creditline.mock';
export { MockReputationContractClient } from './mocks/reputation.mock';
export { MockLiquidityPoolContractClient } from './mocks/liquidity-pool.mock';
export { MockVendorRegistryContractClient } from './mocks/vendor-registry.mock';
export { MockParametersContractClient } from './mocks/parameters.mock';

export type {
  CreateLoanParams,
  PoolStats,
  VendorInfo,
  ProtocolParameters,
} from './interfaces';

export {
  CREDIT_LINE_CONTRACT_ID_KEY,
  REPUTATION_CONTRACT_ID_KEY,
  LIQUIDITY_POOL_CONTRACT_ID_KEY,
  VENDOR_REGISTRY_CONTRACT_ID_KEY,
  PARAMETERS_CONTRACT_ID_KEY,
} from './interfaces';

export {
  ContractNotConfiguredError,
  ContractSimulationError,
  ContractReadError,
  ContractTxBuildError,
} from './errors';
