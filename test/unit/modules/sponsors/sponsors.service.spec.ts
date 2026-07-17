import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SponsorsService } from '../../../../src/modules/sponsors/sponsors.service';
import { LiquidityPoolContractClient } from '../../../../src/stellar/contracts/clients/liquidity-pool.client';
import { MockLiquidityPoolContractClient } from '../../../../src/stellar/contracts/mocks/liquidity-pool.mock';
import { SupabaseService } from '../../../../src/database/supabase.client';

describe('SponsorsService', () => {
  let service: SponsorsService;
  let mockLiquidityPoolContractClient: MockLiquidityPoolContractClient;

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
  const STROOPS = 10_000_000n;

  const mockSupabaseClient = {
    from: jest.fn(),
  };

  const mockSupabaseService = {
    getClient: jest.fn(),
    getServiceRoleClient: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SponsorsService,
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: LiquidityPoolContractClient, useClass: MockLiquidityPoolContractClient },
      ],
    }).compile();

    service = module.get<SponsorsService>(SponsorsService);
    mockLiquidityPoolContractClient = module.get<MockLiquidityPoolContractClient>(LiquidityPoolContractClient);
    jest.clearAllMocks();

    mockSupabaseService.getServiceRoleClient.mockReturnValue(mockSupabaseClient);
    mockSupabaseService.getClient.mockReturnValue(mockSupabaseClient);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('should register a new sponsor successfully', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'sponsor_pools') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            insert: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'sponsor-1',
                wallet_address: validWallet,
                org_name: 'Acme Corp',
                sponsor_type: 'company',
                website: 'https://acme.com',
                description: 'Funding education',
                total_deposited: '0',
                available: '0',
                locked: '0',
                created_at: '2024-01-01T00:00:00Z',
              },
              error: null,
            }),
          };
        }
        return {};
      });

      const result = await service.register(validWallet, {
        orgName: 'Acme Corp',
        sponsorType: 'company' as any,
        website: 'https://acme.com',
        description: 'Funding education',
      });

      expect(result).toEqual({
        id: 'sponsor-1',
        walletAddress: validWallet,
        orgName: 'Acme Corp',
        sponsorType: 'company',
        website: 'https://acme.com',
        description: 'Funding education',
        totalDeposited: 0,
        available: 0,
        locked: 0,
        createdAt: '2024-01-01T00:00:00Z',
      });
    });

    it('should throw ConflictException if sponsor already registered', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'sponsor_pools') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { id: 'existing-1' },
              error: null,
            }),
          };
        }
        return {};
      });

      await expect(
        service.register(validWallet, { orgName: 'Acme Corp', sponsorType: 'company' as any }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw on insert failure', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'sponsor_pools') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            insert: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: null, error: { message: 'insert failed' } }),
          };
        }
        return {};
      });

      await expect(
        service.register(validWallet, { orgName: 'Acme Corp', sponsorType: 'company' as any }),
      ).rejects.toThrow('Failed to register sponsor.');
    });

    it('should throw on existing check failure', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'sponsor_pools') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }),
          };
        }
        return {};
      });

      await expect(
        service.register(validWallet, { orgName: 'Acme Corp', sponsorType: 'company' as any }),
      ).rejects.toThrow('Failed to check existing sponsor.');
    });
  });

  describe('getMyPool', () => {
    it('should return sponsor pool for a registered wallet', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'sponsor_pools') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'sponsor-1',
                wallet_address: validWallet,
                org_name: 'Acme Corp',
                sponsor_type: 'company',
                website: null,
                description: null,
                total_deposited: '5000',
                available: '3000',
                locked: '2000',
                created_at: '2024-01-01T00:00:00Z',
              },
              error: null,
            }),
          };
        }
        return {};
      });

      const result = await service.getMyPool(validWallet);

      expect(result).toEqual({
        id: 'sponsor-1',
        walletAddress: validWallet,
        orgName: 'Acme Corp',
        sponsorType: 'company',
        website: undefined,
        description: undefined,
        totalDeposited: 5000,
        available: 3000,
        locked: 2000,
        createdAt: '2024-01-01T00:00:00Z',
      });
    });

    it('should throw NotFoundException for unregistered wallet', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'sponsor_pools') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
          };
        }
        return {};
      });

      await expect(service.getMyPool(validWallet)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStats', () => {
    it('should aggregate sponsor pool stats', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'sponsor_pools') {
          return {
            select: jest.fn().mockResolvedValue({
              data: [
                { total_deposited: '1000', available: '600', locked: '400' },
                { total_deposited: '2000', available: '1500', locked: '500' },
              ],
              error: null,
              count: 2,
            }),
          };
        }
        return {};
      });

      const result = await service.getStats();

      expect(result).toEqual({
        totalSponsors: 2,
        totalDeposited: 3000,
        totalAvailable: 2100,
        totalLocked: 900,
      });
    });

    it('should return zeros when no sponsors exist', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'sponsor_pools') {
          return {
            select: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
          };
        }
        return {};
      });

      const result = await service.getStats();

      expect(result).toEqual({
        totalSponsors: 0,
        totalDeposited: 0,
        totalAvailable: 0,
        totalLocked: 0,
      });
    });

    it('should throw on query failure', async () => {
      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'sponsor_pools') {
          return {
            select: jest.fn().mockResolvedValue({ data: null, error: { message: 'query failed' }, count: null }),
          };
        }
        return {};
      });

      await expect(service.getStats()).rejects.toThrow('Failed to aggregate sponsor stats.');
    });
  });

  describe('getPool', () => {
    it('should aggregate pool overview with utilization and apy', async () => {
      mockLiquidityPoolContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 10_000_000_000n,
        lockedLiquidity: 3_000_000_000n,
        availableLiquidity: 7_000_000_000n,
        totalShares: 1_000_000_000n,
        sharePrice: 10_000n,
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
        return {};
      });

      const result = await service.getPool();

      // totalDeposited = 10_000_000_000n / 10_000_000n = 1000
      // totalShares = 1_000_000_000n / 10_000_000n = 100
      // totalLoaned = 800 + 200 = 1000
      // utilizationBps = (1000 / 1000) * 10000 = 10000
      // weighted rate = 8 * (800/1000) + 10 * (200/1000) = 6.4 + 2 = 8.4
      // estimatedApy = Math.round(8.4 * 0.85 * 100) / 100 = 7.14
      // apyBps = Math.round(7.14 * 100) = 714

      expect(result).toEqual({
        totalDeposited: 1000,
        totalShares: 100,
        utilizationBps: 10000,
        apyBps: 714,
      });
    });

    it('should return zero utilization when no active loans exist', async () => {
      mockLiquidityPoolContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 10_000_000_000n,
        lockedLiquidity: 3_000_000_000n,
        availableLiquidity: 7_000_000_000n,
        totalShares: 1_000_000_000n,
        sharePrice: 10_000n,
        withdrawalFeeBps: 50n,
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'loans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {};
      });

      const result = await service.getPool();

      expect(result.totalDeposited).toBe(1000);
      expect(result.totalShares).toBe(100);
      expect(result.utilizationBps).toBe(0);
      expect(result.apyBps).toBe(0);
    });

    it('should return zero metrics when pool is empty', async () => {
      mockLiquidityPoolContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 0n,
        lockedLiquidity: 0n,
        availableLiquidity: 0n,
        totalShares: 0n,
        sharePrice: 0n,
        withdrawalFeeBps: 0n,
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'loans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        return {};
      });

      const result = await service.getPool();

      expect(result.totalDeposited).toBe(0);
      expect(result.totalShares).toBe(0);
      expect(result.utilizationBps).toBe(0);
      expect(result.apyBps).toBe(0);
    });

    it('should handle loans query error gracefully', async () => {
      mockLiquidityPoolContractClient.getPoolStats.mockResolvedValue({
        totalLiquidity: 10_000_000_000n,
        lockedLiquidity: 3_000_000_000n,
        availableLiquidity: 7_000_000_000n,
        totalShares: 1_000_000_000n,
        sharePrice: 10_000n,
        withdrawalFeeBps: 50n,
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'loans') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({ data: null, error: { message: 'loans error' } }),
          };
        }
        return {};
      });

      const result = await service.getPool();

      expect(result.totalDeposited).toBe(1000);
      expect(result.utilizationBps).toBe(0);
      expect(result.apyBps).toBe(0);
    });

    it('should propagate contract client errors', async () => {
      mockLiquidityPoolContractClient.getPoolStats.mockRejectedValue(new Error('contract unavailable'));

      await expect(service.getPool()).rejects.toThrow('contract unavailable');
    });
  });

  describe('buildDepositXdr', () => {
    it('should build a deposit XDR for a valid amount', async () => {
      mockLiquidityPoolContractClient.buildDepositTx.mockResolvedValue('AAAAAgDEPOSIT...');

      const result = await service.buildDepositXdr(validWallet, 500);

      expect(result).toBe('AAAAAgDEPOSIT...');
      expect(mockLiquidityPoolContractClient.buildDepositTx).toHaveBeenCalledWith(
        validWallet,
        500n * STROOPS,
      );
    });

    it('should reject amount of zero', async () => {
      await expect(service.buildDepositXdr(validWallet, 0)).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.buildDepositXdr(validWallet, 0)).rejects.toMatchObject({
        response: { code: 'VALIDATION_INVALID_AMOUNT' },
      });

      expect(mockLiquidityPoolContractClient.buildDepositTx).not.toHaveBeenCalled();
    });

    it('should reject negative amount', async () => {
      await expect(service.buildDepositXdr(validWallet, -100)).rejects.toThrow(
        BadRequestException,
      );

      expect(mockLiquidityPoolContractClient.buildDepositTx).not.toHaveBeenCalled();
    });

    it('should surface contract client errors', async () => {
      mockLiquidityPoolContractClient.buildDepositTx.mockRejectedValue(
        new Error('contract tx build failed'),
      );

      await expect(service.buildDepositXdr(validWallet, 100)).rejects.toThrow(
        'contract tx build failed',
      );
    });
  });

  describe('buildWithdrawXdr', () => {
    it('should build a withdraw XDR for valid shares', async () => {
      mockLiquidityPoolContractClient.buildWithdrawTx.mockResolvedValue('AAAAAgWITHDRAW...');

      const result = await service.buildWithdrawXdr(validWallet, 100);

      expect(result).toBe('AAAAAgWITHDRAW...');
      expect(mockLiquidityPoolContractClient.buildWithdrawTx).toHaveBeenCalledWith(
        validWallet,
        100n * STROOPS,
      );
    });

    it('should reject shares below MIN_WITHDRAWAL_SHARES', async () => {
      await expect(service.buildWithdrawXdr(validWallet, 0)).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.buildWithdrawXdr(validWallet, 0)).rejects.toMatchObject({
        response: { code: 'VALIDATION_INVALID_SHARES' },
      });

      expect(mockLiquidityPoolContractClient.buildWithdrawTx).not.toHaveBeenCalled();
    });

    it('should reject negative shares', async () => {
      await expect(service.buildWithdrawXdr(validWallet, -5)).rejects.toThrow(
        BadRequestException,
      );

      expect(mockLiquidityPoolContractClient.buildWithdrawTx).not.toHaveBeenCalled();
    });

    it('should surface contract client errors', async () => {
      mockLiquidityPoolContractClient.buildWithdrawTx.mockRejectedValue(
        new Error('withdraw tx build failed'),
      );

      await expect(service.buildWithdrawXdr(validWallet, 10)).rejects.toThrow(
        'withdraw tx build failed',
      );
    });
  });

  describe('deposit', () => {
    it('should delegate to buildDepositXdr and return unsigned XDR', async () => {
      mockLiquidityPoolContractClient.buildDepositTx.mockResolvedValue('AAAAAgDEPOSIT...');

      const result = await service.deposit(validWallet, { amount: 250 });

      expect(result).toEqual({ unsignedXdr: 'AAAAAgDEPOSIT...' });
      expect(mockLiquidityPoolContractClient.buildDepositTx).toHaveBeenCalledWith(
        validWallet,
        250n * STROOPS,
      );
    });

    it('should propagate validation errors from buildDepositXdr', async () => {
      await expect(service.deposit(validWallet, { amount: 0 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should propagate contract errors from buildDepositXdr', async () => {
      mockLiquidityPoolContractClient.buildDepositTx.mockRejectedValue(
        new Error('tx simulation failed'),
      );

      await expect(service.deposit(validWallet, { amount: 100 })).rejects.toThrow(
        'tx simulation failed',
      );
    });
  });
});