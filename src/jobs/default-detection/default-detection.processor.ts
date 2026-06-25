import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import * as StellarSdk from 'stellar-sdk';
import { SupabaseService } from '../../database/supabase.client';
import { CreditLineContractClient } from '../../stellar/contracts/clients/creditline.client';
import { BlockchainService } from '../../modules/blockchain/blockchain.service';

import { DEFAULT_GRACE_PERIOD_DAYS } from './default-detection.constants';

interface ActiveLoanRow {
  id: string;
  loan_id: string;
  user_wallet: string;
  next_payment_due: string | null;
  remaining_balance: number | string;
  status: string;
}

interface DetectionResult {
  loanDbId: string;
  loanId: string;
  userWallet: string;
  status: 'detected' | 'skipped' | 'failed';
  reason: string;
  onChainTxHash?: string;
}

/**
 * BullMQ processor for the `default-detection` queue.
 *
 * Runs every 6 hours via cron schedule.
 * Fetches all active loans with an overdue next_payment_due beyond the grace
 * period, triggers an on-chain `declare_default` call, and persists the result.
 */
@Processor('default-detection')
export class DefaultDetectionProcessor extends WorkerHost {
  private readonly logger = new Logger(DefaultDetectionProcessor.name);
  private readonly adminSecretKey: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly creditLineContractClient: CreditLineContractClient,
    private readonly blockchainService: BlockchainService,
    private readonly configService: ConfigService,
  ) {
    super();
    this.adminSecretKey = this.configService.get<string>('STELLAR_ADMIN_SECRET') || '';
    if (!this.adminSecretKey) {
      this.logger.warn(
        'STELLAR_ADMIN_SECRET is not configured — on-chain default transactions cannot be submitted',
      );
    }
  }

  async process(_job: Job): Promise<void> {
    this.logger.log(
      { context: 'DefaultDetectionProcessor', action: 'process' },
      'Default detection job started',
    );

    const summary = { checked: 0, detected: 0, skipped: 0, failed: 0 };

    try {
      const overdueLoans = await this.fetchOverdueActiveLoans();

      if (overdueLoans.length === 0) {
        this.logger.log(
          { context: 'DefaultDetectionProcessor', action: 'process' },
          'No overdue active loans found — skipping run',
        );
        return;
      }

      this.logger.log(
        {
          context: 'DefaultDetectionProcessor',
          action: 'process',
          overdueCount: overdueLoans.length,
        },
        `Processing ${overdueLoans.length} overdue loan(s)`,
      );

      for (const loan of overdueLoans) {
        try {
          const result = await this.processLoan(loan);
          summary.checked++;

          if (result.status === 'detected') summary.detected++;
          else if (result.status === 'skipped') summary.skipped++;
          else if (result.status === 'failed') summary.failed++;

          await this.persistResult(result);
        } catch (error) {
          summary.failed++;
          this.logger.error(
            {
              context: 'DefaultDetectionProcessor',
              action: 'processLoan',
              loanId: loan.loan_id,
              error: error.message,
              stack: error.stack,
            },
            'Failed to process loan for default — continuing with next',
          );
        }
      }
    } catch (error) {
      this.logger.error(
        {
          context: 'DefaultDetectionProcessor',
          action: 'process',
          error: error.message,
          stack: error.stack,
        },
        'Fatal error during default detection job',
      );
    } finally {
      this.logger.log(
        {
          context: 'DefaultDetectionProcessor',
          action: 'summary',
          ...summary,
        },
        `Default detection complete — checked: ${summary.checked}, detected: ${summary.detected}, skipped: ${summary.skipped}, failed: ${summary.failed}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Fetches active loans whose next_payment_due is past the grace period.
   */
  private async fetchOverdueActiveLoans(): Promise<ActiveLoanRow[]> {
    const db = this.supabaseService.getServiceRoleClient();
    const cutoff = new Date(
      Date.now() - DEFAULT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await db
      .from('loans')
      .select('id, loan_id, user_wallet, next_payment_due, remaining_balance, status')
      .eq('status', 'active')
      .not('next_payment_due', 'is', null)
      .lt('next_payment_due', cutoff);

    if (error) {
      throw new Error(`Failed to fetch overdue active loans: ${error.message}`);
    }

    return (data ?? []) as ActiveLoanRow[];
  }

  /**
   * Processes a single overdue loan:
   * 1. Builds and submits an on-chain declare_default transaction
   * 2. Updates the loan record to 'defaulted' in Supabase
   */
  private async processLoan(loan: ActiveLoanRow): Promise<DetectionResult> {
    // Skip if no remaining balance (shouldn't happen for active loans but guard)
    if (Number(loan.remaining_balance) <= 0) {
      return {
        loanDbId: loan.id,
        loanId: loan.loan_id,
        userWallet: loan.user_wallet,
        status: 'skipped',
        reason: 'Remaining balance is zero — loan may already be fully paid',
      };
    }

    // Trigger on-chain default
    if (!this.adminSecretKey) {
      this.logger.warn(
        {
          context: 'DefaultDetectionProcessor',
          action: 'processLoan',
          loanId: loan.loan_id,
        },
        'STELLAR_ADMIN_SECRET not set — falling back to direct Supabase update',
      );

      // Fallback: just update the loan status directly without on-chain call
      await this.updateLoanToDefaulted(loan.id, loan.loan_id);
      return {
        loanDbId: loan.id,
        loanId: loan.loan_id,
        userWallet: loan.user_wallet,
        status: 'detected',
        reason: 'Default recorded in database (no on-chain trigger — admin key not configured)',
      };
    }

    try {
      const unsignedXdr = await this.creditLineContractClient.buildDeclareDefaultTx(
        StellarSdk.Keypair.fromSecret(this.adminSecretKey).publicKey(),
        loan.loan_id,
      );

      // Sign the XDR with the admin keypair
      const keypair = StellarSdk.Keypair.fromSecret(this.adminSecretKey);
      const networkPassphrase =
        this.configService.get<string>('STELLAR_NETWORK_PASSPHRASE') ||
        StellarSdk.Networks.TESTNET;

      const transaction = StellarSdk.TransactionBuilder.fromXDR(
        unsignedXdr,
        networkPassphrase,
      ) as StellarSdk.Transaction;

      transaction.sign(keypair);
      const signedXdr = transaction.toXDR();

      // Submit to Horizon
      const { transactionHash } = await this.blockchainService.submitTransaction(signedXdr);

      // Update loan in Supabase
      await this.updateLoanToDefaulted(loan.id, loan.loan_id);

      this.logger.log(
        {
          context: 'DefaultDetectionProcessor',
          action: 'processLoan',
          loanId: loan.loan_id,
          txHash: transactionHash,
        },
        `Loan ${loan.loan_id} declared defaulted on-chain in tx ${transactionHash}`,
      );

      return {
        loanDbId: loan.id,
        loanId: loan.loan_id,
        userWallet: loan.user_wallet,
        status: 'detected',
        reason: 'Default declared on-chain and Supabase updated',
        onChainTxHash: transactionHash,
      };
    } catch (error) {
      this.logger.error(
        {
          context: 'DefaultDetectionProcessor',
          action: 'processLoan',
          loanId: loan.loan_id,
          error: error.message,
        },
        'On-chain default transaction failed — marking as failed',
      );
      return {
        loanDbId: loan.id,
        loanId: loan.loan_id,
        userWallet: loan.user_wallet,
        status: 'failed',
        reason: `On-chain default failed: ${error.message}`,
      };
    }
  }

  /**
   * Updates the loan record to 'defaulted' status.
   */
  private async updateLoanToDefaulted(id: string, loanId: string): Promise<void> {
    const db = this.supabaseService.getServiceRoleClient();
    const now = new Date().toISOString();

    const { error } = await db
      .from('loans')
      .update({
        status: 'defaulted',
        defaulted_at: now,
        updated_at: now,
      })
      .eq('id', id)
      .eq('status', 'active');

    if (error) {
      throw new Error(`Failed to update loan ${loanId} to defaulted: ${error.message}`);
    }
  }

  /**
   * Persists the detection result to the default_detection_results table.
   */
  private async persistResult(result: DetectionResult): Promise<void> {
    const db = this.supabaseService.getServiceRoleClient();

    const { error } = await db.from('default_detection_results').insert({
      loan_id: result.loanId,
      loan_db_id: result.loanDbId,
      user_wallet: result.userWallet,
      status: result.status,
      reason: result.reason,
      on_chain_tx_hash: result.onChainTxHash ?? null,
      detected_at: new Date().toISOString(),
    });

    if (error) {
      this.logger.error(
        {
          context: 'DefaultDetectionProcessor',
          action: 'persistResult',
          loanId: result.loanId,
          error: error.message,
        },
        'Failed to persist default detection result — continuing',
      );
    }
  }
}
