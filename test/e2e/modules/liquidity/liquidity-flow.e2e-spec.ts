import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigModule } from '@nestjs/config';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { LiquidityModule } from '../../../../src/modules/liquidity/liquidity.module';
import { TransactionsModule } from '../../../../src/modules/transactions/transactions.module';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { LiquidityPoolContractClient } from '../../../../src/stellar/contracts/clients/liquidity-pool.client';
import { TransactionsService } from '../../../../src/modules/transactions/transactions.service';
import { JwtAuthGuard } from '../../../../src/common/guards/jwt-auth.guard';
import { TransactionType } from '../../../../src/modules/transactions/dto/submit-transaction-request.dto';

describe('Liquidity Operations Flow (e2e)', () => {
  let app: NestFastifyApplication;

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
  const STROOPS = 10_000_000n;

  const state = {
    nowIso: '2026-04-28T11:00:00.000Z',
    totalLiquidity: 1000n * STROOPS,
    totalShares: 1000n * STROOPS,
    availableLiquidity: 1000n * STROOPS,
    lockedLiquidity: 0n,
    withdrawalFeeBps: 50n,
    userShares: 0n,
    totalInvested: 0,
    activeLoans: [{ loan_amount: 400, interest_rate: 8 }],
    txByHash: new Map<
      string,
      {
        type: TransactionType;
        status: 'pending' | 'success';
        depositAmount?: bigint;
        depositShares?: bigint;
        withdrawShares?: bigint;
      }
    >(),
    submittedTxCount: 0,
    pendingDepositAmount: 0n,
    pendingDepositShares: 0n,
    pendingWithdrawShares: 0n,
  };

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const mockJwtAuthGuard = {
    canActivate: jest.fn((context) => {
      const req = context.switchToHttp().getRequest();
      const authHeader = req.headers['authorization'];

      if (!authHeader?.startsWith('Bearer ')) {
        throw new UnauthorizedException('No token provided');
      }

      req.user = { wallet: validWallet };
      return true;
    }),
  };

  const mockLiquidityPoolContractClient = {
    getPoolStats: jest.fn(),
    calculateDeposit: jest.fn(),
    buildDepositTx: jest.fn(),
    getLpShares: jest.fn(),
    calculateWithdrawal: jest.fn(),
    buildWithdrawTx: jest.fn(),
  };

  const mockTransactionsService = {
    submitTransaction: jest.fn(),
    getTransactionStatus: jest.fn(),
  };

  function createSupabaseLoansQuery() {
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: state.activeLoans, error: null }),
    };
  }

  function createSupabasePositionsQuery() {
    return {
      select: jest.fn((columns?: string, options?: { count?: string; head?: boolean }) => {
        if (options?.head) {
          return Promise.resolve({ count: state.userShares > 0n ? 1 : 0, error: null });
        }

        if (columns === 'deposited_amount') {
          return {
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: state.totalInvested > 0 ? { deposited_amount: state.totalInvested } : null,
              error: state.totalInvested > 0 ? null : { message: 'not found' },
            }),
          };
        }

        return Promise.resolve({ data: [], error: null });
      }),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: state.totalInvested > 0 ? { deposited_amount: state.totalInvested } : null,
        error: state.totalInvested > 0 ? null : { message: 'not found' },
      }),
    };
  }

  const mockSupabaseClient = {
    from: jest.fn((table: string) => {
      if (table === 'loans') {
        return createSupabaseLoansQuery();
      }

      if (table === 'liquidity_positions') {
        return createSupabasePositionsQuery();
      }

      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  };

  const mockSupabaseService = {
    getServiceRoleClient: jest.fn().mockReturnValue(mockSupabaseClient),
    getClient: jest.fn().mockReturnValue(mockSupabaseClient),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), LiquidityModule, TransactionsModule],
    })
      .overrideProvider(CACHE_MANAGER)
      .useValue(mockCacheManager)
      .overrideProvider(SupabaseService)
      .useValue(mockSupabaseService)
      .overrideProvider(LiquidityPoolContractClient)
      .useValue(mockLiquidityPoolContractClient)
      .overrideProvider(TransactionsService)
      .useValue(mockTransactionsService)
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    state.totalLiquidity = 1000n * STROOPS;
    state.totalShares = 1000n * STROOPS;
    state.availableLiquidity = 1000n * STROOPS;
    state.lockedLiquidity = 0n;
    state.withdrawalFeeBps = 50n;
    state.userShares = 0n;
    state.totalInvested = 0;
    state.activeLoans = [{ loan_amount: 400, interest_rate: 8 }];
    state.txByHash.clear();
    state.submittedTxCount = 0;
    state.pendingDepositAmount = 0n;
    state.pendingDepositShares = 0n;
    state.pendingWithdrawShares = 0n;

    mockCacheManager.get.mockResolvedValue(undefined);
    mockCacheManager.set.mockResolvedValue(undefined);

    mockLiquidityPoolContractClient.getPoolStats.mockImplementation(async () => ({
      totalLiquidity: state.totalLiquidity,
      lockedLiquidity: state.lockedLiquidity,
      availableLiquidity: state.availableLiquidity,
      totalShares: state.totalShares,
      sharePrice: state.totalShares > 0n ? (state.totalLiquidity * 10000n) / state.totalShares : 10000n,
      withdrawalFeeBps: state.withdrawalFeeBps,
    }));

    mockLiquidityPoolContractClient.calculateDeposit.mockImplementation(async (amountInStroops: bigint) => {
      const shares =
        state.totalShares <= 0n || state.totalLiquidity <= 0n
          ? amountInStroops
          : (amountInStroops * state.totalShares) / state.totalLiquidity;

      state.pendingDepositAmount = amountInStroops;
      state.pendingDepositShares = shares;
      return shares;
    });

    mockLiquidityPoolContractClient.buildDepositTx.mockResolvedValue('AAAAAgDEPOSIT...');

    mockLiquidityPoolContractClient.getLpShares.mockImplementation(async () => state.userShares);

    mockLiquidityPoolContractClient.calculateWithdrawal.mockImplementation(async (sharesInStroops: bigint) => {
      if (state.totalShares <= 0n) {
        return 0n;
      }

      return (sharesInStroops * state.totalLiquidity) / state.totalShares;
    });

    mockLiquidityPoolContractClient.buildWithdrawTx.mockImplementation(async (_wallet, sharesInStroops: bigint) => {
      state.pendingWithdrawShares = sharesInStroops;
      return 'AAAAAgWITHDRAW...';
    });

    mockTransactionsService.submitTransaction.mockImplementation(async (_wallet, dto) => {
      state.submittedTxCount += 1;
      const hash = `${String(state.submittedTxCount).padStart(2, '0')}${'b'.repeat(62)}`;

      state.txByHash.set(hash, {
        type: dto.type,
        status: 'pending',
        depositAmount: dto.type === TransactionType.DEPOSIT ? state.pendingDepositAmount : undefined,
        depositShares: dto.type === TransactionType.DEPOSIT ? state.pendingDepositShares : undefined,
        withdrawShares: dto.type === TransactionType.WITHDRAW ? state.pendingWithdrawShares : undefined,
      });

      return { transactionHash: hash, status: 'pending' };
    });

    mockTransactionsService.getTransactionStatus.mockImplementation(async (hash: string) => {
      const tx = state.txByHash.get(hash);
      if (!tx) {
        throw new Error('missing transaction');
      }

      tx.status = 'success';

      if (tx.type === TransactionType.DEPOSIT && tx.depositAmount && tx.depositShares) {
        state.totalLiquidity += tx.depositAmount;
        state.availableLiquidity += tx.depositAmount;
        state.totalShares += tx.depositShares;
        state.userShares += tx.depositShares;
        state.totalInvested += Number(tx.depositAmount) / Number(STROOPS);
      }

      if (tx.type === TransactionType.WITHDRAW && tx.withdrawShares) {
        const gross =
          state.totalShares > 0n ? (tx.withdrawShares * state.totalLiquidity) / state.totalShares : 0n;
        state.totalLiquidity -= gross;
        state.availableLiquidity -= gross;
        state.totalShares -= tx.withdrawShares;
        state.userShares -= tx.withdrawShares;
      }

      return {
        hash,
        status: 'success',
        type: tx.type,
        result: {
          ledger: 23456,
          operationCount: 1,
          sourceAccount: validWallet,
          feeCharged: '100',
          memoType: 'none',
          memo: null,
          createdAt: state.nowIso,
        },
        error: null,
        submittedAt: state.nowIso,
        confirmedAt: state.nowIso,
        lastCheckedAt: state.nowIso,
      };
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }

    state.txByHash.clear();
  });

  it('should execute complete liquidity flow: overview -> deposit -> submit -> confirm -> summary -> withdraw', async () => {
    const overviewRes = await app.inject({ method: 'GET', url: '/liquidity/overview' });
    expect(overviewRes.statusCode).toBe(200);

    const overviewBody = JSON.parse(overviewRes.payload);
    expect(overviewBody.data.apy).toBe(6.8);
    expect(overviewBody.data.utilization).toBe(40);

    const depositRes = await app.inject({
      method: 'POST',
      url: '/liquidity/deposit',
      headers: { authorization: 'Bearer test.jwt' },
      payload: { amount: 200 },
    });

    expect(depositRes.statusCode).toBe(200);

    const submitDepositTxRes = await app.inject({
      method: 'POST',
      url: '/transactions/submit',
      headers: { authorization: 'Bearer test.jwt' },
      payload: { xdr: 'AAAAAgDEPOSIT...', type: TransactionType.DEPOSIT },
    });

    expect(submitDepositTxRes.statusCode).toBe(200);
    const submitDepositTxBody = JSON.parse(submitDepositTxRes.payload);

    const confirmDepositTxRes = await app.inject({
      method: 'GET',
      url: `/transactions/${submitDepositTxBody.data.transactionHash}`,
    });

    expect(confirmDepositTxRes.statusCode).toBe(200);
    expect(state.userShares).toBeGreaterThan(0n);

    const summaryAfterDepositRes = await app.inject({
      method: 'GET',
      url: '/liquidity/my-summary',
      headers: { authorization: 'Bearer test.jwt' },
    });

    expect(summaryAfterDepositRes.statusCode).toBe(200);
    const summaryAfterDepositBody = JSON.parse(summaryAfterDepositRes.payload);
    expect(summaryAfterDepositBody.data.totalInvested).toBe(200);
    expect(summaryAfterDepositBody.data.shares).toBe(200);

    const withdrawRes = await app.inject({
      method: 'POST',
      url: '/liquidity/withdraw',
      headers: { authorization: 'Bearer test.jwt' },
      payload: { shares: 100 },
    });

    expect(withdrawRes.statusCode).toBe(200);

    const submitWithdrawTxRes = await app.inject({
      method: 'POST',
      url: '/transactions/submit',
      headers: { authorization: 'Bearer test.jwt' },
      payload: { xdr: 'AAAAAgWITHDRAW...', type: TransactionType.WITHDRAW },
    });

    expect(submitWithdrawTxRes.statusCode).toBe(200);
    const submitWithdrawTxBody = JSON.parse(submitWithdrawTxRes.payload);

    const confirmWithdrawTxRes = await app.inject({
      method: 'GET',
      url: `/transactions/${submitWithdrawTxBody.data.transactionHash}`,
    });

    expect(confirmWithdrawTxRes.statusCode).toBe(200);

    const summaryAfterWithdrawRes = await app.inject({
      method: 'GET',
      url: '/liquidity/my-summary',
      headers: { authorization: 'Bearer test.jwt' },
    });

    expect(summaryAfterWithdrawRes.statusCode).toBe(200);
    const summaryAfterWithdrawBody = JSON.parse(summaryAfterWithdrawRes.payload);
    expect(summaryAfterWithdrawBody.data.shares).toBe(100);
    expect(summaryAfterWithdrawBody.data.activeLoans).toBe(1);
  });

  it('should validate minimum deposit and insufficient shares errors', async () => {
    const belowMinDepositRes = await app.inject({
      method: 'POST',
      url: '/liquidity/deposit',
      headers: { authorization: 'Bearer test.jwt' },
      payload: { amount: 5 },
    });

    expect(belowMinDepositRes.statusCode).toBe(400);

    const excessiveWithdrawRes = await app.inject({
      method: 'POST',
      url: '/liquidity/withdraw',
      headers: { authorization: 'Bearer test.jwt' },
      payload: { shares: 10 },
    });

    expect(excessiveWithdrawRes.statusCode).toBe(400);
  });
});
