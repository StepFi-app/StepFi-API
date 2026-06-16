import { Injectable } from '@nestjs/common';
import type { PoolStats } from '../interfaces/liquidity-pool.interface';

@Injectable()
export class MockLiquidityPoolContractClient {
  getLpShares = jest.fn(
    async (_wallet: string): Promise<bigint> => 100_000_000n,
  );

  getPoolStats = jest.fn(
    async (): Promise<PoolStats> => ({
      totalLiquidity: 10_000_000_000n,
      lockedLiquidity: 3_000_000_000n,
      availableLiquidity: 7_000_000_000n,
      totalShares: 1_000_000_000n,
      sharePrice: 10_000n,
      withdrawalFeeBps: 50n,
    }),
  );

  calculateWithdrawal = jest.fn(
    async (sharesInStroops: bigint): Promise<bigint> =>
      (sharesInStroops * 10_000_000_000n) / 1_000_000_000n,
  );

  calculateDeposit = jest.fn(
    async (amountInStroops: bigint): Promise<bigint> =>
      (amountInStroops * 1_000_000_000n) / 10_000_000_000n,
  );

  buildDepositTx = jest.fn(
    async (_userWallet: string, _amountInStroops: bigint): Promise<string> => {
      return 'AAAAAgAAAQAAAAAAAAAAiZ3TgwAAAAAyMZyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
    },
  );

  buildWithdrawTx = jest.fn(
    async (_userWallet: string, _sharesInStroops: bigint): Promise<string> => {
      return 'AAAAAgAAAQAAAAAAAAAAiZ3TgwAAAAAyMZyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
    },
  );
}
