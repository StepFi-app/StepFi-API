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
import { SubmitTransactionRequestDto, TransactionType } from './dto/submit-transaction-request.dto';
import { CREDIT_LINE_CONTRACT_ID_KEY } from '../../stellar/contracts/interfaces/creditline.interface';
import { LIQUIDITY_POOL_CONTRACT_ID_KEY } from '../../stellar/contracts/interfaces/liquidity-pool.interface';
import { VENDOR_REGISTRY_CONTRACT_ID_KEY } from '../../stellar/contracts/interfaces/vendor-registry.interface';
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

/**
 * Per-type operation allowlist for POST /transactions/submit.
 *
 * Every operation in a submitted transaction must be a Soroban contract
 * invocation whose function name matches the declared transaction type, and
 * (when the expected contract ID is configured) must target the contract
 * owned by that flow. Anything else — payments, account merges, trustlines,
 * or invocations of StepFi's contracts under the wrong declared type — is
 * rejected before reaching Horizon.
 */
interface TransactionTypeAllowlist {
  functionNames: readonly string[];
  contractIdKey: string;
}

const TRANSACTION_TYPE_ALLOWLIST: Record<TransactionType, TransactionTypeAllowlist> = {
  [TransactionType.LOAN_CREATE]: {
    functionNames: ['create_loan'],
    contractIdKey: CREDIT_LINE_CONTRACT_ID_KEY,
  },
  [TransactionType.LOAN_REPAY]: {
    // `repay_loan` is the canonical contract entry point; `repay_installment`
    // is accepted while the repayment flow is migrating between them.
    functionNames: ['repay_loan', 'repay_installment'],
    contractIdKey: CREDIT_LINE_CONTRACT_ID_KEY,
  },
  [TransactionType.DEPOSIT]: {
    functionNames: ['deposit'],
    contractIdKey: LIQUIDITY_POOL_CONTRACT_ID_KEY,
  },
  [TransactionType.WITHDRAW]: {
    functionNames: ['withdraw'],
    contractIdKey: LIQUIDITY_POOL_CONTRACT_ID_KEY,
  },
  [TransactionType.VENDOR_APPROVE]: {
    functionNames: ['approve_vendor'],
    contractIdKey: VENDOR_REGISTRY_CONTRACT_ID_KEY,
  },
  [TransactionType.VENDOR_SUSPEND]: {
    functionNames: ['suspend_vendor'],
    contractIdKey: VENDOR_REGISTRY_CONTRACT_ID_KEY,
  },
};

type StellarTransaction = StellarSdk.Transaction | StellarSdk.FeeBumpTransaction;
type StellarOperation = StellarSdk.Transaction['operations'][number];

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  private readonly horizonServer: StellarSdk.Horizon.Server;
  private readonly networkPassphrase: string;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
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

  async submitTransaction(
    wallet: string,
    dto: SubmitTransactionRequestDto,
  ): Promise<SubmitTransactionResponseDto> {
    const transaction = this.parseXdr(dto.xdr);

    // 1. The declared type must match the operations actually contained in the XDR.
    this.assertOperationAllowlist(transaction, dto.type);

    // 2. The authenticated wallet must be the source account or an authorizer.
    this.assertWalletAuthorizes(transaction, wallet);

    const transactionHash = transaction.hash().toString('hex');

    // 3. Idempotency: an already-recorded hash is returned as-is, never
    //    re-submitted to Horizon.
    const existing = await this.findTransactionRecord(transactionHash);
    if (existing) {
      this.logger.log(
        `Duplicate submission — returning existing record for hash ${transactionHash} (status: ${existing.status ?? 'pending'})`,
      );
      return {
        transactionHash,
        status: existing.status ?? 'pending',
        duplicate: true,
      };
    }

    // 4. Persist first so persistence failures surface instead of being
    //    silently dropped. The unique hash indexes backstop the check above
    //    against concurrent duplicate submissions.
    let lookupColumn: TransactionLookupColumn | null = null;
    try {
      lookupColumn = await this.persistTransactionRecord(wallet, transactionHash, dto.type, dto.xdr);
    } catch (error) {
      if (this.isUniqueViolationError(error)) {
        const existingAfterRace = await this.findTransactionRecord(transactionHash);
        if (existingAfterRace) {
          return {
            transactionHash,
            status: existingAfterRace.status ?? 'pending',
            duplicate: true,
          };
        }
      }

      throw new InternalServerErrorException({
        code: 'TRANSACTION_PERSISTENCE_FAILED',
        message: 'Failed to record the transaction locally. No transaction was submitted to the Stellar network — please try again.',
      });
    }

    // 5. Submit to Horizon only after the local record exists, so the
    //    transaction hash is always known to the status checker / indexer.
    //    When Horizon rejects the transaction (or submission fails
    //    unexpectedly), the persisted record is marked failed so it does not
    //    linger as a stale `pending` row attributable to the submitting
    //    wallet.
    try {
      await this.horizonServer.submitTransaction(transaction);
    } catch (error) {
      await this.markTransactionFailed(lookupColumn, transactionHash, error);
      this.handleHorizonError(error);
    }

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

  /**
   * Rejects transactions whose operations do not match the declared type.
   * Every operation must be a Soroban contract invocation whose function name
   * is allowlisted for the type, targeting the contract configured for that
   * flow when a contract ID is configured.
   */
  private assertOperationAllowlist(transaction: StellarTransaction, type: TransactionType): void {
    const allowlist = TRANSACTION_TYPE_ALLOWLIST[type];
    const operations = this.getInnerTransaction(transaction).operations;

    if (!operations || operations.length === 0) {
      throw new BadRequestException({
        code: 'TRANSACTION_TYPE_MISMATCH',
        message: `Transaction for type '${type}' must contain at least one operation.`,
      });
    }

    for (const operation of operations) {
      if (operation.type !== 'invokeHostFunction') {
        throw new BadRequestException({
          code: 'TRANSACTION_OPERATION_NOT_ALLOWED',
          message: `Operation '${operation.type}' is not allowed for transaction type '${type}'. Only Soroban contract invocations are accepted.`,
        });
      }

      const invocation = this.extractInvocationAttributes(operation);
      if (!invocation.functionName) {
        throw new BadRequestException({
          code: 'TRANSACTION_TYPE_MISMATCH',
          message: `Could not determine the invoked contract function for transaction type '${type}'.`,
        });
      }

      if (!allowlist.functionNames.includes(invocation.functionName)) {
        throw new BadRequestException({
          code: 'TRANSACTION_TYPE_MISMATCH',
          message: `Transaction type '${type}' does not allow contract function '${invocation.functionName}'. Allowed: ${allowlist.functionNames.join(', ')}.`,
        });
      }

      // Fail closed on the contract ID: the allowlist never degrades to
      // function-name-only matching. If the contract for this flow is not
      // configured, submissions of this type are disabled rather than
      // accepting invocations of attacker-deployed contracts whose functions
      // share StepFi names.
      const expectedContractId = this.configService.get<string>(allowlist.contractIdKey);
      if (!expectedContractId) {
        throw new ServiceUnavailableException({
          code: 'TRANSACTION_CONTRACT_NOT_CONFIGURED',
          message: `The contract for transaction type '${type}' is not configured on the server. Submission is disabled until the contract ID is set.`,
        });
      }

      // The target contract must be determinable from the XDR — a matching
      // function name is not enough.
      if (!invocation.contractId) {
        throw new BadRequestException({
          code: 'TRANSACTION_TYPE_MISMATCH',
          message: `Could not determine the target contract address for transaction type '${type}'.`,
        });
      }

      if (invocation.contractId !== expectedContractId.trim()) {
        throw new BadRequestException({
          code: 'TRANSACTION_TYPE_MISMATCH',
          message: `Transaction type '${type}' must invoke contract ${expectedContractId}, but the XDR targets ${invocation.contractId}.`,
        });
      }
    }
  }

  /**
   * Rejects third-party-sourced XDR: the authenticated wallet must be the
   * transaction source (the inner source for fee-bump transactions), or must
   * appear as an authorized address in the Soroban invocation auth. This
   * prevents transactions signed by entirely different accounts from being
   * recorded as the authenticated user's activity.
   */
  private assertWalletAuthorizes(transaction: StellarTransaction, wallet: string): void {
    const effectiveSource =
      transaction instanceof StellarSdk.FeeBumpTransaction
        ? transaction.innerTransaction.source
        : transaction.source;

    if (effectiveSource === wallet) {
      return;
    }

    if (this.collectAuthorizedAddresses(transaction).includes(wallet)) {
      return;
    }

    throw new BadRequestException({
      code: 'TRANSACTION_SOURCE_MISMATCH',
      message:
        'The transaction source account does not match the authenticated wallet, and the wallet is not an authorizer of this transaction. Only transactions signed by your wallet can be submitted.',
    });
  }

  private getInnerTransaction(transaction: StellarTransaction): StellarSdk.Transaction {
    return transaction instanceof StellarSdk.FeeBumpTransaction
      ? transaction.innerTransaction
      : transaction;
  }

  /**
   * Extracts the invoked function name, target contract ID, and authorization
   * entries from a Soroban invokeHostFunction operation. Reaches into the XDR
   * object's internal structure (no public accessor), mirroring the existing
   * pattern in the transaction status checker.
   */
  private extractInvocationAttributes(operation: StellarOperation): {
    functionName?: string;
    contractId?: string;
    auth: unknown[];
  } {
    const func = (operation as { func?: unknown }).func;
    const attributes = (func as { _value?: { _attributes?: unknown } })?._value?._attributes as
      | {
          functionName?: { toString?: () => string };
          contractAddress?: unknown;
          auth?: unknown[];
        }
      | undefined;

    const functionName = attributes?.functionName?.toString?.();

    let contractId: string | undefined;
    const rawContractAddress = attributes?.contractAddress;
    if (rawContractAddress) {
      const buffer = Buffer.isBuffer(rawContractAddress)
        ? rawContractAddress
        : typeof (rawContractAddress as { value?: () => unknown }).value === 'function'
          ? (rawContractAddress as { value: () => unknown }).value()
          : undefined;

      if (Buffer.isBuffer(buffer) && buffer.length === 32) {
        try {
          contractId = StellarSdk.StrKey.encodeContract(buffer);
        } catch {
          contractId = undefined;
        }
      }
    }

    const auth = Array.isArray(attributes?.auth) ? attributes.auth : [];

    return { functionName, contractId, auth };
  }

  /**
   * Collects the wallet addresses authorized by a transaction's Soroban auth
   * entries (both address- and account-credential forms). Malformed entries
   * are skipped — the source-account check still applies.
   */
  private collectAuthorizedAddresses(transaction: StellarTransaction): string[] {
    const addresses: string[] = [];
    const operations = this.getInnerTransaction(transaction).operations;

    for (const operation of operations) {
      if (operation.type !== 'invokeHostFunction') {
        continue;
      }

      for (const entry of this.extractInvocationAttributes(operation).auth) {
        try {
          const credentials = (entry as { credentials?: () => unknown }).credentials?.();
          const switchName = (credentials as { switch?: () => { name?: string } })?.switch?.()?.name;
          const value = (credentials as { value?: () => unknown })?.value?.();
          const addressHolder =
            switchName === 'sorobanCredentialsAccount'
              ? (value as { account?: () => unknown })?.account?.()
              : (value as { address?: () => unknown })?.address?.();
          const address = (addressHolder as {
            address?: () => { toString?: () => string };
          })?.address?.()?.toString?.();

          if (address && !addresses.includes(address)) {
            addresses.push(address);
          }
        } catch {
          // Skip malformed auth entries; the source-account check still applies.
        }
      }
    }

    return addresses;
  }

  private isUniqueViolationError(error: unknown): boolean {
    const err = error as { code?: string; message?: string };
    const code = err?.code;
    const message = err?.message?.toLowerCase() ?? '';
    return code === '23505' || message.includes('duplicate key value violates unique constraint');
  }

  /**
   * Maps a Horizon submission error to the HTTP status, typed code, and
   * user-facing message that should be returned to the client. Shared by
   * `handleHorizonError` (which throws) and `markTransactionFailed` (which
   * records the same message on the local row).
   */
  private describeHorizonError(error: unknown): {
    httpStatus: number;
    code: string;
    message: string;
  } {
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
          return {
            httpStatus: 400,
            code: `STELLAR_${code.toUpperCase()}`,
            message: HORIZON_ERROR_MAP[code],
          };
        }
      }

      return {
        httpStatus: 400,
        code: 'STELLAR_TRANSACTION_FAILED',
        message: `Transaction rejected by the Stellar network: ${allCodes.join(', ')}`,
      };
    }

    const message = err?.message ?? 'Unknown error';
    if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('network')) {
      return {
        httpStatus: 503,
        code: 'STELLAR_NETWORK_UNAVAILABLE',
        message: 'Stellar network is temporarily unavailable. Please try again later.',
      };
    }

    this.logger.error(`Horizon submission error: ${message}`);
    return {
      httpStatus: 500,
      code: 'STELLAR_SUBMISSION_FAILED',
      message: 'Failed to submit transaction to the Stellar network. Please try again.',
    };
  }

  private handleHorizonError(error: unknown): never {
    const details = this.describeHorizonError(error);

    if (details.httpStatus === 503) {
      throw new ServiceUnavailableException({ code: details.code, message: details.message });
    }
    if (details.httpStatus === 500) {
      throw new InternalServerErrorException({ code: details.code, message: details.message });
    }
    throw new BadRequestException({ code: details.code, message: details.message });
  }

  /**
   * Best-effort update of the persisted record when Horizon rejected the
   * transaction or submission failed unexpectedly, so the row does not linger
   * as a stale `pending` record attributable to the submitting wallet. On
   * transient network unavailability (503) the outcome is unknown — the
   * transaction may still be in flight — so the row is left `pending` for the
   * status checker to reconcile. Never throws: the original Horizon error is
   * what surfaces to the client.
   */
  private async markTransactionFailed(
    lookupColumn: TransactionLookupColumn | null,
    hash: string,
    error: unknown,
  ): Promise<void> {
    if (!lookupColumn) {
      return;
    }

    const details = this.describeHorizonError(error);
    if (details.httpStatus === 503) {
      return;
    }

    try {
      const failedAt = new Date().toISOString();
      const client = this.supabaseService.getServiceRoleClient();
      const { error: updateError } = await client
        .from('transactions')
        .update({
          status: 'failed',
          error: details.message,
          completed_at: failedAt,
          updated_at: failedAt,
        })
        .eq(lookupColumn, hash);

      if (updateError) {
        this.logger.warn(`Failed to mark transaction ${hash} as failed: ${updateError.message}`);
      }
    } catch (persistError) {
      this.logger.warn(
        `Failed to mark transaction ${hash} as failed: ${(persistError as Error).message}`,
      );
    }
  }

  private async persistTransactionRecord(
    wallet: string,
    hash: string,
    type: TransactionType,
    xdr: string,
  ): Promise<TransactionLookupColumn> {
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
      return 'transaction_hash';
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

    return 'hash';
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
