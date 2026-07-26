import { Test, TestingModule } from '@nestjs/testing';
import { ReputationService, Reputation } from '../../../../src/modules/reputation/reputation.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { ReputationContractClient } from '../../../../src/stellar/contracts/clients/reputation.client';

describe('ReputationService', () => {
    let service: ReputationService;
    let cacheManager: any;

    const mockCacheManager = {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
    };

    const mockSupabaseClient = {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn().mockReturnThis(),
    };

    const mockSupabaseService = {
        getClient: jest.fn(() => mockSupabaseClient),
    };

    const mockConfigService = {
        get: jest.fn((key: string, defaultValue: any) => defaultValue),
    };

    const wallet = 'GABC123TEST';
    const cacheKey = `reputation:${wallet}`;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                ReputationService,
                { provide: CACHE_MANAGER, useValue: mockCacheManager },
                { provide: ConfigService, useValue: mockConfigService },
                { provide: SupabaseService, useValue: mockSupabaseService },
                {
                    provide: ReputationContractClient,
                    useValue: {
                        getScore: jest.fn(),
                        updateScore: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get<ReputationService>(ReputationService);
        cacheManager = module.get(CACHE_MANAGER);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('getReputationScore', () => {
        it('should return cached object from Redis if available (Hot Cache HIT)', async () => {
            const mockReputation: Reputation = {
                wallet,
                score: 95,
                tier: 'gold',
                interestRate: 4,
                maxCredit: 10_000,
                lastUpdated: new Date().toISOString(),
            };
            mockCacheManager.get.mockResolvedValue(mockReputation);

            const result = await service.getReputationScore(wallet);

            expect(result).toEqual(mockReputation);
            expect(mockCacheManager.get).toHaveBeenCalledWith(cacheKey);
        });

        it('should fall back to Supabase and return mapped object (Warm Cache HIT)', async () => {
            mockCacheManager.get.mockResolvedValue(null);
            mockSupabaseClient.single.mockResolvedValue({
                data: { score: 75, last_synced_at: new Date().toISOString() },
                error: null,
            });

            const result = await service.getReputationScore(wallet);

            expect(result.score).toBe(75);
            expect(result.tier).toBe('silver');
            expect(mockCacheManager.set).toHaveBeenCalledWith(cacheKey, result, 300);
        });

        it('should fetch and map blockchain data correctly when cache misses', async () => {
            mockCacheManager.get.mockResolvedValue(null);
            mockSupabaseClient.single.mockResolvedValueOnce({ data: null, error: 'Not found' })
                .mockResolvedValueOnce({ data: null, error: null });

            const scoreSpy = jest.spyOn(service as any, 'fetchScoreFromBlockchain');
            scoreSpy.mockResolvedValue(82);

            const result = await service.getReputationScore(wallet);

            expect(scoreSpy).toHaveBeenCalledWith(wallet);
            expect(result.score).toBe(82);
            expect(result.tier).toBe('silver');
            expect(mockCacheManager.set).toHaveBeenCalledWith(cacheKey, result, 300);
        });

        it('should persist reputation to Supabase when a user exists', async () => {
            mockCacheManager.get.mockResolvedValue(null);
            mockSupabaseClient.single
                .mockResolvedValueOnce({ data: null, error: 'Not found' }) // initial warm cache check
                .mockResolvedValueOnce({ data: { id: 'user-123' }, error: null });

            const scoreSpy = jest.spyOn(service as any, 'fetchScoreFromBlockchain');
            scoreSpy.mockResolvedValue(92);

            const result = await service.getReputationScore(wallet);

            expect(result.score).toBe(92);
            expect(result.tier).toBe('gold');
            expect(mockSupabaseClient.from).toHaveBeenCalledWith('users');
            expect(mockSupabaseClient.upsert).toHaveBeenCalledWith(
                {
                    user_id: 'user-123',
                    wallet_address: wallet,
                    score: 92,
                    tier: 'gold',
                    last_synced_at: result.lastUpdated,
                },
                { onConflict: 'user_id' },
            );
        });

        it('should normalize blockchain score into the 0-100 range', async () => {
            const score = await service['fetchScoreFromBlockchain'](wallet);
            expect(typeof score).toBe('number');
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(100);
        });

        it('should map score thresholds to credit tiers correctly', () => {
            const now = new Date().toISOString();

            const gold = service['mapToReputation'](wallet, 90, now);
            expect(gold.tier).toBe('gold');
            expect(gold.interestRate).toBe(4);
            expect(gold.maxCredit).toBe(10_000);

            const silver = service['mapToReputation'](wallet, 75, now);
            expect(silver.tier).toBe('silver');
            expect(silver.interestRate).toBe(6);
            expect(silver.maxCredit).toBe(5_000);

            const bronze = service['mapToReputation'](wallet, 60, now);
            expect(bronze.tier).toBe('bronze');
            expect(bronze.interestRate).toBe(8);
            expect(bronze.maxCredit).toBe(2_500);

            const starter = service['mapToReputation'](wallet, 59, now);
            expect(starter.tier).toBe('starter');
            expect(starter.interestRate).toBe(10);
            expect(starter.maxCredit).toBe(1_000);
        });

        it('should fall back to blockchain when Redis cache is unavailable', async () => {
            mockCacheManager.get.mockResolvedValue(null);
            mockSupabaseClient.single.mockResolvedValueOnce({ data: null, error: 'Not found' })
                .mockResolvedValueOnce({ data: null, error: null });

            const scoreSpy = jest.spyOn(service as any, 'fetchScoreFromBlockchain');
            scoreSpy.mockResolvedValue(33);

            const result = await service.getReputationScore(wallet);

            expect(scoreSpy).toHaveBeenCalled();
            expect(result.score).toBe(33);
            expect(result.tier).toBe('starter');
        });

        it('should return default reputation when Supabase cache throws an error', async () => {
            mockCacheManager.get.mockResolvedValue(null);
            mockSupabaseClient.single.mockRejectedValue(new Error('Supabase unavailable'));

            const result = await service.getReputationScore(wallet);

            expect(result.score).toBe(0);
            expect(result.tier).toBe('starter');
        });
    });

    describe('invalidateReputation', () => {
        it('should delete the Redis cache key and remove warm cache from Supabase', async () => {
            mockSupabaseClient.from.mockReturnThis();
            mockSupabaseClient.eq.mockReturnThis();
            mockSupabaseClient.delete.mockReturnThis();

            await service.invalidateReputation(wallet);

            expect(mockCacheManager.del).toHaveBeenCalledWith(cacheKey);
            expect(mockSupabaseClient.from).toHaveBeenCalledWith('reputation_cache');
            expect(mockSupabaseClient.delete).toHaveBeenCalled();
            expect(mockSupabaseClient.eq).toHaveBeenCalledWith('wallet_address', wallet);
        });

        it('should swallow errors while invalidating', async () => {
            mockCacheManager.del.mockRejectedValue(new Error('Redis delete failed'));
            mockSupabaseClient.from.mockReturnThis();
            mockSupabaseClient.eq.mockReturnThis();
            mockSupabaseClient.delete.mockReturnThis();

            await expect(service.invalidateReputation(wallet)).resolves.not.toThrow();
        });
    });
});
