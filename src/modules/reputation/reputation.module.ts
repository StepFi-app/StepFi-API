import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ReputationService } from './reputation.service';
import { ReputationController } from './reputation.controller';
import * as redisStore from 'cache-manager-redis-store';
import { SupabaseService } from '../../database/supabase.client';
import { StellarModule } from '../../stellar/stellar.module';

@Module({
    imports: [
        StellarModule,
        CacheModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: async (configService: ConfigService) => ({
                store: redisStore,
                url: configService.get<string>('REDIS_URL', 'redis://localhost:6379'),
            }),
        }),
    ],
    providers: [
        ReputationService,
        SupabaseService,
    ],
    controllers: [ReputationController],
    exports: [ReputationService],
})
export class ReputationModule {}
