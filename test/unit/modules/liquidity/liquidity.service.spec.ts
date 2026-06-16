import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, HttpException } from '@nestjs/common';
import { LiquidityService } from '../../../../src/modules/liquidity/liquidity.service';
import { LiquidityPoolContractClient } from '../../../../src/stellar/contracts/clients/liquidity-pool.client';
import { MockLiquidityPoolContractClient } from '../../../../src/stellar/contracts/mocks/liquidity-pool.mock';
import { SupabaseService } from '../../../../src/database/supabase.client';

describe('LiquidityService', () => {
  let service: LiquidityService;
  let mockLiquidityPoolContractClient: MockLiquidityPoolContractClient;

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
  const STROOPS = 10_000_000n;

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const mockSupabaseFrom = {
    select: jest.fn(),
    eq: jest.fn(),
    single: jest.fn(),
  };

  const mockSupabaseClient = {
    from: jest.fn(),
  };

  const mockSupabaseService = {
    getServiceRoleClient: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidityService,
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: LiquidityPoolContractClient, useClass: MockLiquidityPoolContractClient },
      ],
    }).compile();

    service = module.get<LiquidityService>(LiquidityService);
    mockLiquidityPoolContractClient = module.get<MockLiquidityPoolContractClient>(LiquidityPoolContractClient);
    jest.clearAllMocks();

    mockSupabaseService.getServiceRoleClient.mockReturnValue(mockSupabaseClient);
    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table === 'loans') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({
            data: [
              { loan_amount: 800, interest_rate: 8 },
              { loan_amount: 200, interest_rate: 10 },
            ],
            error: null,
          }),
        };
      }

      if (table === 'liquidity_positions') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { deposited_amount: 1000 },
            error: null,
          }),
        };
      }

      return mockSupabaseFrom;
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('depositLiquidity', () => {
    it('should build a deposit transaction and preview', async () => {
      mockLiquidityPoolContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 100000n * STROOPS,
        lockedLiquidity: 90000n * STROOPS,
        availableLiquidity: 10000n * STROOPS,
        totalShares: 95000n * STROOPS,
        sharePrice: 10500n,
        withdrawalFeeBps: 50n,
      });
      mockLiquidityPoolContractClient.calculateDeposit.mockResolvedValue(4761904761n);
      mockLiquidityPoolContractClient.buildDepositTx.mockResolvedValue('AAAAAgDEPOSIT...');

      const result = await service.depositLiquidity(validWallet, { amount: 500 });

      expect(result).toEqual({
        unsignedXdr: 'AAAAAgDEPOSIT...',
        description: 'Deposit $500 into liquidity pool',
        preview: {
          depositAmount: 500,
          sharesReceived: 476.1904761,
          currentSharePrice: 1.05,
          newTotalValue: 100500,
          currentTotalLiquidity: 100000,
        },
      });
      expect(mockLiquidityPoolContractClient.buildDepositTx).toHaveBeenCalledWith(
        validWallet,
        500n * STROOPS,
      );
    });

    it('should default share price to 1 for the first deposit', async () => {
      mockLiquidityPoolContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 0n,
        lockedLiquidity: 0n,
        availableLiquidity: 0n,
        totalShares: 0n,
        sharePrice: 0n,
        withdrawalFeeBps: 0n,
      });
      mockLiquidityPoolContractClient.calculateDeposit.mockResolvedValue(100n * STROOPS);
      mockLiquidityPoolContractClient.buildDepositTx.mockResolvedValue('AAAAAgDEPOSIT...');

      const result = await service.depositLiquidity(validWallet, { amount: 100 });

      expect(result.preview.currentSharePrice).toBe(1);
      expect(result.preview.sharesReceived).toBe(100);
      expect(result.preview.currentTotalLiquidity).toBe(0);
    });

    it('should reject deposit amounts below minimum threshold', async () => {
      await expect(service.depositLiquidity(validWallet, { amount: 9.99 })).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.depositLiquidity(validWallet, { amount: 9.99 })).rejects.toMatchObject({
        response: {
          code: 'VALIDATION_MINIMUM_DEPOSIT',
        },
      });

      expect(mockLiquidityPoolContractClient.getPoolStats).not.toHaveBeenCalled();
    });

    it('should surface pool read errors from contract client', async () => {
      mockLiquidityPoolContractClient.getPoolStats.mockRejectedValue(new Error('pool unavailable'));

      await expect(service.depositLiquidity(validWallet, { amount: 200 })).rejects.toThrow(
        'pool unavailable',
      );
    });
  });

  describe('withdrawLiquidity', () => {
    it('should construct an unsigned XDR and preview for a valid partial withdrawal', async () => {
      mockLiquidityPoolContractClient.getLpShares.mockResolvedValue(925n * STROOPS);
      mockLiquidityPoolContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 100000n * STROOPS,
        lockedLiquidity: 98500n * STROOPS,
        availableLiquidity: 1500n * STROOPS,
        totalShares: 92500n * STROOPS,
        sharePrice: 10800n,
        withdrawalFeeBps: 50n,
      });
      mockLiquidityPoolContractClient.calculateWithdrawal.mockResolvedValue(540n * STROOPS);
      mockLiquidityPoolContractClient.buildWithdrawTx.mockResolvedValue('AAAAAgAAAAA...');

      const result = await service.withdrawLiquidity(validWallet, { shares: 500 });

      expect(result).toEqual({
        unsignedXdr: 'AAAAAgAAAAA...',
        description: 'Withdraw 500 shares from liquidity pool',
        preview: {
          shares: 500,
          ownedShares: 925,
          remainingShares: 425,
          currentSharePrice: 1.08,
          expectedAmount: 540,
          feeBps: 50,
          fee: 2.7,
          netAmount: 537.3,
          availableLiquidity: 1500,
        },
      });
      expect(mockLiquidityPoolContractClient.buildWithdrawTx).toHaveBeenCalledWith(
        validWallet,
        500n * STROOPS,
      );
    });

    it('should reject zero or negative shares before hitting the blockchain client', async () => {
      await expect(service.withdrawLiquidity(validWallet, { shares: 0 })).rejects.toThrow(
        BadRequestException,
      );

      expect(mockLiquidityPoolContractClient.getLpShares).not.toHaveBeenCalled();
      expect(mockLiquidityPoolContractClient.getPoolStats).not.toHaveBeenCalled();
    });

    it('should reject withdrawals above the user share balance', async () => {
      mockLiquidityPoolContractClient.getLpShares.mockResolvedValue(4999999999n);
      mockLiquidityPoolContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 100000n * STROOPS,
        lockedLiquidity: 90000n * STROOPS,
        availableLiquidity: 10000n * STROOPS,
        totalShares: 100000n * STROOPS,
        sharePrice: 10800n,
        withdrawalFeeBps: 0n,
      });

      await expect(service.withdrawLiquidity(validWallet, { shares: 500 })).rejects.toMatchObject({
        response: { code: 'LIQUIDITY_INSUFFICIENT_SHARES' },
      });
    });

    it('should fail gracefully when pool available liquidity is insufficient', async () => {
      mockLiquidityPoolContractClient.getLpShares.mockResolvedValue(1000n * STROOPS);
      mockLiquidityPoolContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 100000n * STROOPS,
        lockedLiquidity: 99600n * STROOPS,
        availableLiquidity: 400n * STROOPS,
        totalShares: 100000n * STROOPS,
        sharePrice: 10800n,
        withdrawalFeeBps: 0n,
      });
      mockLiquidityPoolContractClient.calculateWithdrawal.mockResolvedValue(540n * STROOPS);

      await expect(service.withdrawLiquidity(validWallet, { shares: 500 })).rejects.toThrow(
        HttpException,
      );

      try {
        await service.withdrawLiquidity(validWallet, { shares: 500 });
        fail('Expected insufficient liquidity error');
      } catch (error) {
        expect((error as HttpException).getStatus()).toBe(402);
        expect((error as HttpException).getResponse()).toEqual(
          expect.objectContaining({
            code: 'LIQUIDITY_INSUFFICIENT_AVAILABLE_LIQUIDITY',
          }),
        );
      }
    });

    it('should support zero configured withdrawal fees', async () => {
      mockLiquidityPoolContractClient.getLpShares.mockResolvedValue(1000n * STROOPS);
      mockLiquidityPoolContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 100000n * STROOPS,
        lockedLiquidity: 90000n * STROOPS,
        availableLiquidity: 10000n * STROOPS,
        totalShares: 100000n * STROOPS,
        sharePrice: 10000n,
        withdrawalFeeBps: 0n,
      });
      mockLiquidityPoolContractClient.calculateWithdrawal.mockResolvedValue(2505000000n);
      mockLiquidityPoolContractClient.buildWithdrawTx.mockResolvedValue('AAAAAgAAAAA...');

      const result = await service.withdrawLiquidity(validWallet, { shares: 250.5 });

      expect(result.preview.expectedAmount).toBe(250.5);
      expect(result.preview.fee).toBe(0);
      expect(result.preview.netAmount).toBe(250.5);
      expect(result.preview.remainingShares).toBe(749.5);
    });
  });

  describe('getPoolOverview', () => {
    it('should compute overview metrics from contract and database state', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockLiquidityPoolContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 2000n * STROOPS,
        lockedLiquidity: 500n * STROOPS,
        availableLiquidity: 1500n * STROOPS,
        totalShares: 1800n * STROOPS,
        sharePrice: 11111n,
        withdrawalFeeBps: 50n,
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'loans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [
                { loan_amount: 800, interest_rate: 8 },
                { loan_amount: 200, interest_rate: 10 },
              ],
              error: null,
            }),
          };
        }

        if (table === 'liquidity_positions') {
          return {
            select: jest.fn().mockResolvedValue({ count: 4, error: null }),
          };
        }

        return mockSupabaseFrom;
      });

      const result = await service.getPoolOverview();

      expect(result).toEqual({
        totalLiquidity: 2000,
        apy: 7.14,
        utilization: 50,
        totalInvestors: 4,
        activeLoans: 2,
      });
      expect(mockCacheManager.set).toHaveBeenCalledWith('liquidity:overview', result, 60);
    });

    it('should use contract fallback and return zero utilization when pool stats fail', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockLiquidityPoolContractClient.getPoolStats.mockRejectedValue(new Error('rpc down'));

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'loans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          };
        }

        if (table === 'liquidity_positions') {
          return {
            select: jest.fn().mockResolvedValue({ count: 0, error: null }),
          };
        }

        return mockSupabaseFrom;
      });

      const result = await service.getPoolOverview();

      expect(result.totalLiquidity).toBe(0);
      expect(result.utilization).toBe(0);
      expect(result.apy).toBe(0);
      expect(result.activeLoans).toBe(0);
    });
  });

  describe('getInvestmentSummary', () => {
    it('should return cached summary without querying blockchain or database', async () => {
      const cached = {
        totalInvested: 1000,
        currentValue: 1085,
        earnings: 85,
        earningsPercent: 8.5,
        apy: 9,
        poolSize: 120000,
        activeLoans: 8,
        shares: 1000,
      };
      mockCacheManager.get.mockResolvedValue(cached);

      const result = await service.getInvestmentSummary(validWallet);

      expect(result).toEqual(cached);
      expect(mockLiquidityPoolContractClient.getLpShares).not.toHaveBeenCalled();
      expect(mockSupabaseService.getServiceRoleClient).not.toHaveBeenCalled();
    });

    it('should compute earnings and percentage from pool and deposit data', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockLiquidityPoolContractClient.getLpShares.mockResolvedValue(1000n * STROOPS);
      mockLiquidityPoolContractClient.calculateWithdrawal.mockResolvedValue(1100n * STROOPS);
      mockLiquidityPoolContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 2000n * STROOPS,
        lockedLiquidity: 700n * STROOPS,
        availableLiquidity: 1300n * STROOPS,
        totalShares: 1800n * STROOPS,
        sharePrice: 11111n,
        withdrawalFeeBps: 50n,
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'liquidity_positions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { deposited_amount: 1000 },
              error: null,
            }),
          };
        }

        if (table === 'loans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [
                { loan_amount: 300, interest_rate: 8 },
                { loan_amount: 100, interest_rate: 10 },
              ],
              error: null,
            }),
          };
        }

        return mockSupabaseFrom;
      });

      const result = await service.getInvestmentSummary(validWallet);

      expect(result).toEqual({
        totalInvested: 1000,
        currentValue: 1100,
        earnings: 100,
        earningsPercent: 10,
        apy: 7.23,
        poolSize: 2000,
        activeLoans: 2,
        shares: 1000,
      });
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        `liquidity:summary:${validWallet}`,
        result,
        60,
      );
    });

    it('should return zeroed values when user has no deposits and no active loans', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockLiquidityPoolContractClient.getLpShares.mockResolvedValue(0n);
      mockLiquidityPoolContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 0n,
        lockedLiquidity: 0n,
        availableLiquidity: 0n,
        totalShares: 0n,
        sharePrice: 0n,
        withdrawalFeeBps: 0n,
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'liquidity_positions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { message: 'not found' },
            }),
          };
        }

        if (table === 'loans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          };
        }

        return mockSupabaseFrom;
      });

      const result = await service.getInvestmentSummary(validWallet);

      expect(result.totalInvested).toBe(0);
      expect(result.currentValue).toBe(0);
      expect(result.earnings).toBe(0);
      expect(result.earningsPercent).toBe(0);
      expect(result.apy).toBe(0);
      expect(result.activeLoans).toBe(0);
      expect(result.shares).toBe(0);
    });
  });
});
