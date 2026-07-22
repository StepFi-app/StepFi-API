import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, HttpException } from '@nestjs/common';
import { LiquidityService } from '../../../../src/modules/liquidity/liquidity.service';
import { LiquidityContractClient } from '../../../../src/blockchain/contracts/liquidity-contract.client';
import { SupabaseService } from '../../../../src/database/supabase.client';

class MockLiquidityContractClient {
  getLpShares = jest.fn();
  getPoolStats = jest.fn();
  calculateWithdrawal = jest.fn();
  calculateDeposit = jest.fn();
  buildUnsignedXdr = jest.fn();
}

describe('LiquidityService', () => {
  let service: LiquidityService;
  let mockLiquidityContractClient: MockLiquidityContractClient;

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
        { provide: LiquidityContractClient, useClass: MockLiquidityContractClient },
      ],
    }).compile();

    service = module.get<LiquidityService>(LiquidityService);
    mockLiquidityContractClient = module.get<MockLiquidityContractClient>(LiquidityContractClient);
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
      mockLiquidityContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 100000n * STROOPS,
        lockedLiquidity: 90000n * STROOPS,
        availableLiquidity: 10000n * STROOPS,
        totalShares: 95000n * STROOPS,
        sharePrice: 10500n,
        withdrawalFeeBps: 50n,
      });
      mockLiquidityContractClient.calculateDeposit.mockResolvedValue(4761904761n);
      mockLiquidityContractClient.buildUnsignedXdr.mockResolvedValue('AAAAAgDEPOSIT...');

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
      expect(mockLiquidityContractClient.buildUnsignedXdr).toHaveBeenCalledWith(
        'deposit',
        [validWallet, 500],
      );
    });

    it('should default share price to 1 for the first deposit', async () => {
      mockLiquidityContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 0n,
        lockedLiquidity: 0n,
        availableLiquidity: 0n,
        totalShares: 0n,
        sharePrice: 0n,
        withdrawalFeeBps: 0n,
      });
      mockLiquidityContractClient.calculateDeposit.mockResolvedValue(100n * STROOPS);
      mockLiquidityContractClient.buildUnsignedXdr.mockResolvedValue('AAAAAgDEPOSIT...');

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

      expect(mockLiquidityContractClient.getPoolStats).not.toHaveBeenCalled();
    });

    it('should surface pool read errors from contract client', async () => {
      mockLiquidityContractClient.getPoolStats.mockRejectedValue(new Error('pool unavailable'));

      await expect(service.depositLiquidity(validWallet, { amount: 200 })).rejects.toThrow(
        'pool unavailable',
      );
    });

    it('should map contract simulation error to BadRequestException (400)', async () => {
      mockLiquidityContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 100000n * STROOPS,
        lockedLiquidity: 90000n * STROOPS,
        availableLiquidity: 10000n * STROOPS,
        totalShares: 95000n * STROOPS,
        sharePrice: 10500n,
        withdrawalFeeBps: 50n,
      });
      mockLiquidityContractClient.calculateDeposit.mockResolvedValue(4761904761n);
      mockLiquidityContractClient.buildUnsignedXdr.mockRejectedValue(
        new Error('HostError: Error(Contract, #101)'),
      );

      await expect(service.depositLiquidity(validWallet, { amount: 500 })).rejects.toThrow(
        BadRequestException,
      );

      try {
        await service.depositLiquidity(validWallet, { amount: 500 });
      } catch (error) {
        expect((error as BadRequestException).getResponse()).toEqual(
          expect.objectContaining({
            code: 'LIQUIDITY_INVALID_AMOUNT',
          }),
        );
      }
    });
  });

  describe('withdrawLiquidity', () => {
    it('should construct an unsigned XDR and preview for a valid partial withdrawal', async () => {
      mockLiquidityContractClient.getLpShares.mockResolvedValue(925n * STROOPS);
      mockLiquidityContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 100000n * STROOPS,
        lockedLiquidity: 98500n * STROOPS,
        availableLiquidity: 1500n * STROOPS,
        totalShares: 92500n * STROOPS,
        sharePrice: 10800n,
        withdrawalFeeBps: 50n,
      });
      mockLiquidityContractClient.calculateWithdrawal.mockResolvedValue(540n * STROOPS);
      mockLiquidityContractClient.buildUnsignedXdr.mockResolvedValue('AAAAAgAAAAA...');

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
      expect(mockLiquidityContractClient.buildUnsignedXdr).toHaveBeenCalledWith(
        'withdraw',
        [validWallet, 500],
      );
    });

    it('should reject zero or negative shares before hitting the blockchain client', async () => {
      await expect(service.withdrawLiquidity(validWallet, { shares: 0 })).rejects.toThrow(
        BadRequestException,
      );

      expect(mockLiquidityContractClient.getLpShares).not.toHaveBeenCalled();
      expect(mockLiquidityContractClient.getPoolStats).not.toHaveBeenCalled();
    });

    it('should reject withdrawals above the user share balance', async () => {
      mockLiquidityContractClient.getLpShares.mockResolvedValue(4999999999n);
      mockLiquidityContractClient.getPoolStats.mockResolvedValue({
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
      mockLiquidityContractClient.getLpShares.mockResolvedValue(1000n * STROOPS);
      mockLiquidityContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 100000n * STROOPS,
        lockedLiquidity: 99600n * STROOPS,
        availableLiquidity: 400n * STROOPS,
        totalShares: 100000n * STROOPS,
        sharePrice: 10800n,
        withdrawalFeeBps: 0n,
      });
      mockLiquidityContractClient.calculateWithdrawal.mockResolvedValue(540n * STROOPS);

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
      mockLiquidityContractClient.getLpShares.mockResolvedValue(1000n * STROOPS);
      mockLiquidityContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 100000n * STROOPS,
        lockedLiquidity: 90000n * STROOPS,
        availableLiquidity: 10000n * STROOPS,
        totalShares: 100000n * STROOPS,
        sharePrice: 10000n,
        withdrawalFeeBps: 0n,
      });
      mockLiquidityContractClient.calculateWithdrawal.mockResolvedValue(2505000000n);
      mockLiquidityContractClient.buildUnsignedXdr.mockResolvedValue('AAAAAgAAAAA...');

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
      mockLiquidityContractClient.getPoolStats.mockResolvedValue({
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
        totalDeposits: 2000,
        totalLiquidity: 2000,
        lockedLiquidity: 500,
        availableLiquidity: 1500,
        totalShares: 1800,
        sharePrice: 1.1111,
        apy: 7.14,
        utilization: 25,
        totalInvestors: 4,
        activeLoans: 2,
      });
      expect(mockCacheManager.set).toHaveBeenCalledWith('liquidity:overview', result, 60);
    });

    it('should use contract fallback and return zero utilization when pool stats fail', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockLiquidityContractClient.getPoolStats.mockRejectedValue(new Error('rpc down'));

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
      expect(result.lockedLiquidity).toBe(0);
      expect(result.availableLiquidity).toBe(0);
      expect(result.totalShares).toBe(0);
      expect(result.sharePrice).toBe(1);
      expect(result.totalDeposits).toBe(0);
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
      expect(mockLiquidityContractClient.getLpShares).not.toHaveBeenCalled();
      expect(mockSupabaseService.getServiceRoleClient).not.toHaveBeenCalled();
    });

    it('should compute earnings and percentage from pool and deposit data', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockLiquidityContractClient.getLpShares.mockResolvedValue(1000n * STROOPS);
      mockLiquidityContractClient.calculateWithdrawal.mockResolvedValue(1100n * STROOPS);
      mockLiquidityContractClient.getPoolStats.mockResolvedValue({
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
      mockLiquidityContractClient.getLpShares.mockResolvedValue(0n);
      mockLiquidityContractClient.getPoolStats.mockResolvedValue({
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
