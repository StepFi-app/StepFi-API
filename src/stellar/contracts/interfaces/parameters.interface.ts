export const PARAMETERS_CONTRACT_ID_KEY = 'PARAMETERS_CONTRACT_ID';

export interface ProtocolParameters {
  interestRateBps: number;
  gracePeriod: number;
  minReputation: number;
}

export interface IParametersClient {
  getInterestRateBps(): Promise<number>;

  getGracePeriod(): Promise<number>;

  getMinReputation(): Promise<number>;

  getAllParameters(): Promise<ProtocolParameters>;
}
