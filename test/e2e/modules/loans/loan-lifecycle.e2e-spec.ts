import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { LoansModule } from '../../../../src/modules/loans/loans.module';
import { TransactionsModule } from '../../../../src/modules/transactions/transactions.module';
import { ReputationService } from '../../../../src/modules/reputation/reputation.service';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { CreditLineContractClient } from '../../../../src/stellar/contracts/clients/creditline.client';
import { ReputationContractClient } from '../../../../src/stellar/contracts/clients/reputation.client';
import { TransactionsService } from '../../../../src/modules/transactions/transactions.service';
import { JwtAuthGuard } from '../../../../src/common/guards/jwt-auth.guard';
import { TransactionType } from '../../../../src/modules/transactions/dto/submit-transaction-request.dto';

type LoanStatus = 'pending' | 'active' | 'completed' | 'defaulted';

type LoanRow = {
  id: string;
  loan_id: string;
  user_wallet: string;
  vendor_id: string;
  amount: number;
  loan_amount: number;
  guarantee: number;
  interest_rate: number;
  total_repayment: number;
  remaining_balance: number;
  term: number;
  status: LoanStatus;
  next_payment_due: string | null;
  created_at: string;
  completed_at: string | null;
  defaulted_at: string | null;
};

describe('Loan Lifecycle Flow (e2e)', () => {
  let app: NestFastifyApplication;

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
  const vendorId = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

  const state = {
    nowIso: '2026-04-28T10:00:00.000Z',
    vendorVerified: true,
    maxCredit: 3000,
    score: 75,
    interestRate: 8,
    loans: [] as LoanRow[],
    txToLoanId: new Map<string, string>(),
    txByHash: new Map<string, { type: TransactionType; status: 'pending' | 'success' }>(),
    submittedTxCount: 0,
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

  const mockReputationService = {
    getReputationScore: jest.fn(),
  };

  const mockReputationContractClient = {
    getScore: jest.fn(),
  };

  const mockCreditLineContract = {
    buildCreateLoanTransaction: jest.fn(),
    buildRepayLoanTx: jest.fn(),
  };

  const mockTransactionsService = {
    submitTransaction: jest.fn(),
    getTransactionStatus: jest.fn(),
  };

  function buildSupabaseQuery(table: string) {
    if (table === 'vendors') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: state.vendorVerified
            ? { id: vendorId, name: 'TechStore', verified: true }
            : { id: vendorId, name: 'TechStore', verified: false },
          error: null,
        }),
      };
    }

    if (table === 'loans') {
      const queryState: {
        filters: Record<string, unknown>;
        selected: string;
        listStatuses: string[] | null;
      } = {
        filters: {},
        selected: '',
        listStatuses: null,
      };

      const query = {
        select: jest.fn((columns: string) => {
          queryState.selected = columns;
          return query;
        }),
        eq: jest.fn((column: string, value: unknown) => {
          queryState.filters[column] = value;
          return query;
        }),
        in: jest.fn((column: string, values: string[]) => {
          if (column === 'status') {
            queryState.listStatuses = values;
          }

          return Promise.resolve({
            data: state.loans
              .filter((loan) => loan.user_wallet === validWallet)
              .filter((loan) =>
                queryState.listStatuses ? queryState.listStatuses.includes(loan.status) : true,
              )
              .map((loan) => ({
                ...loan,
                vendors: {
                  id: vendorId,
                  name: 'TechStore',
                },
                loan_payments: loan.status === 'completed' ? [{ amount: loan.total_repayment }] : [],
              })),
            error: null,
            count: state.loans.filter((loan) =>
              queryState.listStatuses ? queryState.listStatuses.includes(loan.status) : true,
            ).length,
          });
        }),
        order: jest.fn().mockReturnThis(),
        range: jest.fn().mockReturnThis(),
        single: jest.fn().mockImplementation(async () => {
          if (queryState.selected.includes('remaining_balance') && queryState.filters.id) {
            const loan = state.loans.find((item) => item.id === queryState.filters.id);
            return { data: loan ?? null, error: loan ? null : { message: 'not found' } };
          }

          if (queryState.selected.includes('id, name, verified')) {
            return {
              data: state.vendorVerified
                ? { id: vendorId, name: 'TechStore', verified: true }
                : { id: vendorId, name: 'TechStore', verified: false },
              error: null,
            };
          }

          return { data: null, error: null };
        }),
        insert: jest.fn().mockImplementation(async (payload: Partial<LoanRow>) => {
          const newLoan: LoanRow = {
            id: `11111111-2222-3333-4444-${String(state.loans.length + 1).padStart(12, '0')}`,
            loan_id: String(payload.loan_id),
            user_wallet: String(payload.user_wallet),
            vendor_id: String(payload.vendor_id),
            amount: Number(payload.amount),
            loan_amount: Number(payload.loan_amount),
            guarantee: Number(payload.guarantee),
            interest_rate: Number(payload.interest_rate),
            total_repayment: Number(payload.total_repayment),
            remaining_balance: Number(payload.remaining_balance),
            term: Number(payload.term),
            status: 'pending',
            next_payment_due: (payload.next_payment_due as string) ?? null,
            created_at: state.nowIso,
            completed_at: null,
            defaulted_at: null,
          };

          state.loans.push(newLoan);
          return { error: null };
        }),
        then: undefined as unknown,
      };

      query.then = ((resolve: (value: unknown) => unknown) => {
        const data = state.loans
          .filter((loan) => loan.user_wallet === queryState.filters.user_wallet)
          .filter((loan) => {
            const statusFilter = queryState.filters.status;
            return statusFilter ? loan.status === statusFilter : true;
          })
          .map((loan) => {
            if (queryState.selected.includes('remaining_balance') && !queryState.selected.includes('id,')) {
              return { remaining_balance: loan.remaining_balance };
            }

            return loan;
          });

        return Promise.resolve(resolve({ data, error: null, count: data.length }));
      }) as unknown as undefined;

      return query;
    }

    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      insert: jest.fn().mockResolvedValue({ error: null }),
      in: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockReturnThis(),
    };
  }

  const mockSupabaseClient = {
    from: jest.fn((table: string) => buildSupabaseQuery(table)),
  };

  const mockSupabaseService = {
    getServiceRoleClient: jest.fn().mockReturnValue(mockSupabaseClient),
    getClient: jest.fn().mockReturnValue(mockSupabaseClient),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), LoansModule, TransactionsModule],
    })
      .overrideProvider(SupabaseService)
      .useValue(mockSupabaseService)
      .overrideProvider(ReputationService)
      .useValue(mockReputationService)
      .overrideProvider(ReputationContractClient)
      .useValue(mockReputationContractClient)
      .overrideProvider(CreditLineContractClient)
      .useValue(mockCreditLineContract)
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

    state.vendorVerified = true;
    state.maxCredit = 3000;
    state.score = 75;
    state.interestRate = 8;
    state.loans = [];
    state.txToLoanId.clear();
    state.txByHash.clear();
    state.submittedTxCount = 0;

    mockReputationService.getReputationScore.mockResolvedValue({
      wallet: validWallet,
      score: state.score,
      tier: 'silver',
      interestRate: state.interestRate,
      maxCredit: state.maxCredit,
      lastUpdated: '2026-04-28T09:59:00.000Z',
    });

    mockReputationContractClient.getScore.mockResolvedValue(state.score);

    mockCreditLineContract.buildCreateLoanTransaction.mockImplementation(async (_wallet, payload) => {
      return `xdr-loan-create-${payload.loanId}`;
    });

    mockCreditLineContract.buildRepayLoanTx.mockImplementation(async (_wallet, loanId, amount) => {
      return `xdr-loan-repay-${loanId}-${amount}`;
    });

    mockTransactionsService.submitTransaction.mockImplementation(async (_wallet, dto) => {
      state.submittedTxCount += 1;
      const hash = `${String(state.submittedTxCount).padStart(2, '0')}${'a'.repeat(62)}`;
      state.txByHash.set(hash, { type: dto.type, status: 'pending' });

      if (dto.type === TransactionType.LOAN_CREATE) {
        const pendingLoan = state.loans[state.loans.length - 1];
        if (pendingLoan) {
          state.txToLoanId.set(hash, pendingLoan.id);
        }
      }

      if (dto.type === TransactionType.LOAN_REPAY) {
        const activeLoan = state.loans.find((loan) => loan.status === 'active');
        if (activeLoan) {
          state.txToLoanId.set(hash, activeLoan.id);
        }
      }

      return { transactionHash: hash, status: 'pending' };
    });

    mockTransactionsService.getTransactionStatus.mockImplementation(async (hash: string) => {
      const tx = state.txByHash.get(hash);
      if (!tx) {
        throw new Error('missing transaction');
      }

      tx.status = 'success';
      const linkedLoanId = state.txToLoanId.get(hash);
      if (linkedLoanId) {
        const loan = state.loans.find((item) => item.id === linkedLoanId);

        if (loan && tx.type === TransactionType.LOAN_CREATE) {
          loan.status = 'active';
        }

        if (loan && tx.type === TransactionType.LOAN_REPAY) {
          loan.remaining_balance = 0;
          loan.status = 'completed';
          loan.completed_at = state.nowIso;
        }
      }

      return {
        hash,
        status: 'success',
        type: tx.type,
        result: {
          ledger: 12345,
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

    state.loans = [];
    state.txByHash.clear();
    state.txToLoanId.clear();
  });

  it('should execute complete loan lifecycle: quote -> create -> submit -> confirm -> list -> repay -> complete', async () => {
    const quoteRes = await app.inject({
      method: 'POST',
      url: '/loans/quote',
      headers: { authorization: 'Bearer test.jwt' },
      payload: { amount: 500, vendor: vendorId, term: 4 },
    });

    expect(quoteRes.statusCode).toBe(200);

    const availableCreditRes = await app.inject({
      method: 'GET',
      url: '/loans/available-credit',
      headers: { authorization: 'Bearer test.jwt' },
    });

    expect(availableCreditRes.statusCode).toBe(200);
    expect(JSON.parse(availableCreditRes.payload).data.availableCredit).toBe(3000);

    const createRes = await app.inject({
      method: 'POST',
      url: '/loans/create',
      headers: { authorization: 'Bearer test.jwt' },
      payload: { amount: 500, vendor: vendorId, term: 4 },
    });

    expect(createRes.statusCode).toBe(200);
    expect(state.loans).toHaveLength(1);
    expect(state.loans[0].status).toBe('pending');

    const submitCreateTxRes = await app.inject({
      method: 'POST',
      url: '/transactions/submit',
      headers: { authorization: 'Bearer test.jwt' },
      payload: { xdr: 'AAAAAgLOANCREATE...', type: TransactionType.LOAN_CREATE },
    });

    expect(submitCreateTxRes.statusCode).toBe(200);
    const submitCreateTxBody = JSON.parse(submitCreateTxRes.payload);

    const confirmCreateTxRes = await app.inject({
      method: 'GET',
      url: `/transactions/${submitCreateTxBody.data.transactionHash}`,
    });

    expect(confirmCreateTxRes.statusCode).toBe(200);
    expect(state.loans[0].status).toBe('active');

    const listLoansRes = await app.inject({
      method: 'GET',
      url: '/loans/my-loans',
      headers: { authorization: 'Bearer test.jwt' },
    });

    expect(listLoansRes.statusCode).toBe(200);
    const listLoansBody = JSON.parse(listLoansRes.payload);
    expect(listLoansBody.data).toHaveLength(1);
    expect(listLoansBody.data[0].status).toBe('active');

    const repayRes = await app.inject({
      method: 'POST',
      url: `/loans/${listLoansBody.data[0].id}/pay`,
      headers: { authorization: 'Bearer test.jwt' },
      payload: { amount: 410.67 },
    });

    expect(repayRes.statusCode).toBe(200);

    const submitRepayTxRes = await app.inject({
      method: 'POST',
      url: '/transactions/submit',
      headers: { authorization: 'Bearer test.jwt' },
      payload: { xdr: 'AAAAAgLOANREPAY...', type: TransactionType.LOAN_REPAY },
    });

    expect(submitRepayTxRes.statusCode).toBe(200);
    const submitRepayTxBody = JSON.parse(submitRepayTxRes.payload);

    const confirmRepayTxRes = await app.inject({
      method: 'GET',
      url: `/transactions/${submitRepayTxBody.data.transactionHash}`,
    });

    expect(confirmRepayTxRes.statusCode).toBe(200);
    expect(state.loans[0].status).toBe('completed');
    expect(state.loans[0].remaining_balance).toBe(0);
  });

  it('should validate unverified vendor and insufficient credit errors', async () => {
    state.vendorVerified = false;

    const unverifiedVendorRes = await app.inject({
      method: 'POST',
      url: '/loans/quote',
      headers: { authorization: 'Bearer test.jwt' },
      payload: { amount: 500, vendor: vendorId, term: 4 },
    });

    expect(unverifiedVendorRes.statusCode).toBe(400);

    state.vendorVerified = true;
    state.maxCredit = 100;
    mockReputationService.getReputationScore.mockResolvedValue({
      wallet: validWallet,
      score: state.score,
      tier: 'silver',
      interestRate: state.interestRate,
      maxCredit: state.maxCredit,
      lastUpdated: '2026-04-28T09:59:00.000Z',
    });

    const lowCreditRes = await app.inject({
      method: 'POST',
      url: '/loans/create',
      headers: { authorization: 'Bearer test.jwt' },
      payload: { amount: 500, vendor: vendorId, term: 4 },
    });

    expect(lowCreditRes.statusCode).toBe(400);
  });
});
