import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';
import { AuthModule } from '../auth/auth.module';
import { ReputationModule } from '../reputation/reputation.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { SupabaseService } from '../../database/supabase.client';
import { StellarModule } from '../../stellar/stellar.module';
import { CreditScoringModule } from '../credit-scoring/credit-scoring.module';

@Module({
  imports: [ConfigModule, AuthModule, ReputationModule, BlockchainModule, StellarModule, CreditScoringModule],
  controllers: [LoansController],
  providers: [
    LoansService,
    SupabaseService,
  ],
  exports: [LoansService],
})
export class LoansModule {}

