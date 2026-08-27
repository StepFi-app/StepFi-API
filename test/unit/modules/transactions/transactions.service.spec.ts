import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as StellarSdk from 'stellar-sdk';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { TransactionsService } from '../../../../src/modules/transactions/transactions.service';
import { TransactionType } from '../../../../src/modules/transactions/dto/submit-transaction-request.dto';

const mockTransactionCall = jest.fn();
const mockIncludeFailed = jest.fn();
const mockTransactionsBuilder = jest.fn();
const mockSubmitTransaction = jest.fn();

jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');

  return {
    ...actual,
    Horizon: {
      ...actual.Horizon,
      Server: jest.fn().mockImplementation(() => ({
        submitTransaction: mockSubmitTransaction,
        transactions: mockTransactionsBuilder,
      })),
    },
  };
});

describe('TransactionsService', () => {
  let service: TransactionsService;

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
  const validHash = 'a'.repeat(64);
  const now = '2026-03-23T05:16:00.000Z';

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const mockSupabaseTable = {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn(),
  };

  const mockSupabaseClient = {
    from: jest.fn().mockReturnValue(mockSupabaseTable),
  };

  const mockSupabaseService = {
    getServiceRoleClient: jest.fn().mockReturnValue(mockSupabaseClient),
  };

  const LIQUIDITY_CONTRACT_ID = 'CCBK3YMI3RVGWFUREH5PZMG3HIU3L2XF6YXB2DPFQ4V42Q4JWXPGFSMB';
  const CREDIT_LINE_CONTRACT_ID = StellarSdk.StrKey.encodeContract(
    Buffer.from('credit-line-test-contract-id-0000000000000000'.slice(0, 32)),
  );
  const VENDOR_REGISTRY_CONTRACT_ID = StellarSdk.StrKey.encodeContract(
    Buffer.from('vendor-registry-test-contract-id-0000000000000'.slice(0, 32)),
  );
  const OTHER_CONTRACT_ID = StellarSdk.StrKey.encodeContract(
    Buffer.from('some-unrelated-attacker-contract-id-00000000'.slice(0, 32)),
  );

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
      if (key === 'STELLAR_NETWORK_PASSPHRASE') return StellarSdk.Networks.TESTNET;
      if (key === 'LIQUIDITY_POOL_CONTRACT_ID') return LIQUIDITY_CONTRACT_ID;
      if (key === 'CREDIT_LINE_CONTRACT_ID') return CREDIT_LINE_CONTRACT_ID;
      if (key === 'VENDOR_REGISTRY_CONTRACT_ID') return VENDOR_REGISTRY_CONTRACT_ID;
      return undefined;
    }),
  };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date(now));
    mockTransactionsBuilder.mockReturnValue({
      includeFailed: mockIncludeFailed,
      transaction: mockTransactionCall,
    });
    mockIncludeFailed.mockReturnValue({
      transaction: mockTransactionCall,
    });
    mockTransactionCall.mockReturnValue({
      call: jest.fn(),
    });
    mockSupabaseTable.insert.mockResolvedValue({ error: null });
    mockSupabaseTable.update.mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SupabaseService, useValue: mockSupabaseService },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  function mockDbLookup(record: Record<string, unknown> | null) {
    mockSupabaseTable.select.mockReturnThis();
    mockSupabaseTable.eq.mockReturnThis();
    mockSupabaseTable.maybeSingle.mockResolvedValue({ data: record, error: null });
  }

  function mockTxCallResult(result: unknown) {
    const call = jest.fn().mockResolvedValue(result);
    mockTransactionCall.mockReturnValue({ call });
    return call;
  }

  it('should return finalized cached responses without calling Horizon', async () => {
    mockCacheManager.get.mockResolvedValue({
      hash: validHash,
      status: 'success',
      type: 'deposit' as TransactionType,
      result: {
        ledger: 123,
        operationCount: 1,
        sourceAccount: validWallet,
        feeCharged: '100',
        memoType: 'none',
        memo: null,
        createdAt: '2026-03-23T05:15:30Z',
      },
      error: null,
      submittedAt: '2026-03-23T05:15:00.000Z',
      confirmedAt: '2026-03-23T05:15:30Z',
      lastCheckedAt: now,
    });

    const result = await service.getTransactionStatus(validHash);

    expect(result.status).toBe('success');
    expect(mockTransactionsBuilder).not.toHaveBeenCalled();
  });

  it('should return and cache a successful finalized transaction', async () => {
    mockCacheManager.get.mockResolvedValue(undefined);
    mockDbLookup({
      hash: validHash,
      type: 'loan_repay',
      status: 'pending',
      submitted_at: '2026-03-23T05:15:00.000Z',
      completed_at: null,
      updated_at: '2026-03-23T05:15:10.000Z',
    });
    mockTxCallResult({
      hash: validHash,
      successful: true,
      ledger_attr: 123456,
      operation_count: 2,
      source_account: validWallet,
      fee_charged: '100',
      memo_type: 'text',
      memo: 'Loan repayment',
      created_at: '2026-03-23T05:15:30Z',
    });

    const result = await service.getTransactionStatus(validHash);

    expect(result).toMatchObject({
      hash: validHash,
      status: 'success',
      type: 'loan_repay',
      submittedAt: '2026-03-23T05:15:00.000Z',
      confirmedAt: '2026-03-23T05:15:30Z',
      result: {
        ledger: 123456,
        operationCount: 2,
        sourceAccount: validWallet,
      },
      error: null,
    });
    expect(mockCacheManager.set).toHaveBeenCalledWith(
      `transactions:status:${validHash}`,
      expect.objectContaining({ status: 'success' }),
      0,
    );
  });

  it('should return pending when Horizon cannot find a locally tracked transaction yet', async () => {
    mockCacheManager.get.mockResolvedValue(undefined);
    mockDbLookup({
      hash: validHash,
      type: 'deposit' as TransactionType,
      status: 'pending',
      submitted_at: '2026-03-23T05:15:00.000Z',
      completed_at: null,
      updated_at: '2026-03-23T05:15:10.000Z',
    });
    mockTxCallResult(
      Promise.reject({
        response: { status: 404 },
      }),
    );

    const result = await service.getTransactionStatus(validHash);

    expect(result).toEqual({
      hash: validHash,
      status: 'pending',
      type: 'deposit' as TransactionType,
      result: null,
      error: null,
      submittedAt: '2026-03-23T05:15:00.000Z',
      confirmedAt: null,
      lastCheckedAt: now,
    });
  });

  it('should return 404 when Horizon cannot find an unknown hash', async () => {
    mockCacheManager.get.mockResolvedValue(undefined);
    mockDbLookup(null);
    mockTxCallResult(
      Promise.reject({
        response: { status: 404 },
      }),
    );

    await expect(service.getTransactionStatus(validHash)).rejects.toThrow(NotFoundException);
  });

  it('should return 503 when Horizon is temporarily unavailable', async () => {
    mockCacheManager.get.mockResolvedValue(undefined);
    mockDbLookup({
      hash: validHash,
      type: 'deposit' as TransactionType,
      status: 'pending',
      submitted_at: '2026-03-23T05:15:00.000Z',
    });
    mockTxCallResult(Promise.reject(new Error('network timeout')));

    await expect(service.getTransactionStatus(validHash)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('should return failure details and cache finalized failed transactions', async () => {
    mockCacheManager.get.mockResolvedValue(undefined);
    mockDbLookup({
      hash: validHash,
      type: 'withdraw' as TransactionType,
      status: 'pending',
      submitted_at: '2026-03-23T05:15:00.000Z',
      completed_at: null,
      updated_at: '2026-03-23T05:15:10.000Z',
    });
    mockTxCallResult({
      hash: validHash,
      successful: false,
      result_xdr: 'AAAA',
      ledger_attr: 123456,
      operation_count: 1,
      source_account: validWallet,
      fee_charged: '100',
      memo_type: 'none',
      memo: undefined,
      created_at: '2026-03-23T05:15:30Z',
    });
    jest.spyOn(StellarSdk.xdr.TransactionResult, 'fromXDR').mockReturnValue({
      result: () => ({
        switch: () => ({ name: 'txFailed' }),
        value: () => [{ switch: () => ({ name: 'opUnderfunded' }) }],
      }),
    } as any);

    const result = await service.getTransactionStatus(validHash);

    expect(result).toMatchObject({
      hash: validHash,
      status: 'failed',
      type: 'withdraw' as TransactionType,
      result: null,
      error: {
        code: 'tx_failed',
        message:
          'Insufficient balance to complete one or more operations in this transaction.',
        operationCodes: ['op_underfunded'],
      },
      submittedAt: '2026-03-23T05:15:00.000Z',
      confirmedAt: '2026-03-23T05:15:30Z',
    });
    expect(mockCacheManager.set).toHaveBeenCalledWith(
      `transactions:status:${validHash}`,
      expect.objectContaining({ status: 'failed' }),
      0,
    );
  });

  // ── Add this helper alongside the existing mockDbLookup / mockTxCallResult ──

  function buildValidXdr(): string {
    const keypair = StellarSdk.Keypair.random();
    const account = new StellarSdk.Account(keypair.publicKey(), '0');
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: keypair.publicKey(),
          asset: StellarSdk.Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(30)
      .build();
    tx.sign(keypair);
    return tx.toXDR();
  }

  /**
   * Builds a signed Soroban invokeHostFunction transaction with the given
   * source account, contract ID, and function name (the shape the StepFi XDR
   * builders produce).
   */
  function buildSorobanTx(
    sourceKeypair: StellarSdk.Keypair,
    functionName: string,
    contractId: string,
  ): StellarSdk.Transaction {
    const source = sourceKeypair.publicKey();
    const account = new StellarSdk.Account(source, '0');
    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        new StellarSdk.Contract(contractId).call(
          functionName,
          StellarSdk.nativeToScVal(source, { type: 'string' }),
          StellarSdk.nativeToScVal(100, { type: 'i128' }),
        ),
      )
      .setTimeout(30)
      .build();
    tx.sign(sourceKeypair);
    return tx;
  }

  function buildSorobanXdr(
    sourceKeypair: StellarSdk.Keypair,
    functionName: string,
    contractId: string,
  ): string {
    return buildSorobanTx(sourceKeypair, functionName, contractId).toXDR();
  }

  function buildFeeBumpSorobanXdr(
    innerSourceKeypair: StellarSdk.Keypair,
    functionName: string,
    contractId: string,
  ): string {
    const feeKeypair = StellarSdk.Keypair.random();
    const inner = buildSorobanTx(innerSourceKeypair, functionName, contractId);
    const feeBump = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      feeKeypair.publicKey(),
      StellarSdk.BASE_FEE,
      inner,
      StellarSdk.Networks.TESTNET,
    );
    feeBump.sign(feeKeypair);
    return feeBump.toXDR();
  }

  /**
   * Computes the transaction hash (hex) exactly as the service does.
   */
  function hashOfXdr(xdr: string): string {
    return StellarSdk.TransactionBuilder.fromXDR(xdr, StellarSdk.Networks.TESTNET)
      .hash()
      .toString('hex');
  }

  /**
   * Builds a fake parsed transaction whose invokeHostFunction operation carries
   * the given Soroban auth addresses — used to exercise the wallet-authorizes
   * path where the source account differs from the authenticated wallet.
   */
  function buildFakeSorobanTransaction(opts: {
    source: string;
    functionName: string;
    contractId: string;
    authAddresses?: string[];
    hash?: string;
    omitContractId?: boolean;
  }) {
    const auth = (opts.authAddresses ?? []).map((address) => ({
      credentials: () => ({
        switch: () => ({ name: 'sorobanCredentialsAddress' }),
        value: () => ({
          address: () => ({
            address: () => ({ toString: () => address }),
          }),
        }),
      }),
    }));
    const attributes: Record<string, unknown> = {
      functionName: { toString: () => opts.functionName },
      auth,
    };
    if (!opts.omitContractId) {
      attributes.contractAddress = Buffer.from(
        StellarSdk.StrKey.decodeContract(opts.contractId),
      );
    }
    const operation = {
      type: 'invokeHostFunction',
      func: {
        _value: {
          _attributes: attributes,
        },
      },
    };
    return {
      source: opts.source,
      operations: [operation],
      hash: () => Buffer.from(opts.hash ?? 'b'.repeat(64), 'hex'),
    };
  }

  function buildHorizonResultCodesError(transaction: string, operations: string[] = []): unknown {
    return {
      response: { data: { extras: { result_codes: { transaction, operations } } } },
      message: 'Transaction submission failed',
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // submitTransaction
  // ══════════════════════════════════════════════════════════════════════════

  describe('submitTransaction', () => {
    let walletKeypair: StellarSdk.Keypair;
    let wallet: string;

    beforeEach(() => {
      walletKeypair = StellarSdk.Keypair.random();
      wallet = walletKeypair.publicKey();
      // The pre-insert idempotency lookup misses by default.
      mockDbLookup(null);
    });

    it('submits a valid Soroban deposit from the wallet source account', async () => {
      const xdr = buildSorobanXdr(walletKeypair, 'deposit', LIQUIDITY_CONTRACT_ID);
      const expectedHash = hashOfXdr(xdr);
      mockSubmitTransaction.mockResolvedValue({ hash: expectedHash });

      const result = await service.submitTransaction(wallet, {
        xdr,
        type: 'deposit' as TransactionType,
      });

      expect(result).toEqual({ transactionHash: expectedHash, status: 'pending' });
      expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
      expect(mockSupabaseTable.insert).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException with TRANSACTION_INVALID_XDR when XDR is malformed', async () => {
      await expect(
        service.submitTransaction(wallet, { xdr: 'not-valid-xdr', type: 'deposit' as TransactionType }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.submitTransaction(wallet, { xdr: 'not-valid-xdr', type: 'deposit' as TransactionType }),
      ).rejects.toMatchObject({ response: { code: 'TRANSACTION_INVALID_XDR' } });
    });

    it('rejects a classic (non-Soroban) transaction with TRANSACTION_OPERATION_NOT_ALLOWED', async () => {
      await expect(
        service.submitTransaction(wallet, {
          xdr: buildValidXdr(),
          type: 'deposit' as TransactionType,
        }),
      ).rejects.toMatchObject({ response: { code: 'TRANSACTION_OPERATION_NOT_ALLOWED' } });

      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });

    it('rejects a transaction whose invoked function does not match the declared type', async () => {
      const xdr = buildSorobanXdr(walletKeypair, 'withdraw', LIQUIDITY_CONTRACT_ID);

      await expect(
        service.submitTransaction(wallet, {
          xdr,
          type: 'deposit' as TransactionType,
        }),
      ).rejects.toMatchObject({ response: { code: 'TRANSACTION_TYPE_MISMATCH' } });

      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });

    it('rejects a transaction targeting a contract other than the configured one for the type', async () => {
      const xdr = buildSorobanXdr(walletKeypair, 'deposit', OTHER_CONTRACT_ID);

      await expect(
        service.submitTransaction(wallet, {
          xdr,
          type: 'deposit' as TransactionType,
        }),
      ).rejects.toMatchObject({ response: { code: 'TRANSACTION_TYPE_MISMATCH' } });

      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });

    it('fails closed when the contract ID for the declared type is not configured', async () => {
      const xdr = buildSorobanXdr(walletKeypair, 'deposit', LIQUIDITY_CONTRACT_ID);
      // The function name and source are valid, but the allowlist must not
      // degrade to function-name-only matching when the contract ID is unset.
      mockConfigService.get.mockImplementationOnce(() => undefined);

      await expect(
        service.submitTransaction(wallet, {
          xdr,
          type: 'deposit' as TransactionType,
        }),
      ).rejects.toMatchObject({ response: { code: 'TRANSACTION_CONTRACT_NOT_CONFIGURED' } });

      expect(mockSubmitTransaction).not.toHaveBeenCalled();
      expect(mockSupabaseTable.insert).not.toHaveBeenCalled();
    });

    it('fails closed when the target contract address cannot be determined from the XDR', async () => {
      const fakeTx = buildFakeSorobanTransaction({
        source: wallet,
        functionName: 'deposit',
        contractId: LIQUIDITY_CONTRACT_ID,
        omitContractId: true,
      });
      const fromXdrSpy = jest
        .spyOn(StellarSdk.TransactionBuilder, 'fromXDR')
        .mockReturnValue(fakeTx as any);

      try {
        await expect(
          service.submitTransaction(wallet, {
            xdr: 'AAAA',
            type: 'deposit' as TransactionType,
          }),
        ).rejects.toMatchObject({ response: { code: 'TRANSACTION_TYPE_MISMATCH' } });
        expect(mockSubmitTransaction).not.toHaveBeenCalled();
      } finally {
        fromXdrSpy.mockRestore();
      }
    });

    it('rejects third-party XDR where the wallet is neither source nor authorizer', async () => {
      const attackerKeypair = StellarSdk.Keypair.random();
      const xdr = buildSorobanXdr(attackerKeypair, 'deposit', LIQUIDITY_CONTRACT_ID);

      await expect(
        service.submitTransaction(wallet, {
          xdr,
          type: 'deposit' as TransactionType,
        }),
      ).rejects.toMatchObject({ response: { code: 'TRANSACTION_SOURCE_MISMATCH' } });

      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });

    it('accepts XDR whose source differs from the wallet when the wallet authorizes via Soroban auth', async () => {
      const fakeTx = buildFakeSorobanTransaction({
        source: StellarSdk.Keypair.random().publicKey(),
        functionName: 'deposit',
        contractId: LIQUIDITY_CONTRACT_ID,
        authAddresses: [wallet],
      });
      const fromXdrSpy = jest
        .spyOn(StellarSdk.TransactionBuilder, 'fromXDR')
        .mockReturnValue(fakeTx as any);
      mockSubmitTransaction.mockResolvedValue({ hash: 'b'.repeat(64) });

      try {
        const result = await service.submitTransaction(wallet, {
          xdr: 'AAAA',
          type: 'deposit' as TransactionType,
        });
        expect(result.status).toBe('pending');
        expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
      } finally {
        fromXdrSpy.mockRestore();
      }
    });

    it('rejects XDR where the wallet is not in the Soroban auth either', async () => {
      const fakeTx = buildFakeSorobanTransaction({
        source: StellarSdk.Keypair.random().publicKey(),
        functionName: 'deposit',
        contractId: LIQUIDITY_CONTRACT_ID,
        authAddresses: [StellarSdk.Keypair.random().publicKey()],
      });
      const fromXdrSpy = jest
        .spyOn(StellarSdk.TransactionBuilder, 'fromXDR')
        .mockReturnValue(fakeTx as any);

      try {
        await expect(
          service.submitTransaction(wallet, {
            xdr: 'AAAA',
            type: 'deposit' as TransactionType,
          }),
        ).rejects.toMatchObject({ response: { code: 'TRANSACTION_SOURCE_MISMATCH' } });
        expect(mockSubmitTransaction).not.toHaveBeenCalled();
      } finally {
        fromXdrSpy.mockRestore();
      }
    });

    it('accepts a fee-bump transaction whose inner source is the wallet', async () => {
      const xdr = buildFeeBumpSorobanXdr(walletKeypair, 'deposit', LIQUIDITY_CONTRACT_ID);
      const expectedHash = hashOfXdr(xdr);
      mockSubmitTransaction.mockResolvedValue({ hash: expectedHash });

      const result = await service.submitTransaction(wallet, {
        xdr,
        type: 'deposit' as TransactionType,
      });

      expect(result).toEqual({ transactionHash: expectedHash, status: 'pending' });
      expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
    });

    it('rejects a fee-bump transaction whose inner source is not the wallet', async () => {
      const attackerKeypair = StellarSdk.Keypair.random();
      const xdr = buildFeeBumpSorobanXdr(attackerKeypair, 'deposit', LIQUIDITY_CONTRACT_ID);

      await expect(
        service.submitTransaction(wallet, {
          xdr,
          type: 'deposit' as TransactionType,
        }),
      ).rejects.toMatchObject({ response: { code: 'TRANSACTION_SOURCE_MISMATCH' } });

      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });

    it('returns the existing record without re-submitting when the hash was already recorded', async () => {
      const xdr = buildSorobanXdr(walletKeypair, 'deposit', LIQUIDITY_CONTRACT_ID);
      const expectedHash = hashOfXdr(xdr);
      mockDbLookup({
        hash: expectedHash,
        type: 'deposit' as TransactionType,
        status: 'success',
        submitted_at: '2026-03-23T05:15:00.000Z',
      });

      const result = await service.submitTransaction(wallet, {
        xdr,
        type: 'deposit' as TransactionType,
      });

      expect(result).toEqual({
        transactionHash: expectedHash,
        status: 'success',
        duplicate: true,
      });
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
      expect(mockSupabaseTable.insert).not.toHaveBeenCalled();
    });

    it('returns the existing record when a concurrent duplicate hits the unique constraint', async () => {
      const xdr = buildSorobanXdr(walletKeypair, 'deposit', LIQUIDITY_CONTRACT_ID);
      const expectedHash = hashOfXdr(xdr);

      mockSupabaseTable.select.mockReturnThis();
      mockSupabaseTable.eq.mockReturnThis();
      // Pre-check queries both hash columns and misses; the post-race lookup
      // (after the unique-violation insert error) finds the existing record.
      mockSupabaseTable.maybeSingle
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValue({
          data: {
            hash: expectedHash,
            type: 'deposit' as TransactionType,
            status: 'pending',
            submitted_at: '2026-03-23T05:15:00.000Z',
          },
          error: null,
        });
      mockSupabaseTable.insert.mockRejectedValueOnce({
        code: '23505',
        message: 'duplicate key value violates unique constraint "transactions_transaction_hash_unique"',
      });

      const result = await service.submitTransaction(wallet, {
        xdr,
        type: 'deposit' as TransactionType,
      });

      expect(result).toEqual({
        transactionHash: expectedHash,
        status: 'pending',
        duplicate: true,
      });
      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });

    it('surfaces persistence failures instead of silently dropping them', async () => {
      const xdr = buildSorobanXdr(walletKeypair, 'deposit', LIQUIDITY_CONTRACT_ID);
      mockSupabaseTable.insert.mockRejectedValueOnce({
        message: 'connection refused',
      });

      await expect(
        service.submitTransaction(wallet, {
          xdr,
          type: 'deposit' as TransactionType,
        }),
      ).rejects.toMatchObject({ response: { code: 'TRANSACTION_PERSISTENCE_FAILED' } });

      expect(mockSubmitTransaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException mapped from a known tx-level result code (tx_bad_auth)', async () => {
      const xdr = buildSorobanXdr(walletKeypair, 'deposit', LIQUIDITY_CONTRACT_ID);
      mockSubmitTransaction.mockRejectedValue(
        buildHorizonResultCodesError('tx_bad_auth'),
      );

      await expect(
        service.submitTransaction(wallet, { xdr, type: 'deposit' as TransactionType }),
      ).rejects.toMatchObject({
        response: { code: 'STELLAR_TX_BAD_AUTH' },
      });
    });

    it('marks the persisted record as failed when Horizon rejects the transaction', async () => {
      const xdr = buildSorobanXdr(walletKeypair, 'deposit', LIQUIDITY_CONTRACT_ID);
      mockSubmitTransaction.mockRejectedValue(
        buildHorizonResultCodesError('tx_bad_auth'),
      );

      await expect(
        service.submitTransaction(wallet, { xdr, type: 'deposit' as TransactionType }),
      ).rejects.toMatchObject({ response: { code: 'STELLAR_TX_BAD_AUTH' } });

      // The locally persisted pending row is updated to failed with the same
      // message the client receives, so it does not linger as stale pending.
      expect(mockSupabaseTable.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          error: 'Invalid transaction signature. Please re-sign and try again.',
          completed_at: now,
        }),
      );
      expect(mockSupabaseTable.update).toHaveBeenCalledTimes(1);
    });

    it('leaves the record pending when Horizon is temporarily unavailable', async () => {
      const xdr = buildSorobanXdr(walletKeypair, 'deposit', LIQUIDITY_CONTRACT_ID);
      mockSubmitTransaction.mockRejectedValue(new Error('network timeout'));

      await expect(
        service.submitTransaction(wallet, { xdr, type: 'deposit' as TransactionType }),
      ).rejects.toThrow(ServiceUnavailableException);

      // The transaction may still be in flight — the row stays pending so the
      // status checker can reconcile the truth.
      expect(mockSupabaseTable.update).not.toHaveBeenCalled();
    });

    it('marks the persisted record as failed on an unexpected Horizon submission error', async () => {
      const xdr = buildSorobanXdr(walletKeypair, 'deposit', LIQUIDITY_CONTRACT_ID);
      mockSubmitTransaction.mockRejectedValue(new Error('something unexpected'));

      await expect(
        service.submitTransaction(wallet, { xdr, type: 'deposit' as TransactionType }),
      ).rejects.toThrow(InternalServerErrorException);

      expect(mockSupabaseTable.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('throws BadRequestException with STELLAR_TRANSACTION_FAILED for an unmapped result code', async () => {
      const xdr = buildSorobanXdr(walletKeypair, 'deposit', LIQUIDITY_CONTRACT_ID);
      mockSubmitTransaction.mockRejectedValue(
        buildHorizonResultCodesError('tx_some_unknown_code'),
      );

      await expect(
        service.submitTransaction(wallet, { xdr, type: 'deposit' as TransactionType }),
      ).rejects.toMatchObject({
        response: { code: 'STELLAR_TRANSACTION_FAILED' },
      });
    });

    it('throws ServiceUnavailableException when Horizon submission times out', async () => {
      const xdr = buildSorobanXdr(walletKeypair, 'deposit', LIQUIDITY_CONTRACT_ID);
      mockSubmitTransaction.mockRejectedValue(new Error('network timeout'));

      await expect(
        service.submitTransaction(wallet, { xdr, type: 'deposit' as TransactionType }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws InternalServerErrorException for an unexpected Horizon submission error', async () => {
      const xdr = buildSorobanXdr(walletKeypair, 'deposit', LIQUIDITY_CONTRACT_ID);
      mockSubmitTransaction.mockRejectedValue(new Error('something unexpected'));

      await expect(
        service.submitTransaction(wallet, { xdr, type: 'deposit' as TransactionType }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getTransactionStatus – additional cases
  // ══════════════════════════════════════════════════════════════════════════

  describe('getTransactionStatus – additional', () => {
    it('normalises an uppercase hash to lowercase before cache key and DB lookup', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockDbLookup(null);
      mockTxCallResult(Promise.reject({ response: { status: 404 } }));

      await expect(service.getTransactionStatus(validHash.toUpperCase())).rejects.toThrow(
        NotFoundException,
      );

      expect(mockCacheManager.get).toHaveBeenCalledWith(
        `transactions:status:${validHash.toLowerCase()}`,
      );
    });

    it('returns type: null when a finalized transaction has no local DB record', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockDbLookup(null);
      mockTxCallResult({
        hash: validHash,
        successful: true,
        ledger_attr: 1,
        operation_count: 1,
        source_account: validWallet,
        fee_charged: '100',
        memo_type: 'none',
        memo: undefined,
        created_at: now,
        result_xdr: '',
      });

      const result = await service.getTransactionStatus(validHash);

      expect(result.status).toBe('success');
      expect(result.type).toBeNull();
    });

    it('throws ServiceUnavailableException when Horizon returns 502 during status lookup', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockDbLookup({ hash: validHash, type: 'deposit' as TransactionType, status: 'pending', submitted_at: now });
      mockTxCallResult(Promise.reject({ response: { status: 502 } }));

      await expect(service.getTransactionStatus(validHash)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException when Horizon returns 503 during status lookup', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockDbLookup({ hash: validHash, type: 'deposit' as TransactionType, status: 'pending', submitted_at: now });
      mockTxCallResult(Promise.reject({ response: { status: 503 } }));

      await expect(service.getTransactionStatus(validHash)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws InternalServerErrorException for an unexpected Horizon status-lookup error', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockDbLookup({ hash: validHash, type: 'deposit' as TransactionType, status: 'pending', submitted_at: now });
      mockTxCallResult(
        Promise.reject({ response: { status: 500 }, message: 'server error' }),
      );

      await expect(service.getTransactionStatus(validHash)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('skips DB persistence when there is no local transaction record', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockDbLookup(null);
      mockTxCallResult({
        hash: validHash,
        successful: true,
        ledger_attr: 1,
        operation_count: 1,
        source_account: validWallet,
        fee_charged: '100',
        memo_type: 'none',
        memo: undefined,
        created_at: now,
        result_xdr: '',
      });

      await service.getTransactionStatus(validHash);

      expect(mockSupabaseTable.update).not.toHaveBeenCalled();
    });

    it('falls back to transaction_hash column when hash column does not exist in DB', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);

      mockSupabaseTable.select.mockReturnThis();
      mockSupabaseTable.eq.mockReturnThis();
      mockSupabaseTable.maybeSingle
        .mockResolvedValueOnce({
          data: null,
          error: { message: 'column "hash" does not exist' },
        })
        .mockResolvedValueOnce({
          data: {
            transaction_hash: validHash,
            type: 'deposit' as TransactionType,
            status: 'pending',
            submitted_at: now,
            completed_at: null,
            updated_at: now,
          },
          error: null,
        });

      mockTxCallResult(Promise.reject({ response: { status: 404 } }));

      const result = await service.getTransactionStatus(validHash);

      expect(result.status).toBe('pending');
      expect(result.type).toBe('deposit');
    });
  });
});
