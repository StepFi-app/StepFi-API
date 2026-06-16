export const REPUTATION_CONTRACT_ID_KEY = 'REPUTATION_CONTRACT_ID';

export interface IReputationClient {
  getScore(wallet: string): Promise<number | null>;
}
