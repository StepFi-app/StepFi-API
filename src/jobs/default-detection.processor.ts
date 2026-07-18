import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SupabaseService } from '../database/supabase.client';
import { CreditLineContractClient } from '../stellar/contracts/clients/creditline.client';
import { TransactionsService } from '../modules/transactions/transactions.service';
import { TransactionType } from '../modules/transactions/dto/submit-transaction-request.dto';

interface OverdueLoan {
  id: string;
  loan_id: string;
  user_wallet: string;
}

const DEFAULT_GRACE_PERIOD_DAYS = 7;

@Injectable()
export class DefaultDetectionProcessor {
  private readonly logger = new Logger(DefaultDetectionProcessor.name);
  private isRunning = false;
  private readonly adminKeypair: StellarSdk.Keypair | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly creditLineContractClient: CreditLineContractClient,
    private readonly transactionsService: TransactionsService,
  ) {
    const secret = this.configService.get<string>('STELLAR_ADMIN_SECRET');
    if (secret) {
      try {
        this.adminKeypair = StellarSdk.Keypair.fromSecret(secret);
        this.logger.log(`Admin keypair loaded: ${this.adminKeypair.publicKey().slice(0, 8)}...`);
      } catch {
        this.logger.warn('STELLAR_ADMIN_SECRET is invalid — default detection will fail to submit on-chain');
      }
    } else {
      this.logger.warn('STELLAR_ADMIN_SECRET is not set — default detection will skip on-chain submission');
    }
  }

  @Cron('0 * * * *')
  async detectDefaults(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const loans = await this.fetchOverdueLoans();
      if (loans.length === 0) {
        this.logger.log('No overdue loans found');
        return;
      }

      this.logger.log(`Found ${loans.length} overdue loan(s)`);

      for (const loan of loans) {
        try {
          await this.processOverdueLoan(loan);
        } catch (error) {
          this.logger.error(`Failed to process overdue loan ${loan.loan_id}: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Fatal error in default detection job: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async fetchOverdueLoans(): Promise<OverdueLoan[]> {
    const db = this.supabaseService.getServiceRoleClient();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DEFAULT_GRACE_PERIOD_DAYS);

    const { data, error } = await db
      .from('loans')
      .select('id, loan_id, user_wallet')
      .eq('status', 'active')
      .lt('next_payment_due', cutoff.toISOString())
      .not('next_payment_due', 'is', null);

    if (error) {
      throw new Error(`Failed to fetch overdue loans: ${error.message}`);
    }

    return (data ?? []) as OverdueLoan[];
  }

  private async processOverdueLoan(loan: OverdueLoan): Promise<void> {
    if (this.adminKeypair) {
      try {
        const unsignedXdr = await this.creditLineContractClient.buildMarkDefaultedTx(loan.loan_id);

        const networkPassphrase =
          this.configService.get<string>('STELLAR_NETWORK_PASSPHRASE') ||
          StellarSdk.Networks.TESTNET;

        const transaction = StellarSdk.TransactionBuilder.fromXDR(unsignedXdr, networkPassphrase);
        transaction.sign(this.adminKeypair);
        const signedXdr = transaction.toXDR();

        await this.transactionsService.submitTransaction(
          this.adminKeypair.publicKey(),
          { xdr: signedXdr, type: TransactionType.LOAN_DEFAULT },
        );

        this.logger.log(`mark_defaulted submitted for loan ${loan.loan_id}`);
      } catch (error) {
        this.logger.error(`On-chain mark_defaulted failed for ${loan.loan_id}: ${error.message}`);
      }
    } else {
      this.logger.warn(`No admin keypair configured — marking ${loan.loan_id} as defaulted off-chain only`);
    }

    await this.markDefaultedOffChain(loan);
  }

  private async markDefaultedOffChain(loan: OverdueLoan): Promise<void> {
    const db = this.supabaseService.getServiceRoleClient();
    const now = new Date().toISOString();

    const { error: updateError } = await db
      .from('loans')
      .update({
        status: 'defaulted',
        defaulted_at: now,
        updated_at: now,
      })
      .eq('id', loan.id)
      .eq('status', 'active');

    if (updateError) {
      throw new Error(`Failed to update loan ${loan.loan_id} to defaulted: ${updateError.message}`);
    }

    const { error: deleteError } = await db
      .from('reputation_cache')
      .delete()
      .eq('wallet_address', loan.user_wallet);

    if (deleteError) {
      this.logger.warn(`Failed to clear reputation cache for ${loan.user_wallet}: ${deleteError.message}`);
    }

    this.logger.log(`Loan ${loan.loan_id} marked as defaulted`);
  }
}
