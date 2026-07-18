import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SupabaseService } from '../../database/supabase.client';
import { TransactionType } from '../../modules/transactions/dto/submit-transaction-request.dto';

interface PendingTransaction {
  id: string;
  user_wallet: string;
  transaction_hash: string;
  type: TransactionType;
  status: 'pending' | 'success' | 'failed';
  xdr?: string | null;
  submitted_at: string;
  updated_at: string;
}

interface TransactionMetadata {
  loanId?: string;
  amount?: number;
}

interface TransactionStatusResult {
  found: boolean;
  successful?: boolean;
  result?: unknown;
  errorMessage?: string;
}

interface FollowUpResult {
  loanId?: string;
  remainingBalance?: number;
  loanStatus?: string;
}

/**
 * Reconciles pending Stellar transactions against Horizon on a fixed cadence.
 *
 * Previously this ran as a BullMQ repeatable job; it now runs in-process via
 * NestJS `@Cron` (every 120 s) to eliminate the Redis polling overhead.
 */
@Injectable()
export class TransactionStatusCheckerService {
  private readonly logger = new Logger(TransactionStatusCheckerService.name);

  /**
   * Guards against overlapping cycles: if a check is still running when the next
   * cron tick fires, the tick is skipped rather than run concurrently.
   */
  private isRunning = false;

  private readonly horizonServer: StellarSdk.Horizon.Server;
  private readonly networkPassphrase: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {
    const horizonUrl =
      this.configService.get<string>('STELLAR_HORIZON_URL') ||
      'https://horizon-testnet.stellar.org';

    this.networkPassphrase =
      this.configService.get<string>('STELLAR_NETWORK_PASSPHRASE') ||
      StellarSdk.Networks.TESTNET;

    this.horizonServer = new StellarSdk.Horizon.Server(horizonUrl);
    this.logger.log(`Horizon client initialized: ${horizonUrl}`);
  }

  @Cron('*/120 * * * * *')
  async checkTransactions(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Transaction status checker already running, skipping');
      return;
    }
    this.isRunning = true;

    this.logger.log(
      {
        context: 'TransactionStatusCheckerService',
        action: 'checkTransactions',
      },
      'Transaction status checker cycle started',
    );

    try {
      const pending = await this.fetchPendingTransactions();

      if (pending.length === 0) {
        this.logger.debug(
          {
            context: 'TransactionStatusCheckerService',
            action: 'checkTransactions',
          },
          'No pending transactions found',
        );
        await this.cleanupOldTransactions();
        return;
      }

      this.logger.log(
        {
          context: 'TransactionStatusCheckerService',
          action: 'checkTransactions',
          pendingCount: pending.length,
        },
        `Checking ${pending.length} pending transaction(s)`,
      );

      for (const transaction of pending) {
        try {
          const status = await this.checkTransactionStatus(transaction.transaction_hash);

          if (!status.found) {
            this.logger.debug(
              {
                context: 'TransactionStatusCheckerService',
                action: 'checkTransactionStatus',
                transactionHash: transaction.transaction_hash,
              },
              'Transaction not found on Horizon yet — leaving pending',
            );
            continue;
          }

          if (status.successful === true) {
            await this.finalizeTransaction(transaction, 'success', status.result, status.errorMessage);
          } else if (status.successful === false) {
            await this.finalizeTransaction(transaction, 'failed', status.result, status.errorMessage);
          } else {
            this.logger.debug(
              {
                context: 'TransactionStatusCheckerService',
                action: 'checkTransactionStatus',
                transactionHash: transaction.transaction_hash,
              },
              'Horizon returned an unexpected transaction payload; leaving pending',
            );
          }
        } catch (error) {
          this.logger.error(
            {
              context: 'TransactionStatusCheckerService',
              action: 'processTransaction',
              transactionHash: transaction.transaction_hash,
              error: error?.message,
              stack: error?.stack,
            },
            'Failed to process pending transaction — continuing with next',
          );
        }
      }
    } catch (error) {
      this.logger.error(
        {
          context: 'TransactionStatusCheckerService',
          action: 'checkTransactions',
          error: error?.message,
          stack: error?.stack,
        },
        'Fatal error in transaction status checker',
      );
    } finally {
      await this.cleanupOldTransactions();
      this.isRunning = false;
      this.logger.log(
        {
          context: 'TransactionStatusCheckerService',
          action: 'checkTransactions',
        },
        'Transaction status checker cycle completed',
      );
    }
  }

  private async fetchPendingTransactions(): Promise<PendingTransaction[]> {
    const db = this.supabaseService.getServiceRoleClient();
    const { data, error } = await db
      .from('transactions')
      .select(
        'id, user_wallet, transaction_hash, type, status, xdr, submitted_at, updated_at',
      )
      .eq('status', 'pending')
      .order('submitted_at', { ascending: true })
      .limit(100);

    if (error) {
      throw new Error(`Failed to fetch pending transactions: ${error.message}`);
    }

    return (data ?? []) as PendingTransaction[];
  }

  private async checkTransactionStatus(hash: string): Promise<TransactionStatusResult> {
    const maxAttempts = 3;
    let attempt = 0;

    while (attempt < maxAttempts) {
      try {
        attempt += 1;
        const response = await this.horizonServer.transactions().transaction(hash).call();
        return {
          found: true,
          successful: response.successful === true,
          result: response,
          errorMessage: this.extractHorizonError(
            response as { result_codes?: { transaction?: string } },
          ),
        };
      } catch (error) {
        if (this.isNotFoundError(error)) {
          return { found: false };
        }

        if (!this.isTransientHorizonError(error) || attempt >= maxAttempts) {
          throw error;
        }

        const delayMs = 1000 * attempt;
        this.logger.warn(
          {
            context: 'TransactionStatusCheckerService',
            action: 'checkTransactionStatus',
            transactionHash: hash,
            attempt,
            delayMs,
            error: error?.message,
          },
          'Transient Horizon error — retrying',
        );
        await this.wait(delayMs);
      }
    }

    return { found: false };
  }

  private extractHorizonError(
    response: { result_codes?: { transaction?: string } } | null | undefined,
  ): string | undefined {
    if (!response) {
      return undefined;
    }

    const codes = response.result_codes;
    if (!codes) {
      return undefined;
    }

    if (codes.transaction) {
      return codes.transaction;
    }

    return JSON.stringify(codes);
  }

  private isNotFoundError(error: unknown): boolean {
    return error instanceof StellarSdk.NotFoundError;
  }

  private isTransientHorizonError(error: unknown): boolean {
    if (error instanceof StellarSdk.NetworkError) {
      return true;
    }

    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 429 || status >= 500) {
      return true;
    }

    const message = String((error as { message?: string })?.message ?? '').toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('rate limit') ||
      message.includes('throttl') ||
      message.includes('temporar') ||
      message.includes('network')
    );
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async finalizeTransaction(
    transaction: PendingTransaction,
    status: 'success' | 'failed',
    result: unknown,
    errorMessage?: string,
  ): Promise<void> {
    const db = this.supabaseService.getServiceRoleClient();
    const now = new Date().toISOString();

    const updatePayload: Record<string, unknown> = {
      status,
      result,
      updated_at: now,
      completed_at: now,
    };

    if (errorMessage) {
      updatePayload.error = errorMessage;
    }

    const { data, error } = await db
      .from('transactions')
      .update(updatePayload)
      .eq('transaction_hash', transaction.transaction_hash)
      .eq('status', 'pending')
      .select('id, user_wallet, transaction_hash, type, xdr')
      .single();

    if (error) {
      throw new Error(`Failed to update transaction ${transaction.transaction_hash}: ${error.message}`);
    }

    if (!data) {
      this.logger.warn(
        {
          context: 'TransactionStatusCheckerService',
          action: 'finalizeTransaction',
          transactionHash: transaction.transaction_hash,
        },
        'Transaction record was already updated by another worker or no longer pending',
      );
      return;
    }

    const followUp = await this.applyFollowUpActions(transaction, status);
    await this.createNotification(transaction, status, errorMessage, followUp);

    this.logger.log(
      {
        context: 'TransactionStatusCheckerService',
        action: 'finalizeTransaction',
        transactionHash: transaction.transaction_hash,
        status,
      },
      `Transaction ${transaction.transaction_hash} finalized as ${status}`,
    );
  }

  private async applyFollowUpActions(
    transaction: PendingTransaction,
    status: 'success' | 'failed',
  ): Promise<FollowUpResult> {
    if (status !== 'success') {
      return {};
    }

    const metadata = this.parseTransactionMetadata(transaction.xdr);
    if (!metadata?.loanId) {
      return {};
    }

    if (transaction.type === TransactionType.LOAN_CREATE) {
      return this.activatePendingLoan(metadata.loanId, transaction.user_wallet);
    }

    if (transaction.type === TransactionType.LOAN_REPAY && typeof metadata.amount === 'number') {
      return this.applyLoanRepayment(metadata.loanId, transaction.user_wallet, metadata.amount);
    }

    return { loanId: metadata.loanId };
  }

  private async activatePendingLoan(
    loanId: string,
    userWallet: string,
  ): Promise<FollowUpResult> {
    const db = this.supabaseService.getServiceRoleClient();

    const { data: loan, error } = await db
      .from('loans')
      .select('loan_id, status')
      .eq('loan_id', loanId)
      .eq('user_wallet', userWallet)
      .single();

    if (error || !loan) {
      this.logger.warn(
        {
          context: 'TransactionStatusCheckerService',
          action: 'activatePendingLoan',
          loanId,
          userWallet,
          error: error?.message,
        },
        'Pending loan not found for loan_create transaction',
      );
      return { loanId };
    }

    if (loan.status !== 'pending') {
      return { loanId, loanStatus: loan.status };
    }

    const { error: updateError } = await db
      .from('loans')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('loan_id', loanId)
      .eq('user_wallet', userWallet)
      .eq('status', 'pending');

    if (updateError) {
      this.logger.warn(
        {
          context: 'TransactionStatusCheckerService',
          action: 'activatePendingLoan',
          loanId,
          error: updateError.message,
        },
        'Failed to update pending loan status after successful transaction',
      );
      return { loanId };
    }

    return { loanId, loanStatus: 'active' };
  }

  private async applyLoanRepayment(
    loanId: string,
    userWallet: string,
    amount: number,
  ): Promise<FollowUpResult> {
    const db = this.supabaseService.getServiceRoleClient();

    const { data: loan, error: fetchError } = await db
      .from('loans')
      .select('remaining_balance, status')
      .eq('loan_id', loanId)
      .eq('user_wallet', userWallet)
      .single();

    if (fetchError || !loan) {
      this.logger.warn(
        {
          context: 'TransactionStatusCheckerService',
          action: 'applyLoanRepayment',
          loanId,
          userWallet,
          error: fetchError?.message,
        },
        'Loan not found for loan_repay transaction',
      );
      return { loanId };
    }

    const currentBalance = Number(loan.remaining_balance ?? 0);
    const updatedBalance = Math.max(0, Math.round((currentBalance - amount) * 100) / 100);
    const updatedStatus = updatedBalance === 0 ? 'completed' : loan.status;
    const updatePayload: Record<string, unknown> = {
      remaining_balance: updatedBalance,
      updated_at: new Date().toISOString(),
    };

    if (updatedStatus !== loan.status) {
      updatePayload.status = updatedStatus;
      if (updatedStatus === 'completed') {
        updatePayload.completed_at = new Date().toISOString();
      }
    }

    const { error: updateError } = await db
      .from('loans')
      .update(updatePayload)
      .eq('loan_id', loanId)
      .eq('user_wallet', userWallet);

    if (updateError) {
      this.logger.warn(
        {
          context: 'TransactionStatusCheckerService',
          action: 'applyLoanRepayment',
          loanId,
          error: updateError.message,
        },
        'Failed to update loan balance after successful repayment',
      );
      return { loanId };
    }

    return { loanId, remainingBalance: updatedBalance, loanStatus: updatedStatus };
  }

  private parseTransactionMetadata(xdr?: string | null): TransactionMetadata | null {
    if (!xdr) {
      return null;
    }

    try {
      const transaction = StellarSdk.TransactionBuilder.fromXDR(xdr, this.networkPassphrase);
      const innerTransaction =
        transaction instanceof StellarSdk.FeeBumpTransaction
          ? transaction.innerTransaction
          : transaction;

      const operation = innerTransaction.operations?.[0];
      if (!operation || operation.type !== 'invokeHostFunction') {
        return null;
      }

      // Reaches into the XDR object's internal structure (no public accessor).
      const invocation = (operation.func as unknown as {
        _value?: {
          _attributes?: {
            functionName?: { toString?: () => string };
            args?: unknown[];
          };
        };
      })?._value?._attributes;
      if (!invocation) {
        return null;
      }

      const functionName = invocation.functionName?.toString?.();
      const args = invocation.args as unknown[];
      if (!Array.isArray(args) || !functionName) {
        return null;
      }

      const nativeArgs = args.map((arg) => {
        try {
          return StellarSdk.scValToNative(arg as StellarSdk.xdr.ScVal);
        } catch {
          return undefined;
        }
      });

      if (functionName === 'create_loan') {
        return {
          loanId: nativeArgs[0] as string,
        };
      }

      if (functionName === 'repay_installment') {
        const loanId = nativeArgs[1] as string;
        const rawAmount = nativeArgs[2];
        const amount = typeof rawAmount === 'bigint' ? Number(rawAmount) / 10_000_000 :
          typeof rawAmount === 'number' ? rawAmount / 10_000_000 : undefined;

        return { loanId, amount };
      }

      return null;
    } catch (error) {
      this.logger.warn(
        {
          context: 'TransactionStatusCheckerService',
          action: 'parseTransactionMetadata',
          error: error?.message,
          transactionXdr: xdr?.slice(0, 64),
        },
        'Failed to parse transaction XDR for follow-up actions',
      );
      return null;
    }
  }

  private async createNotification(
    transaction: PendingTransaction,
    status: 'success' | 'failed',
    errorMessage?: string,
    followUp: FollowUpResult = {},
  ): Promise<void> {
    const db = this.supabaseService.getServiceRoleClient();
    const { title, message, type } = this.buildNotificationPayload(
      transaction,
      status,
      errorMessage,
      followUp,
    );

    const notificationPayload = {
      user_wallet: transaction.user_wallet,
      type,
      title,
      message,
      data: {
        transactionHash: transaction.transaction_hash,
        transactionType: transaction.type,
        loanId: followUp.loanId ?? null,
      },
      is_read: false,
    };

    const { error } = await db.from('notifications').insert(notificationPayload);
    if (error) {
      this.logger.warn(
        {
          context: 'TransactionStatusCheckerService',
          action: 'createNotification',
          transactionHash: transaction.transaction_hash,
          error: error.message,
        },
        'Failed to create user notification for finalized transaction',
      );
    }
  }

  private buildNotificationPayload(
    transaction: PendingTransaction,
    status: 'success' | 'failed',
    errorMessage: string | undefined,
    followUp: FollowUpResult,
  ): { type: string; title: string; message: string } {
    if (status === 'failed') {
      return {
        type: 'transaction_failed',
        title: 'Transaction Failed',
        message: `Your ${transaction.type.replace('_', ' ')} transaction failed on Stellar.${
          errorMessage ? ` ${errorMessage}` : ''
        }`,
      };
    }

    if (transaction.type === TransactionType.LOAN_CREATE) {
      return {
        type: 'loan_create_success',
        title: 'Loan Activated',
        message: followUp.loanId
          ? `Your loan ${followUp.loanId} is now active after Stellar confirmation.`
          : 'Your loan creation transaction was confirmed on Stellar and your loan is now active.',
      };
    }

    if (transaction.type === TransactionType.LOAN_REPAY) {
      const amountMessage = followUp.remainingBalance !== undefined
        ? ` Remaining balance is $${followUp.remainingBalance.toFixed(2)}.`
        : '';

      return {
        type: 'loan_repay_success',
        title: 'Loan Payment Confirmed',
        message: `Your loan repayment transaction was confirmed on Stellar.${amountMessage}`,
      };
    }

    return {
      type: 'transaction_success',
      title: 'Transaction Confirmed',
      message: `Your ${transaction.type.replace('_', ' ')} transaction was confirmed on Stellar.`,
    };
  }

  private async cleanupOldTransactions(): Promise<void> {
    const threshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const db = this.supabaseService.getServiceRoleClient();

    const { error } = await db
      .from('transactions')
      .delete()
      .lt('submitted_at', threshold)
      .neq('status', 'pending');

    if (error) {
      this.logger.warn(
        {
          context: 'TransactionStatusCheckerService',
          action: 'cleanupOldTransactions',
          error: error.message,
        },
        'Failed to clean up old transaction records',
      );
    }
  }
}
