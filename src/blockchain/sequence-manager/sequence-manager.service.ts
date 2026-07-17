import {
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SequenceMetrics } from './sequence-manager.metrics';

/**
 * Builder callback for a server-signed Stellar transaction.
 *
 * Receives an `Account` already populated with the source public key and the
 * next available sequence number (managed by `SequenceManagerService`). The
 * caller adds operations, time bounds, and memo; the manager signs and
 * submits before returning.
 */
export type ServerTransactionBuilder = (
  account: StellarSdk.Account,
) => StellarSdk.Transaction;

export interface ServerTransactionSpec {
  build: ServerTransactionBuilder;
}

export interface ServerTransactionResult {
  hash: string;
  sourceAccount: string;
  sequence: string;
}

interface ManagedAccountState {
  publicKey: string;
  secretKey: StellarSdk.Keypair;
  /** Tail of the per-account serialization promise chain. */
  inflight: Promise<unknown>;
  /** Tail of the per-account Horizon re-sync lock chain. */
  reSyncLock: Promise<unknown>;
  /**
   * The sequence number about to be used for the *next* submission on
   * this account. Invariant: starts at `onChain + 1` after every sync,
   * and is incremented to `onChain + 2` only after Horizon confirms
   * acceptance of the transaction that used `onChain + 1`.
   */
  pendingSequence: bigint | null;
}

/**
 * Sequence-number allocator for server-signed Stellar transactions.
 *
 * Problem
 * -------
 * Server-submitted transactions (loan funding, default detection, admin
 * ops) all need to come from a protocol-controlled source account. Each
 * transaction must carry a sequence number that is exactly one greater than
 * the previously submitted transaction from that account. Without
 * coordination, concurrent callers fetch the same sequence and the second
 * submission fails with `tx_bad_seq`.
 *
 * Solution
 * --------
 * - One or more Stripe-style "channel accounts" are pre-loaded from
 *   configuration (env vars `STELLAR_SOURCE_ACCOUNT_SECRET` and
 *   `STELLAR_CHANNEL_ACCOUNTS`).
 * - Each account keeps a monotonically increasing `nextSequence` counter,
 *   cached in memory and refreshed from Horizon on startup or on
 *   `tx_bad_seq` rejection.
 * - Submissions for a single account are serialized through an in-memory
 *   promise chain: callers run ordered, never parallel, on the same
 *   source. Channel pools restore true parallelism by fanning out across
 *   independent accounts, each with its own sequence counter.
 *
 * Hard invariants
 * ---------------
 * - Sequence numbers handed out by this manager are unique per account.
 * - On Horizon rejection of `tx_bad_seq`, the manager re-syncs the
 *   counter from Horizon and retries up to `STELLAR_BAD_SEQ_MAX_RETRIES`
 *   additional times (default 3).
 * - If the manager is configured with no source account, every public
 *   method is a no-op and `submitServerTransaction` throws — this is
 *   intentional so the rest of the API can boot in dev/CI without
 *   Stellar credentials.
 */
@Injectable()
export class SequenceManagerService implements OnModuleInit {
  private readonly logger = new Logger(SequenceManagerService.name);
  private readonly horizonServer: StellarSdk.Horizon.Server;
  private readonly networkPassphrase: string;
  private readonly maxRetries: number;

  private readonly accounts: ManagedAccountState[] = [];
  private nextAccountIndex = 0;

  constructor(
    private readonly configService: ConfigService,
    @Optional() private readonly metrics?: SequenceMetrics,
  ) {
    const horizonUrl =
      this.configService.get<string>('STELLAR_HORIZON_URL') ||
      'https://horizon-testnet.stellar.org';

    this.networkPassphrase =
      this.configService.get<string>('STELLAR_NETWORK_PASSPHRASE') ||
      StellarSdk.Networks.TESTNET;

    this.horizonServer = new StellarSdk.Horizon.Server(horizonUrl);

    const retries =
      this.configService.get<string>('STELLAR_BAD_SEQ_MAX_RETRIES') ?? '3';
    this.maxRetries = Math.max(
      1,
      Number.parseInt(retries, 10) || 3,
    );

    this.logger.log(`SequenceManagerService Horizon initialized: ${horizonUrl}`);

    if (this.metrics) {
      this.metrics.setInFlight(0);
      this.metrics.resetBadSeqRetries();
    }
  }

  onModuleInit(): void {
    this.initializeAccounts();
  }

  /**
   * Returns true if at least one managed account is configured and ready.
   */
  isEnabled(): boolean {
    return this.accounts.length > 0;
  }

  /**
   * Number of managed accounts (1 source + N channel).
   */
  getAccountCount(): number {
    return this.accounts.length;
  }

  /**
   * Public keys of every managed account, in allocation order.
   */
  getManagedAccounts(): string[] {
    return this.accounts.map((account) => account.publicKey);
  }

  /**
   * Submit a server-signed transaction through a managed account.
   *
   * Round-robins across the configured source + channel accounts. Each
   * account has its own serialization mutex and sequence counter, so
   * channel pools enable true concurrent in-flight transactions while a
   * single source account guarantees strict ordering.
   */
  async submitServerTransaction(
    spec: ServerTransactionSpec,
  ): Promise<ServerTransactionResult> {
    const totalAccounts = this.accounts.length;
    if (totalAccounts === 0) {
      throw new Error(
        'SequenceManager: no source account configured (set STELLAR_SOURCE_ACCOUNT_SECRET)',
      );
    }

    const account = this.acquireNextAccount();
    if (this.metrics) {
      this.metrics.incInFlight(account.publicKey);
    }

    try {
      return await this.runSerialized(account, () =>
        this.submitWithRetries(account, spec),
      );
    } finally {
      if (this.metrics) {
        this.metrics.decInFlight(account.publicKey);
      }
    }
  }

  private acquireNextAccount(): ManagedAccountState {
    const account = this.accounts[this.nextAccountIndex]!;
    this.nextAccountIndex = (this.nextAccountIndex + 1) % this.accounts.length;
    return account;
  }

  /**
   * Run `fn` after every previously enqueued call on this account has
   * settled. Releases the lock whether `fn` resolves or rejects, so a
   * single bad submission does not wedge the channel.
   */
  private runSerialized<T>(
    account: ManagedAccountState,
    fn: () => Promise<T>,
  ): Promise<T> {
    const previous = account.inflight;
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    account.inflight = next;

    return previous
      .catch(() => undefined)
      .then(() => fn())
      .finally(() => {
        release();
      });
  }

  private async submitWithRetries(
    account: ManagedAccountState,
    spec: ServerTransactionSpec,
  ): Promise<ServerTransactionResult> {
    if (account.pendingSequence === null) {
      account.pendingSequence = await this.fetchPendingSequence(account);
    }

    const totalAttempts = this.maxRetries + 1;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      const sdkAccount = new StellarSdk.Account(
        account.publicKey,
        account.pendingSequence.toString(),
      );
      const transaction = spec.build(sdkAccount);
      transaction.sign(account.secretKey);

      try {
        const response = await this.horizonServer.submitTransaction(transaction);
        const usedSequence = account.pendingSequence;
        account.pendingSequence = account.pendingSequence + 1n;

        if (this.metrics) {
          this.metrics.observeSequence(account.publicKey, account.pendingSequence);
          this.metrics.incSubmitted(account.publicKey);
        }

        return {
          hash: response.hash,
          sourceAccount: account.publicKey,
          sequence: usedSequence.toString(),
        };
      } catch (error) {
        if (!this.isBadSeqError(error)) {
          if (this.metrics) {
            this.metrics.incSubmissionError(account.publicKey, this.classifyError(error));
          }
          throw error;
        }

        if (this.metrics) {
          this.metrics.incBadSeqRetry(account.publicKey);
        }

        this.logger.warn(
          `SequenceManager: tx_bad_seq on attempt ${attempt} for ${account.publicKey} — re-syncing from Horizon`,
        );

        account.pendingSequence = await this.fetchPendingSequence(account);

        if (attempt >= totalAttempts) {
          if (this.metrics) {
            this.metrics.incSubmissionError(account.publicKey, 'tx_bad_seq_exhausted');
          }
          throw new Error(
            `SequenceManager: tx_bad_seq persisted after ${totalAttempts} attempts for ${account.publicKey}`,
          );
        }
      }
    }

    throw new Error('SequenceManager: unreachable — submission loop exited without result');
  }

  /**
   * Read the on-chain sequence number from Horizon and return the next
   * sequence usable for a new transaction. Multiple concurrent re-sync
   * requests for the same account share a single Horizon call through a
   * per-account lock chain.
   */
  private async fetchPendingSequence(account: ManagedAccountState): Promise<bigint> {
    const previous = account.reSyncLock;
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    account.reSyncLock = next;

    try {
      await previous.catch(() => undefined);

      try {
        const response = await this.horizonServer.loadAccount(account.publicKey);
        // Horizon.AccountResponse.sequence is a string; convert to BigInt so
        // arithmetic stays correct as the protocol age grows.
        const onChain = this.readSequenceNumber(response);
        return onChain + 1n;
      } catch (error) {
        if (error instanceof StellarSdk.NotFoundError) {
          throw new Error(
            `SequenceManager: source account ${account.publicKey} not found on Horizon`,
          );
        }
        throw error;
      }
    } finally {
      release();
    }
  }

  /**
   * Read the on-chain sequence number from whichever Horizon response
   * shape the SDK exposes. Different SDK versions expose the value as
   * `sequence` or `sequenceNumber`, and TS bindings treat the latter as
   * a method — accept either without wandering into `any`.
   */
  private readSequenceNumber(response: unknown): bigint {
    const candidate = response as {
      sequence?: string | number | bigint;
      sequenceNumber?: string | number | (() => string | number);
    };

    const raw =
      candidate.sequence ??
      (typeof candidate.sequenceNumber === 'function'
        ? candidate.sequenceNumber()
        : candidate.sequenceNumber);

    if (raw === undefined || raw === null) {
      throw new Error('SequenceManager: Horizon account response missing sequence field');
    }

    return typeof raw === 'bigint' ? raw : BigInt(raw);
  }

  private isBadSeqError(error: unknown): boolean {
    const resultCodes = this.extractResultCodes(error);
    return resultCodes?.transaction === 'tx_bad_seq';
  }

  private classifyError(error: unknown): string {
    const resultCodes = this.extractResultCodes(error);
    if (resultCodes?.transaction) {
      return resultCodes.transaction;
    }
    const message = (error as { message?: string })?.message ?? 'unknown';
    if (message.toLowerCase().includes('timeout')) return 'timeout';
    if (message.toLowerCase().includes('network')) return 'network';
    return 'error';
  }

  private extractResultCodes(
    error: unknown,
  ): { transaction?: string; operations?: string[] } | null {
    const candidate = error as {
      response?: {
        data?: {
          extras?: { result_codes?: { transaction?: string; operations?: string[] } };
        };
      };
    };
    return candidate?.response?.data?.extras?.result_codes ?? null;
  }

  private initializeAccounts(): void {
    const sourceSecret =
      this.configService.get<string>('STELLAR_SOURCE_ACCOUNT_SECRET');

    const channelSecrets = (
      this.configService.get<string>('STELLAR_CHANNEL_ACCOUNTS') ?? ''
    )
      .split(',')
      .map((secret) => secret.trim())
      .filter((secret) => secret.length > 0);

    const allSecrets = [
      ...(sourceSecret ? [sourceSecret] : []),
      ...channelSecrets,
    ];

    if (allSecrets.length === 0) {
      this.logger.warn(
        'SequenceManager: STELLAR_SOURCE_ACCOUNT_SECRET not set — server-signed submissions are disabled',
      );
      return;
    }

    let dedupedDuplicates = 0;
    for (const secret of allSecrets) {
      try {
        const keypair = StellarSdk.Keypair.fromSecret(secret);
        const publicKey = keypair.publicKey();

        if (this.accounts.some((existing) => existing.publicKey === publicKey)) {
          dedupedDuplicates += 1;
          this.logger.warn(
            `SequenceManager: skipping duplicate account ${publicKey} (same secret repeated or channel collision with source)`,
          );
          continue;
        }

        this.accounts.push({
          publicKey,
          secretKey: keypair,
          inflight: Promise.resolve(),
          reSyncLock: Promise.resolve(),
          pendingSequence: null,
        });
      } catch (error) {
        this.logger.error(
          `SequenceManager: failed to load secret key (${(error as Error).message.slice(0, 80)})`,
        );
      }
    }

    if (this.accounts.length === 0) {
      this.logger.error(
        'SequenceManager: no valid accounts configured — server-signed submissions are disabled',
      );
      return;
    }

    const channelCount = this.accounts.length - (sourceSecret ? 1 : 0);
    this.logger.log(
      `SequenceManager: ${this.accounts.length} managed account(s) ` +
        `(${sourceSecret ? '1 source' : '0 source'} + ${channelCount} channel, ${dedupedDuplicates} duplicate(s) skipped)`,
    );
  }
}
