export const LIQUIDITY_POOL_CONTRACT_ID_KEY = 'LIQUIDITY_POOL_CONTRACT_ID';

export interface PoolStats {
  totalLiquidity: bigint;
  lockedLiquidity: bigint;
  availableLiquidity: bigint;
  totalShares: bigint;
  sharePrice: bigint;
  withdrawalFeeBps: bigint;
}

export interface ILiquidityPoolClient {
  getLpShares(wallet: string): Promise<bigint>;

  getPoolStats(): Promise<PoolStats>;

  calculateWithdrawal(sharesInStroops: bigint): Promise<bigint>;

  calculateDeposit(amountInStroops: bigint): Promise<bigint>;

  buildDepositTx(userWallet: string, amountInStroops: bigint): Promise<string>;

  buildWithdrawTx(
    userWallet: string,
    sharesInStroops: bigint,
  ): Promise<string>;
}
