import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { LoansModule } from './modules/loans/loans.module';
import { ReputationModule } from './modules/reputation/reputation.module';
import { UsersModule } from './modules/users/users.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { VouchingModule } from './modules/vouching/vouching.module';
import { SponsorsModule } from './modules/sponsors/sponsors.module';
import { LiquidityModule } from './modules/liquidity/liquidity.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { LearnersModule } from './modules/learners/learners.module';
import { BlockchainIndexerModule } from './jobs/blockchain-indexer/blockchain-indexer.module';
import { LoanPaymentReminderModule } from './jobs/loan-payment-reminder/loan-payment-reminder.module';
import { TransactionStatusCheckerModule } from './jobs/transaction-status-checker/transaction-status-checker.module';
import { NonceCleanupModule } from './jobs/nonce-cleanup/nonce-cleanup.module';
import { StellarModule } from './stellar/stellar.module';
import { LoggerModule } from './common/logger/logger.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { CorrelationIdMiddleware } from './common/logger/correlation-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          url: configService.get<string>('REDIS_URL') || 'redis://localhost:6379',
        },
      }),
    }),
    AuthModule,
    HealthModule,
    MetricsModule,
    LoansModule,
    ReputationModule,
    UsersModule,
    VendorsModule,
    VouchingModule,
    SponsorsModule,
    LiquidityModule,
    NotificationsModule,
    TransactionsModule,
    LearnersModule,
    BlockchainIndexerModule,
    LoanPaymentReminderModule,
    TransactionStatusCheckerModule,
    NonceCleanupModule,
    StellarModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
