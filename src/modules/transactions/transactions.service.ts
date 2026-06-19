import {
  Injectable,
  Inject,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import * as StellarSdk from 'stellar-sdk';
import { SupabaseService } from '../../database/supabase.client';
import { TransactionBuilderService } from '../../stellar/transaction-builder.service';
import { SubmitTransactionRequestDto, TransactionType } from './dto/submit-transaction-request.dto';
import { SubmitTransactionResponseDto } from './dto/submit-transaction-response.dto';
import {
  TransactionErrorDetailsDto,
  TransactionResultDetailsDto,
  TransactionStatusResponseDto,
} from './dto/transaction-status-response.dto';

const HORIZON_ERROR_MAP: Record<string, string> = {
  op_bad_auth: 'Invalid transaction signature. Please re-sign and try again.',
  op_no_source_account: 'Source account not found on the Stellar network.',
  op_underfunded: 'Insufficient balance to complete one or more operations in this transaction.',
  tx_bad_seq: 'Transaction sequence number is outdated. Please rebuild the transaction.',
  tx_insufficient_balance: 'Insufficient balance to cover this transaction.',
  tx_bad_auth: 'Invalid transaction signature. Please re-sign and try again.',
  tx_failed: 'Transaction failed on the Stellar network.',
  tx_too_late: 'Transaction expired before it could be submitted.',
  tx_too_early: 'Transaction time bounds not yet valid.',
  tx_insufficient_fee: 'Transaction fee is too low to be accepted by the network.',
  tx_no_account: 'Source account does not exist on the Stellar network.',
};

type TransactionLookupColumn = 'hash' | 'transaction_hash';
type TransactionStatus = 'pending' | 'success' | 'failed';
type HorizonTransactionRecord = {
  hash: string;
  successful: boolean;
  ledger_attr: number;
  operation_count: number;
  source_account: string;
  fee_charged: number | string;
  memo_type: string;
  memo?: string;
  created_at: string;
  result_xdr: string;
};

type TransactionRecord = {
  lookupColumn: TransactionLookupColumn;
  hash: string;
  type: string | null;
  status: TransactionStatus | null;
  submittedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
};

const FINALIZED_TRANSACTION_CACHE_TTL = 0;

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  private readonly horizonServer: StellarSdk.Horizon.Server;
  private readonly networkPassphrase: string;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly transactionBuilderService: TransactionBuilderService,
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

  async submitTransaction(
    wallet: string,
    dto: SubmitTransactionRequestDto,
  ): Promise<SubmitTransactionResponseDto> {
    const transaction = this.parseXdr(dto.xdr);

    let transactionHash: string;
    try {
      const horizonResult = await this.transactionBuilderService.submitWithFeeRetry(
        transaction,
        (retryTransaction) => this.horizonServer.submitTransaction(retryTransaction),
      );
      transactionHash = horizonResult.hash;
    } catch (error) {
      this.handleHorizonError(error);
    }

    this.persistTransactionRecord(wallet, transactionHash, dto.type, dto.xdr).catch((err) => {
      this.logger.error(
        `Failed to persist transaction record for hash ${transactionHash}: ${err.message}`,
      );
    });

    this.logger.log(
      `Transaction submitted — hash: ${transactionHash}, type: ${dto.type}, wallet: ${wallet.slice(0, 8)}...`,
    );

    return { transactionHash, status: 'pending' };
  }

  async getTransactionStatus(hash: string): Promise<TransactionStatusResponseDto> {
    const normalizedHash = hash.toLowerCase();
    const cacheKey = `transactions:status:${normalizedHash}`;

    const cached = await this.cacheManager.get<TransactionStatusResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const transactionRecord = await this.findTransactionRecord(normalizedHash);

    try {
      const horizonTransaction = await this.horizonServer
        .transactions()
        .includeFailed(true)
        .transaction(normalizedHash)
        .call();

      const response = this.buildFinalizedTransactionResponse(horizonTransaction, transactionRecord);

      await this.cacheManager.set(cacheKey, response, FINALIZED_TRANSACTION_CACHE_TTL);
      await this.persistFinalizedTransaction(transactionRecord, response);

      return response;
    } catch (error) {
      if (this.isHorizonNotFoundError(error)) {
        if (transactionRecord) {
          return this.buildPendingTransactionResponse(normalizedHash, transactionRecord);
        }

        throw new NotFoundException({
          code: 'TRANSACTION_NOT_FOUND',
          message: 'Transaction hash was not found in Horizon or local records.',
        });
      }

      this.handleHorizonLookupError(error, normalizedHash);
    }
  }

  private parseXdr(xdr: string): StellarSdk.Transaction | StellarSdk.FeeBumpTransaction {
    try {
      return StellarSdk.TransactionBuilder.fromXDR(xdr, this.networkPassphrase);
    } catch {
      throw new BadRequestException({
        code: 'TRANSACTION_INVALID_XDR',
        message: 'The provided XDR string is malformed or invalid.',
      });
    }
  }

  private handleHorizonError(error: unknown): never {
    const err = error as {
      response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } };
      message?: string;
    };

    const resultCodes = err?.response?.data?.extras?.result_codes;

    if (resultCodes) {
      const txCode = resultCodes.transaction;
      const opCodes = resultCodes.operations ?? [];
      const allCodes = [txCode, ...opCodes].filter(Boolean);

      for (const code of allCodes) {
        if (code && HORIZON_ERROR_MAP[code]) {
          throw new BadRequestException({
            code: `STELLAR_${code.toUpperCase()}`,
            message: HORIZON_ERROR_MAP[code],
          });
        }
      }

      throw new BadRequestException({
        code: 'STELLAR_TRANSACTION_FAILED',
        message: `Transaction rejected by the Stellar network: ${allCodes.join(', ')}`,
      });
    }

    const message = err?.message ?? 'Unknown error';
    if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('network')) {
      throw new ServiceUnavailableException({
        code: 'STELLAR_NETWORK_UNAVAILABLE',
        message: 'Stellar network is temporarily unavailable. Please try again later.',
      });
    }

    this.logger.error(`Horizon submission error: ${message}`);
    throw new InternalServerErrorException({
      code: 'STELLAR_SUBMISSION_FAILED',
      message: 'Failed to submit transaction to the Stellar network. Please try again.',
    });
  }

  private async persistTransactionRecord(
    wallet: string,
    hash: string,
    type: TransactionType,
    xdr: string,
  ): Promise<void> {
    const client = this.supabaseService.getServiceRoleClient();
    const submittedAt = new Date().toISOString();
    const transactionHashPayload: Record<string, unknown> = {
      user_wallet: wallet,
      transaction_hash: hash,
      type,
      status: 'pending',
      xdr,
      submitted_at: submittedAt,
      updated_at: submittedAt,
    };
    const { error: transactionHashError } = await client
      .from('transactions')
      .insert(transactionHashPayload);

    if (!transactionHashError) {
      return;
    }

    if (!this.isUnknownColumnError(transactionHashError)) {
      throw new Error(transactionHashError.message ?? 'Supabase insert failed');
    }

    const legacyHashPayload: Record<string, unknown> = {
      user_wallet: wallet,
      hash,
      type,
      status: 'pending',
      xdr,
      submitted_at: submittedAt,
      updated_at: submittedAt,
    };
    const { error: legacyHashError } = await client.from('transactions').insert(legacyHashPayload);

    if (legacyHashError) {
      throw new Error(legacyHashError.message ?? 'Supabase insert failed');
    }
  }

  private async findTransactionRecord(hash: string): Promise<TransactionRecord | null> {
    const client = this.supabaseService.getServiceRoleClient();

    for (const column of ['hash', 'transaction_hash'] as TransactionLookupColumn[]) {
      const selectColumns = [
        column,
        'type',
        'status',
        'submitted_at',
        'completed_at',
        'updated_at',
      ].join(', ');
      const { data, error } = await client
        .from('transactions')
        .select(selectColumns)
        .eq(column, hash)
        .maybeSingle();

      if (error) {
        if (this.isUnknownColumnError(error)) {
          continue;
        }

        throw new InternalServerErrorException({
          code: 'TRANSACTION_LOOKUP_DB_FAILED',
          message: 'Failed to read transaction metadata from the database.',
        });
      }

      if (!data) {
        continue;
      }

      const row = data as unknown as Record<string, unknown>;
      return {
        lookupColumn: column,
        hash: String(row[column] ?? hash).toLowerCase(),
        type: row.type ? String(row.type) : null,
        status: row.status ? (String(row.status) as TransactionStatus) : null,
        submittedAt: row.submitted_at ? String(row.submitted_at) : null,
        completedAt: row.completed_at ? String(row.completed_at) : null,
        updatedAt: row.updated_at ? String(row.updated_at) : null,
      };
    }

    return null;
  }

  private buildPendingTransactionResponse(
    hash: string,
    transactionRecord: TransactionRecord,
  ): TransactionStatusResponseDto {
    return {
      hash,
      status: 'pending',
      type: transactionRecord.type,
      result: null,
      error: null,
      submittedAt: transactionRecord.submittedAt,
      confirmedAt: null,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  private buildFinalizedTransactionResponse(
    transaction: HorizonTransactionRecord,
    transactionRecord: TransactionRecord | null,
  ): TransactionStatusResponseDto {
    const status: TransactionStatus = transaction.successful ? 'success' : 'failed';
    const error = transaction.successful ? null : this.extractFailureDetails(transaction.result_xdr);

    return {
      hash: transaction.hash.toLowerCase(),
      status,
      type: transactionRecord?.type ?? null,
      result: transaction.successful ? this.extractSuccessDetails(transaction) : null,
      error,
      submittedAt: transactionRecord?.submittedAt ?? null,
      confirmedAt: transaction.created_at,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  private extractSuccessDetails(
    transaction: HorizonTransactionRecord,
  ): TransactionResultDetailsDto {
    return {
      ledger: transaction.ledger_attr,
      operationCount: transaction.operation_count,
      sourceAccount: transaction.source_account,
      feeCharged: String(transaction.fee_charged),
      memoType: transaction.memo_type,
      memo: transaction.memo ?? null,
      createdAt: transaction.created_at,
    };
  }

  private extractFailureDetails(resultXdr: string): TransactionErrorDetailsDto {
    try {
      const parsed = StellarSdk.xdr.TransactionResult.fromXDR(resultXdr, 'base64');
      const txCode = this.toSnakeCase(parsed.result().switch().name);
      const operationResults = parsed.result().value();
      const operationCodes = Array.isArray(operationResults)
        ? operationResults.map((operationResult) => this.toSnakeCase(operationResult.switch().name))
        : [];
      const primaryCode = operationCodes[0] ?? txCode;

      return {
        code: txCode,
        message: HORIZON_ERROR_MAP[primaryCode] ?? HORIZON_ERROR_MAP[txCode] ?? this.humanizeCode(primaryCode),
        operationCodes: operationCodes.length > 0 ? operationCodes : undefined,
      };
    } catch (error) {
      this.logger.warn(`Failed to parse transaction result XDR: ${(error as Error).message}`);
      return {
        code: 'tx_failed',
        message: HORIZON_ERROR_MAP.tx_failed,
      };
    }
  }

  private async persistFinalizedTransaction(
    transactionRecord: TransactionRecord | null,
    response: TransactionStatusResponseDto,
  ): Promise<void> {
    if (!transactionRecord) {
      return;
    }

    const client = this.supabaseService.getServiceRoleClient();
    const payload = {
      status: response.status,
      result: response.result,
      error: response.error?.message ?? null,
      completed_at: response.confirmedAt,
    };

    const { error } = await client
      .from('transactions')
      .update(payload)
      .eq(transactionRecord.lookupColumn, transactionRecord.hash);

    if (error && !this.isUnknownColumnError(error)) {
      this.logger.warn(
        `Failed to persist finalized transaction ${transactionRecord.hash}: ${error.message}`,
      );
    }
  }

  private handleHorizonLookupError(error: unknown, hash: string): never {
    const err = error as {
      response?: { status?: number };
      message?: string;
    };

    const message = err?.message?.toLowerCase() ?? '';
    if (
      err?.response?.status === 502 ||
      err?.response?.status === 503 ||
      err?.response?.status === 504 ||
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('socket')
    ) {
      throw new ServiceUnavailableException({
        code: 'HORIZON_UNAVAILABLE',
        message: `Unable to query Horizon for transaction ${hash}. Please try again later.`,
      });
    }

    this.logger.error(`Unexpected Horizon lookup error for ${hash}: ${err?.message ?? error}`);
    throw new InternalServerErrorException({
      code: 'TRANSACTION_STATUS_LOOKUP_FAILED',
      message: 'Failed to retrieve transaction status from Horizon.',
    });
  }

  private isHorizonNotFoundError(error: unknown): boolean {
    const err = error as { response?: { status?: number } };
    return err?.response?.status === 404;
  }

  private isUnknownColumnError(error: { message?: string } | null | undefined): boolean {
    const message = error?.message?.toLowerCase() ?? '';
    return message.includes('column') && message.includes('does not exist');
  }

  private toSnakeCase(value: string): string {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/-/g, '_')
      .toLowerCase();
  }

  private humanizeCode(code: string): string {
    const sentence = code.replace(/_/g, ' ').trim();
    return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
  }
}
