import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { LoansModule } from './modules/loans/loans.module';
import { ReputationModule } from './modules/reputation/reputation.module';
import { UsersModule } from './modules/users/users.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { VouchingModule } from './modules/vouching/vouching.module';
import { BlockchainModule } from './modules/blockchain/blockchain.module';
import { SponsorsModule } from './modules/sponsors/sponsors.module';
import { LiquidityModule } from './modules/liquidity/liquidity.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { LearnersModule } from './modules/learners/learners.module';
import { IndexerModule } from './indexer/indexer.module';
import { LoanPaymentReminderModule } from './jobs/loan-payment-reminder/loan-payment-reminder.module';
import { TransactionStatusCheckerModule } from './jobs/transaction-status-checker/transaction-status-checker.module';
import { NonceCleanupModule } from './jobs/nonce-cleanup/nonce-cleanup.module';
import { SupabaseKeepAliveModule } from './jobs/supabase-keepalive/supabase-keepalive.module';
import { JobsModule } from './jobs/jobs.module';
import { StellarModule } from './stellar/stellar.module';
import { LoggerModule } from './common/logger/logger.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { CreditScoringModule } from './modules/credit-scoring/credit-scoring.module';
import { AdminModule } from './modules/admin/admin.module';
import { CorrelationIdMiddleware } from './common/logger/correlation-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SentryModule.forRoot(),
    ScheduleModule.forRoot(),
    LoggerModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    AuthModule,
    HealthModule,
    MetricsModule,
    LoansModule,
    ReputationModule,
    UsersModule,
    VendorsModule,
    VouchingModule,
    BlockchainModule,
    SponsorsModule,
    LiquidityModule,
    NotificationsModule,
    TransactionsModule,
    LearnersModule,
    IndexerModule,
    LoanPaymentReminderModule,
    TransactionStatusCheckerModule,
    NonceCleanupModule,
    SupabaseKeepAliveModule,
    CreditScoringModule,
    AdminModule,
    StellarModule,
    JobsModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
