import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { LoansModule } from '../../../../src/modules/loans/loans.module';
import { ReputationService } from '../../../../src/modules/reputation/reputation.service';
import { SorobanService } from '../../../../src/blockchain/soroban/soroban.service';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { CreditLineContractClient } from '../../../../src/stellar/contracts/clients/creditline.client';
import { JwtAuthGuard } from '../../../../src/common/guards/jwt-auth.guard';

describe('LoansController (e2e)', () => {
  let app: NestFastifyApplication;

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
  const vendorId = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

  const mockCreditLineContract = {
    buildCreateLoanTransaction: jest.fn().mockResolvedValue('AAAAAgAAAAC...'),
  };

  const mockSorobanService = {
    simulateContractCall: jest.fn(),
    getServer: jest.fn(),
    getNetworkPassphrase: jest.fn().mockReturnValue('Test SDF Network ; September 2015'),
  };

  const mockSupabaseFrom = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: { id: vendorId, name: 'TechStore', verified: true },
      error: null,
    }),
    insert: jest.fn().mockResolvedValue({ error: null }),
  };

  const mockSupabaseClient = {
    from: jest.fn().mockReturnValue(mockSupabaseFrom),
  };

  const mockSupabaseService = {
    getServiceRoleClient: jest.fn().mockReturnValue(mockSupabaseClient),
    getClient: jest.fn().mockReturnValue(mockSupabaseClient),
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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), LoansModule],
    })
      .overrideProvider(SorobanService)
      .useValue(mockSorobanService)
      .overrideProvider(CreditLineContractClient)
      .useValue(mockCreditLineContract)
      .overrideProvider(SupabaseService)
      .useValue(mockSupabaseService)
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

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabaseClient.from.mockReturnValue(mockSupabaseFrom);
    mockSupabaseFrom.select.mockReturnThis();
    mockSupabaseFrom.eq.mockReturnThis();
    mockSupabaseFrom.in.mockResolvedValue({
      data: [],
      error: null,
      count: 0,
    });
    mockSupabaseFrom.order.mockReturnThis();
    mockSupabaseFrom.range.mockReturnThis();
    mockSupabaseFrom.single.mockResolvedValue({
      data: { id: vendorId, name: 'TechStore', verified: true },
      error: null,
    });
    mockSupabaseFrom.insert.mockResolvedValue({ error: null });
    mockSupabaseService.getServiceRoleClient.mockReturnValue(mockSupabaseClient);
    mockCreditLineContract.buildCreateLoanTransaction.mockResolvedValue('AAAAAgAAAAC...');
    mockJwtAuthGuard.canActivate.mockImplementation((context) => {
      const req = context.switchToHttp().getRequest();
      const authHeader = req.headers['authorization'];

      if (!authHeader?.startsWith('Bearer ')) {
        throw new UnauthorizedException('No token provided');
      }

      req.user = { wallet: validWallet };
      return true;
    });

    jest.spyOn(app.get(ReputationService), 'getReputationScore').mockResolvedValue({
      wallet: validWallet,
      score: 75,
      tier: 'silver',
      interestRate: 8,
      maxCredit: 3000,
      lastUpdated: '2026-03-23T00:00:00.000Z',
    });
  });

  describe('POST /loans/quote', () => {
    const validBody = { amount: 500, vendor: vendorId, term: 4 };

    it('should return 200 with a valid loan quote in response envelope', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/quote',
        headers: { authorization: 'Bearer valid.jwt.token' },
        payload: validBody,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('message', 'Loan quote calculated successfully');
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('amount', 500);
      expect(body.data).toHaveProperty('guarantee', 100);
      expect(body.data).toHaveProperty('loanAmount', 400);
      expect(body.data).toHaveProperty('term', 4);
      expect(body.data.schedule).toHaveLength(4);
    }, 10000);

    it('should return 401 for missing bearer token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/quote',
        payload: validBody,
      });

      expect(res.statusCode).toBe(401);
    });

    it('should return 400 for invalid vendor UUID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/quote',
        headers: { authorization: 'Bearer valid.jwt.token' },
        payload: { ...validBody, vendor: 'not-a-uuid' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /loans/create', () => {
    const validBody = { amount: 500, vendor: vendorId, term: 4 };

    it('should return 200 with loanId, xdr, and terms', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/create',
        headers: { authorization: 'Bearer valid.jwt.token' },
        payload: validBody,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('message', 'Pending loan created successfully');
      expect(body.data).toHaveProperty('loanId');
      expect(body.data).toHaveProperty('xdr', 'AAAAAgAAAAC...');
      expect(body.data).toHaveProperty('terms');
      expect(body.data.terms).toHaveProperty('guarantee', 100);
    }, 10000);

    it('should return 401 for missing bearer token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/create',
        payload: validBody,
      });

      expect(res.statusCode).toBe(401);
    });

    it('should return 400 for invalid request body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/loans/create',
        headers: { authorization: 'Bearer valid.jwt.token' },
        payload: { amount: 500, vendor: vendorId },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for insufficient reputation', async () => {
      jest.spyOn(app.get(ReputationService), 'getReputationScore').mockResolvedValue({
        wallet: validWallet,
        score: 40,
        tier: 'poor',
        interestRate: 12,
        maxCredit: 500,
        lastUpdated: '2026-03-23T00:00:00.000Z',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/loans/create',
        headers: { authorization: 'Bearer valid.jwt.token' },
        payload: { ...validBody, amount: 200 },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /loans/my-loans', () => {
    it('should return paginated loans for the authenticated user', async () => {
      mockSupabaseFrom.in.mockResolvedValue({
        data: [
          {
            id: '11111111-2222-3333-4444-555555555555',
            loan_id: 'chain-loan-1',
            vendor_id: vendorId,
            amount: 500,
            loan_amount: 400,
            guarantee: 100,
            interest_rate: 8,
            total_repayment: 410.67,
            remaining_balance: 205.33,
            term: 4,
            status: 'active',
            next_payment_due: '2026-04-13T00:00:00.000Z',
            created_at: '2026-03-13T00:00:00.000Z',
            completed_at: null,
            defaulted_at: null,
            vendors: {
              id: vendorId,
              name: 'TechStore',
            },
            loan_payments: [{ amount: 102.66 }, { amount: 102.68 }],
          },
        ],
        error: null,
        count: 1,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/loans/my-loans?limit=20&offset=0',
        headers: { authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body).toEqual({
        success: true,
        data: [
          {
            id: '11111111-2222-3333-4444-555555555555',
            loanId: 'chain-loan-1',
            amount: 500,
            loanAmount: 400,
            guarantee: 100,
            interestRate: 8,
            totalRepayment: 410.67,
            totalPaid: 205.34,
            remainingBalance: 205.33,
            term: 4,
            status: 'active',
            vendor: {
              id: vendorId,
              name: 'TechStore',
            },
            nextPayment: {
              dueDate: '2026-04-13T00:00:00.000Z',
              amount: 102.66,
            },
            createdAt: '2026-03-13T00:00:00.000Z',
            completedAt: null,
            defaultedAt: null,
          },
        ],
        pagination: {
          limit: 20,
          offset: 0,
          total: 1,
        },
      });
    });

    it('should return 401 when no bearer token is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/loans/my-loans',
      });

      expect(res.statusCode).toBe(401);
    });

    it('should return 400 when the status filter is invalid', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/loans/my-loans?status=pending',
        headers: { authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
