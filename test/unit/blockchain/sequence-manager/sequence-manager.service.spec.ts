import { ConfigService } from '@nestjs/config';
import { TestingModule, Test } from '@nestjs/testing';
import * as StellarSdk from 'stellar-sdk';
import {
  SequenceManagerService,
} from '../../../../src/blockchain/sequence-manager/sequence-manager.service';
import {
  SequenceMetrics,
  SOURCE_SUBMISSIONS_IN_FLIGHT,
  SOURCE_BAD_SEQ_RETRIES_TOTAL,
  SOURCE_SUBMISSIONS_TOTAL,
  SOURCE_NEXT_SEQUENCE,
} from '../../../../src/blockchain/sequence-manager/sequence-manager.metrics';

const mockLoadAccount = jest.fn();
const mockSubmitTransaction = jest.fn();

jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: jest.fn().mockImplementation(() => ({
        loadAccount: mockLoadAccount,
        submitTransaction: mockSubmitTransaction,
      })),
    },
  };
});

// ───────────────────────── real keypairs (round-trip cleanly with fromSecret) ─────────────────────────

const SOURCE_KP = StellarSdk.Keypair.random();
const CHANNEL_KP = StellarSdk.Keypair.random();
const SOURCE_PUBLIC = SOURCE_KP.publicKey();
const CHANNEL_PUBLIC = CHANNEL_KP.publicKey();
const DESTINATION_PUBLIC = StellarSdk.Keypair.random().publicKey();

interface BuildServiceOptions {
  // `true` means run with NO source / channel accounts configured. `false`
  // (or omitted) means use the default source + channel pair from real
  // keypairs, so initializeAccounts populates this.accounts.
  noAccounts?: boolean;
  // Override the channel-account list (empty by default for single-source
  // tests). Each entry is a real Stellar secret (start with 'S').
  channelSecrets?: string[];
  maxRetries?: string;
}

function buildConfig(opts: BuildServiceOptions = {}): {
  get: (key: string) => string | undefined;
} {
  return {
    get: (key: string): string | undefined => {
      if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
      if (key === 'STELLAR_NETWORK_PASSPHRASE') return StellarSdk.Networks.TESTNET;
      if (key === 'STELLAR_SOURCE_ACCOUNT_SECRET') {
        return opts.noAccounts ? undefined : SOURCE_KP.secret();
      }
      if (key === 'STELLAR_CHANNEL_ACCOUNTS') {
        const secrets = opts.channelSecrets ?? (opts.noAccounts ? [] : [CHANNEL_KP.secret()]);
        return secrets.join(',');
      }
      if (key === 'STELLAR_BAD_SEQ_MAX_RETRIES') {
        return opts.maxRetries ?? '3';
      }
      return undefined;
    },
  };
}

function buildPaymentTx(account: StellarSdk.Account): StellarSdk.Transaction {
  return new StellarSdk.TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: DESTINATION_PUBLIC,
        asset: StellarSdk.Asset.native(),
        amount: '1',
      }),
    )
    .setTimeout(30)
    .build();
}

/**
 * Build a fresh SequenceMetrics mock whose methods are jest.fn spies.
 * Injecting via useValue bypasses @InjectMetric/Prometheus entirely so
 * tests don't need to wire @willsoto/nestjs-prometheus into the test
 * module (each PrometheusModule.register() call constructs its own
 * scoped counter/Gauge namespace, which would otherwise make snapshots
 * brittle).
 */
function buildMockMetrics(): jest.Mocked<SequenceMetrics> {
  return {
    incInFlight: jest.fn(),
    decInFlight: jest.fn(),
    setInFlight: jest.fn(),
    incBadSeqRetry: jest.fn(),
    resetBadSeqRetries: jest.fn(),
    incSubmitted: jest.fn(),
    incSubmissionError: jest.fn(),
    observeSequence: jest.fn(),
    badSeqRetriesSnapshot: jest.fn(),
  } as unknown as jest.Mocked<SequenceMetrics>;
}

async function makeModule(
  opts: BuildServiceOptions = {},
): Promise<{ service: SequenceManagerService; metrics: jest.Mocked<SequenceMetrics> }> {
  jest.clearAllMocks();

  const mockMetrics = buildMockMetrics();

  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      SequenceManagerService,
      { provide: ConfigService, useValue: buildConfig(opts) },
      { provide: SequenceMetrics, useValue: mockMetrics },
      // Also bind the metric tokens so @InjectMetric in
      // SequenceManagerService.@Optional SequenceMetrics doesn't trip.
      {
        provide: SOURCE_SUBMISSIONS_IN_FLIGHT,
        useValue: { inc: jest.fn(), dec: jest.fn(), labels: jest.fn().mockReturnThis(), set: jest.fn() },
      },
      {
        provide: SOURCE_BAD_SEQ_RETRIES_TOTAL,
        useValue: { inc: jest.fn(), labels: jest.fn().mockReturnThis(), reset: jest.fn() },
      },
      {
        provide: SOURCE_SUBMISSIONS_TOTAL,
        useValue: { inc: jest.fn(), labels: jest.fn().mockReturnThis() },
      },
      {
        provide: SOURCE_NEXT_SEQUENCE,
        useValue: { set: jest.fn(), labels: jest.fn().mockReturnThis() },
      },
    ],
  }).compile();

  // Nest's compile() does NOT auto-fire lifecycle hooks in @nestjs/testing.
  // init() is what actually runs onModuleInit() so initializeAccounts
  // populates this.accounts from config.
  await moduleRef.init();

  return {
    service: moduleRef.get<SequenceManagerService>(SequenceManagerService),
    metrics: mockMetrics,
  };
}

describe('SequenceManagerService', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  // ───────────────────────── config parsing ─────────────────────────

  describe('when no source account is configured', () => {
    it('reports disabled and rejects submissions', async () => {
      const { service } = await makeModule({ noAccounts: true });

      expect(service.isEnabled()).toBe(false);
      expect(service.getAccountCount()).toBe(0);

      await expect(
        service.submitServerTransaction({ build: buildPaymentTx }),
      ).rejects.toThrow(/no source account configured/i);
    });
  });

  describe('when source and channel accounts are configured', () => {
    it('exposes both accounts and reports enabled', async () => {
      const { service } = await makeModule();
      expect(service.isEnabled()).toBe(true);
      expect(service.getAccountCount()).toBe(2);
      const accounts = service.getManagedAccounts();
      expect(accounts).toContain(SOURCE_PUBLIC);
      expect(accounts).toContain(CHANNEL_PUBLIC);
    });

    it('deduplicates channel accounts whose public key collides with the source', async () => {
      const { service } = await makeModule({
        channelSecrets: [SOURCE_KP.secret(), CHANNEL_KP.secret()],
      });
      expect(service.getAccountCount()).toBe(2);
    });

    it('deduplicates channels that collide with each other', async () => {
      const { service } = await makeModule({
        channelSecrets: [
          CHANNEL_KP.secret(),
          CHANNEL_KP.secret(),
          SOURCE_KP.secret(),
        ],
      });
      expect(service.getAccountCount()).toBe(2);
      expect(service.getManagedAccounts()).toEqual(
        expect.arrayContaining([CHANNEL_PUBLIC, SOURCE_PUBLIC]),
      );
    });
  });

  // ───────────────────────── concurrency on a single account ─────────────────────────

  describe('parallel submissions on a single-source config', () => {
    it('hands out monotonic, unique sequence numbers to every caller', async () => {
      const { service, metrics } = await makeModule({
        channelSecrets: [],
      });
      expect(service.getAccountCount()).toBe(1);

      // Use mockResolvedValueOnce on the FIRST loadAccount call so that
      // a stale resolved value from a prior test cannot bleed into this
      // one — clearing the mock via resetAllMocks would also work but
      // mockResolvedValueOnce is the more targeted reset.
      mockLoadAccount.mockReset();
      mockLoadAccount.mockResolvedValue({ sequence: '100' });
      const recordedSequences = new Set<string>();
      mockSubmitTransaction.mockReset();
      mockSubmitTransaction.mockImplementation(
        async (tx: unknown) => {
          // Coerce to string for Set membership — stellar-sdk v11 may
          // shape tx.sequence as a BigInt-shaped value at runtime.
          const sequence: string = String((tx as { sequence: unknown }).sequence);
          if (recordedSequences.has(sequence)) {
            throw new Error(`Sequence ${sequence} was used twice`);
          }
          recordedSequences.add(sequence);
          return { hash: `hash-${sequence}` };
        },
      );

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          service.submitServerTransaction({ build: buildPaymentTx }),
        ),
      );

      // Exactly 10 submissions, all unique sequences, all on the source
      // account, Horizon was hit only once for the initial sync.
      expect(mockSubmitTransaction).toHaveBeenCalledTimes(10);
      expect(mockLoadAccount).toHaveBeenCalledTimes(1);
      expect(results.every((r) => r.sourceAccount === SOURCE_PUBLIC)).toBe(true);
      expect(results.every((r) => BigInt(r.sequence) > 0n)).toBe(true);
      expect(recordedSequences.size).toBe(10);
      // All recorded sequences must be distinct integers strictly
      // monotonically increasing by exactly 1n. We assert ordering on
      // the service's returned sequence numbers (which is the source of
      // truth — recordedSequences is just to detect duplicates).
      const returnedSequences = results
        .map((r) => BigInt(r.sequence))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      for (let i = 1; i < returnedSequences.length; i += 1) {
        const prev = returnedSequences[i - 1]!;
        const curr = returnedSequences[i]!;
        expect(curr - prev).toBe(1n);
      }
      expect(returnedSequences[0]).toBeGreaterThanOrEqual(101n);
      expect(metrics.incSubmitted).toHaveBeenCalledTimes(10);
    });
  });

  // ───────────────────────── tx_bad_seq ─────────────────────────

  describe('tx_bad_seq handling', () => {
    it('re-syncs from Horizon, retries, and eventually succeeds', async () => {
      const { service } = await makeModule({ channelSecrets: [] });

      mockLoadAccount
        .mockResolvedValueOnce({ sequence: '100' })
        .mockResolvedValueOnce({ sequence: '200' });
      mockSubmitTransaction
        .mockRejectedValueOnce({
          response: {
            data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } },
          },
        })
        .mockResolvedValueOnce({ hash: 'recovered-hash' });

      const result = await service.submitServerTransaction({
        build: buildPaymentTx,
      });

      expect(result.hash).toBe('recovered-hash');
      expect(result.sourceAccount).toBe(SOURCE_PUBLIC);
      expect(mockSubmitTransaction).toHaveBeenCalledTimes(2);
      expect(mockLoadAccount).toHaveBeenCalledTimes(2);
    });

    it('throws when tx_bad_seq exhausts the retry budget', async () => {
      const { service } = await makeModule({
        channelSecrets: [],
        maxRetries: '2',
      });

      mockLoadAccount.mockResolvedValue({ sequence: '0' });
      mockSubmitTransaction.mockRejectedValue({
        response: {
          data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } },
        },
      });

      await expect(
        service.submitServerTransaction({ build: buildPaymentTx }),
      ).rejects.toThrow(/tx_bad_seq persisted/i);
      // initial + 2 retries = 3 attempts
      expect(mockSubmitTransaction).toHaveBeenCalledTimes(3);
    });

    it('increments the bad-seq counter for every retry', async () => {
      const { service, metrics } = await makeModule({
        channelSecrets: [],
        maxRetries: '3',
      });

      mockLoadAccount.mockResolvedValue({ sequence: '0' });
      mockSubmitTransaction.mockRejectedValue({
        response: {
          data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } },
        },
      });

      await expect(
        service.submitServerTransaction({ build: buildPaymentTx }),
      ).rejects.toThrow(/tx_bad_seq persisted/i);

      // Initial attempt + 3 retries = 4 attempts all rejected → 4 increments.
      expect(metrics.incBadSeqRetry).toHaveBeenCalledTimes(4);
      for (const call of metrics.incBadSeqRetry.mock.calls) {
        expect(call[0]).toBe(SOURCE_PUBLIC);
      }
      // And the error-tagged counter should reflect 'tx_bad_seq_exhausted'.
      expect(metrics.incSubmissionError).toHaveBeenCalledWith(
        SOURCE_PUBLIC,
        'tx_bad_seq_exhausted',
      );
    });
  });

  // ───────────────────────── restart re-sync ─────────────────────────

  describe('fresh manager always re-syncs from Horizon on first use', () => {
    it('reads the latest sequence from Horizon before the first submission', async () => {
      const { service } = await makeModule({ channelSecrets: [] });

      mockLoadAccount.mockResolvedValue({ sequence: '500' });
      mockSubmitTransaction.mockResolvedValue({ hash: 'fresh-hash' });

      const result = await service.submitServerTransaction({
        build: buildPaymentTx,
      });

      expect(result).toEqual({
        hash: 'fresh-hash',
        sourceAccount: SOURCE_PUBLIC,
        sequence: '501',
      });
      expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    });
  });

  // ───────────────────────── channel pool round-robin ─────────────────────────

  describe('channel-account pool', () => {
    it('spreads parallel callers across channel accounts so they do not collide', async () => {
      const { service } = await makeModule();

      mockLoadAccount.mockResolvedValue({ sequence: '0' });
      mockSubmitTransaction.mockImplementation(
        async (tx: StellarSdk.Transaction) => ({
          hash: `hash-${tx.source}-${tx.sequence}`,
        }),
      );

      const CALLERS = 7;
      const submissions = await Promise.all(
        Array.from({ length: CALLERS }, () =>
          service.submitServerTransaction({ build: buildPaymentTx }),
        ),
      );

      expect(submissions).toHaveLength(CALLERS);
      const observedPerAccount = submissions.reduce<Map<string, number>>(
        (acc, r) => acc.set(r.sourceAccount, (acc.get(r.sourceAccount) ?? 0) + 1),
        new Map(),
      );
      expect(observedPerAccount.get(SOURCE_PUBLIC) ?? 0).toBeGreaterThanOrEqual(3);
      expect(observedPerAccount.get(CHANNEL_PUBLIC) ?? 0).toBeGreaterThanOrEqual(3);
      expect(
        (observedPerAccount.get(SOURCE_PUBLIC) ?? 0) +
          (observedPerAccount.get(CHANNEL_PUBLIC) ?? 0),
      ).toBe(CALLERS);
    });

    it('round-robins strictly: consecutive calls land on different channels', async () => {
      const { service } = await makeModule();
      mockLoadAccount.mockResolvedValue({ sequence: '0' });
      mockSubmitTransaction.mockResolvedValue({ hash: 'ok' });

      const first = await service.submitServerTransaction({ build: buildPaymentTx });
      const second = await service.submitServerTransaction({ build: buildPaymentTx });
      expect(first.sourceAccount).not.toBe(second.sourceAccount);
    });
  });

  // ───────────────────────── non-tx_bad_seq errors ─────────────────────────

  describe('non-tx_bad_seq errors', () => {
    it('propagates Horizon errors without retrying', async () => {
      const { service } = await makeModule({ channelSecrets: [] });

      mockLoadAccount.mockResolvedValue({ sequence: '0' });
      mockSubmitTransaction.mockRejectedValue({
        response: {
          data: {
            extras: {
              result_codes: { transaction: 'op_underfunded', operations: [] },
            },
          },
        },
      });

      await expect(
        service.submitServerTransaction({ build: buildPaymentTx }),
      ).rejects.toMatchObject({
        response: {
          data: {
            extras: {
              result_codes: { transaction: 'op_underfunded' },
            },
          },
        },
      });
      expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
