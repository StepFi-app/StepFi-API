import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigModule } from '@nestjs/config';
import { LoansModule } from '../../../../src/modules/loans/loans.module';
import { JwtAuthGuard } from '../../../../src/common/guards/jwt-auth.guard';
import { ReputationContractClient } from '../../../../src/stellar/contracts/clients/reputation.client';
import { SupabaseService } from '../../../../src/database/supabase.client';

describe('LoansController available credit (e2e)', () => {
  let app: NestFastifyApplication;

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

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

  const mockReputationContract = {
    getScore: jest.fn().mockResolvedValue(75),
  };

  const mockSupabaseFrom = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn(),
  };

  const mockSupabaseClient = {
    from: jest.fn().mockReturnValue(mockSupabaseFrom),
  };

  const mockSupabaseService = {
    getServiceRoleClient: jest.fn().mockReturnValue(mockSupabaseClient),
    getClient: jest.fn().mockReturnValue(mockSupabaseClient),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), LoansModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .overrideProvider(ReputationContractClient)
      .useValue(mockReputationContract)
      .overrideProvider(SupabaseService)
      .useValue(mockSupabaseService)
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
    mockJwtAuthGuard.canActivate.mockImplementation((context) => {
      const req = context.switchToHttp().getRequest();
      const authHeader = req.headers['authorization'];

      if (!authHeader?.startsWith('Bearer ')) {
        throw new UnauthorizedException('No token provided');
      }

      req.user = { wallet: validWallet };
      return true;
    });

    mockReputationContract.getScore.mockResolvedValue(75);
    mockSupabaseClient.from.mockReturnValue(mockSupabaseFrom);
    mockSupabaseFrom.select.mockReturnThis();
    mockSupabaseFrom.eq
      .mockImplementationOnce(() => mockSupabaseFrom)
      .mockResolvedValueOnce({
        data: [{ remaining_balance: 400.25 }, { remaining_balance: 125.25 }],
        error: null,
      });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /loans/available-credit', () => {
    it('should return 200 with the authenticated user available credit breakdown', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/loans/available-credit',
        headers: { authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body).toEqual({
        success: true,
        data: {
          reputationScore: 75,
          reputationTier: 'silver',
          maxCreditLimit: 3000,
          creditUsed: 525.5,
          availableCredit: 2474.5,
          activeLoans: 2,
        },
        message: 'Available credit calculated successfully',
      });
      expect(mockReputationContract.getScore).toHaveBeenCalledWith(validWallet);
    });

    it('should return 401 when no bearer token is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/loans/available-credit',
      });

      expect(res.statusCode).toBe(401);
    });

    it('should return 503 when the reputation contract is unavailable', async () => {
      mockReputationContract.getScore.mockRejectedValue(new ServiceUnavailableException());

      const res = await app.inject({
        method: 'GET',
        url: '/loans/available-credit',
        headers: { authorization: 'Bearer valid.jwt.token' },
      });

      expect(res.statusCode).toBe(503);
    });
  });
});
