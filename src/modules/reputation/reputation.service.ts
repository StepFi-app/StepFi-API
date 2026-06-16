import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../database/supabase.client';
import { ReputationContractClient } from '../../stellar/contracts/clients/reputation.client';

export interface Reputation {
    wallet: string;
    score: number;
    tier: 'gold' | 'silver' | 'bronze' | 'poor';
    interestRate: number;
    maxCredit: number;
    lastUpdated: string;
}

@Injectable()
export class ReputationService implements OnModuleInit {
    private readonly logger = new Logger(ReputationService.name);
    private readonly ttl: number;

    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private configService: ConfigService,
        private supabaseService: SupabaseService,
        private reputationContractClient: ReputationContractClient,
    ) {
        this.ttl = this.configService.get<number>('REPUTATION_CACHE_TTL', 300);
    }

    async onModuleInit() {
        this.logger.log('ReputationService initialized with real on-chain contract client');
    }

    async getReputationScore(wallet: string): Promise<Reputation> {
        const cacheKey = `reputation:${wallet}`;

        try {
            // 1. HOT CACHE: Redis
            const cachedRedis = await this.cacheManager.get<Reputation>(cacheKey);
            if (cachedRedis) {
                this.logger.log(`[REDIS] HIT for wallet: ${wallet}`);
                return cachedRedis;
            }

            this.logger.log(`[REDIS] MISS for wallet: ${wallet}. Checking Supabase...`);

            // 2. WARM CACHE: Supabase
            const { data: dbCache, error: dbError } = await this.supabaseService.getClient()
                .from('reputation_cache')
                .select('*')
                .eq('wallet_address', wallet)
                .single();

            if (dbCache && !dbError) {
                const lastSynced = new Date(dbCache.last_synced_at);
                const diffMinutes = (Date.now() - lastSynced.getTime()) / (1000 * 60);

                if (diffMinutes < 60) {
                    this.logger.log(`[SUPABASE] HIT for wallet: ${wallet}`);
                    const reputation = this.mapToReputation(wallet, dbCache.score, dbCache.last_synced_at);
                    await this.cacheManager.set(cacheKey, reputation, this.ttl);
                    return reputation;
                }
            }

            // 3. SOURCE OF TRUTH: Blockchain (real contract call)
            this.logger.log(`[BLOCKCHAIN] Fetching on-chain score for wallet: ${wallet}...`);
            const score = await this.fetchScoreFromBlockchain(wallet);
            const reputation = this.mapToReputation(wallet, score, new Date().toISOString());

            // 4. PERSIST to both caches
            await this.persistReputation(reputation);

            return reputation;
        } catch (error) {
            this.logger.error(`Error in getReputationScore for ${wallet}: ${error.message}`);
            // Fallback: return default reputation for new users
            return this.mapToReputation(wallet, 0, new Date().toISOString());
        }
    }

    private async fetchScoreFromBlockchain(wallet: string): Promise<number> {
        try {
            const score = await this.reputationContractClient.getScore(wallet);
            // New users with no on-chain score default to 0
            return score ?? 0;
        } catch (error) {
            this.logger.warn(
                `Could not fetch on-chain score for ${wallet}: ${error.message}. Defaulting to 0.`
            );
            return 0;
        }
    }

    private mapToReputation(wallet: string, score: number, lastUpdated: string): Reputation {
        let tier: 'gold' | 'silver' | 'bronze' | 'poor';
        let interestRate: number;
        let maxCredit: number;

        if (score >= 90) {
            tier = 'gold';
            interestRate = 5;
            maxCredit = 5000;
        } else if (score >= 75) {
            tier = 'silver';
            interestRate = 8;
            maxCredit = 3000;
        } else if (score >= 60) {
            tier = 'bronze';
            interestRate = 9;
            maxCredit = 1500;
        } else {
            tier = 'poor';
            interestRate = 12;
            maxCredit = 500;
        }

        return { wallet, score, tier, interestRate, maxCredit, lastUpdated };
    }

    async invalidateReputation(wallet: string): Promise<void> {
        const cacheKey = `reputation:${wallet}`;
        try {
            await this.cacheManager.del(cacheKey);
            await this.supabaseService.getClient()
                .from('reputation_cache')
                .delete()
                .eq('wallet_address', wallet);

            this.logger.log(`[INVALIDATE] Cleared caches for wallet: ${wallet}`);
        } catch (error) {
            this.logger.error(`Failed to invalidate caches for ${wallet}: ${error.message}`);
        }
    }

    private async persistReputation(reputation: Reputation): Promise<void> {
        const cacheKey = `reputation:${reputation.wallet}`;

        try {
            await this.cacheManager.set(cacheKey, reputation, this.ttl);

            const { data: user } = await this.supabaseService.getClient()
                .from('users')
                .select('id')
                .eq('wallet_address', reputation.wallet)
                .single();

            if (user) {
                await this.supabaseService.getClient()
                    .from('reputation_cache')
                    .upsert({
                        user_id: user.id,
                        wallet_address: reputation.wallet,
                        score: reputation.score,
                        tier: reputation.tier,
                        last_synced_at: reputation.lastUpdated,
                    }, { onConflict: 'user_id' });

                this.logger.log(`[PERSIST] Score synced for ${reputation.wallet}`);
            }
        } catch (error) {
            this.logger.error(`Failed to persist reputation for ${reputation.wallet}: ${error.message}`);
        }
    }
}
