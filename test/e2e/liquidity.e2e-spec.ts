jest.unmock('stellar-sdk');
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { LiquidityModule } from '../../src/modules/liquidity/liquidity.module';
import { SupabaseService } from '../../src/database/supabase.client';
import { SorobanService } from '../../src/blockchain/soroban/soroban.service';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { LiquidityContractClient } from '../../src/blockchain/contracts/liquidity-contract.client';
import * as StellarSdk from 'stellar-sdk';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

describe('Liquidity E2E with Real RPC Client Integration', () => {
  let app: NestFastifyApplication;
  let sorobanService: SorobanService;
  let liquidityClient: LiquidityContractClient;

  const validWallet = 'GC2US6RXEJJAHSZIWB2ZNEM7CHAHWHM2ACJB42W7TNBQPZC55F53SXSH';
  const STROOPS = 10_000_000n;

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const mockJwtAuthGuard = {
    canActivate: jest.fn((context) => {
      const req = context.switchToHttp().getRequest();
      req.user = { wallet: validWallet, role: 'sponsor' };
      return true;
    }),
  };

  const mockSupabaseFrom = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: { deposited_amount: 1000 },
      error: null,
    }),
  };

  const mockSupabaseClient = {
    from: jest.fn().mockReturnValue(mockSupabaseFrom),
  };

  const mockSupabaseService = {
    getServiceRoleClient: jest.fn().mockReturnValue(mockSupabaseClient),
    getClient: jest.fn().mockReturnValue(mockSupabaseClient),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret-for-e2e-min32chars';
    process.env.LIQUIDITY_POOL_CONTRACT_ID = 'CCBK3YMI3RVGWFUREH5PZMG3HIU3L2XF6YXB2DPFQ4V42Q4JWXPGFSMB';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [LiquidityModule],
    })
      .overrideProvider(CACHE_MANAGER)
      .useValue(mockCacheManager)
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
    sorobanService = app.get<SorobanService>(SorobanService);
    liquidityClient = app.get<LiquidityContractClient>(LiquidityContractClient);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should build valid deposit XDR when simulation succeeds', async () => {
    jest.spyOn(liquidityClient, 'getPoolStats').mockResolvedValue({
      totalLiquidity: 100000n * STROOPS,
      lockedLiquidity: 90000n * STROOPS,
      availableLiquidity: 10000n * STROOPS,
      totalShares: 95000n * STROOPS,
      sharePrice: 10500n,
      withdrawalFeeBps: 50n,
    });
    jest.spyOn(liquidityClient, 'calculateDeposit').mockResolvedValue(4761904761n);

    // Mock simulation response containing necessary auth/results elements
    const mockSuccessResponse = {
      result: {
        retval: StellarSdk.nativeToScVal(100n, { type: 'i128' }),
        events: [],
        auth: [],
      },
      results: [
        {
          auth: [],
        },
      ],
      cost: { cpuInsns: '1000', memBytes: '1000' },
      latestLedger: 12345,
      transactionData: 'AAAAAAAAAAAAAAAAAAAD6AAAA+gAAAPoAAAAAAAAAGQ=',
    };

    jest.spyOn(sorobanService.getServer(), 'simulateTransaction').mockResolvedValue(mockSuccessResponse as any);

    const res = await app.inject({
      method: 'POST',
      url: '/liquidity/deposit',
      headers: { authorization: 'Bearer test' },
      payload: { amount: 100 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.unsignedXdr).toBeDefined();

    const tx = StellarSdk.TransactionBuilder.fromXDR(
      body.data.unsignedXdr,
      StellarSdk.Networks.TESTNET,
    );
    expect(tx).toBeDefined();
    expect(tx).toBeInstanceOf(StellarSdk.Transaction);
    const normalTx = tx as StellarSdk.Transaction;
    expect(normalTx.operations).toHaveLength(1);
    expect(normalTx.operations[0].type).toBe('invokeHostFunction');
  });

  it('should return 400 when contract simulation fails with mapped error code', async () => {
    jest.spyOn(liquidityClient, 'getPoolStats').mockResolvedValue({
      totalLiquidity: 100000n * STROOPS,
      lockedLiquidity: 90000n * STROOPS,
      availableLiquidity: 10000n * STROOPS,
      totalShares: 95000n * STROOPS,
      sharePrice: 10500n,
      withdrawalFeeBps: 50n,
    });
    jest.spyOn(liquidityClient, 'calculateDeposit').mockResolvedValue(4761904761n);

    const mockErrorResponse = {
      error: 'HostError: Error(Contract, #101)',
    };

    jest.spyOn(sorobanService.getServer(), 'simulateTransaction').mockResolvedValue(mockErrorResponse as any);

    const res = await app.inject({
      method: 'POST',
      url: '/liquidity/deposit',
      headers: { authorization: 'Bearer test' },
      payload: { amount: 100 },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.code).toBe('LIQUIDITY_INVALID_AMOUNT');
    expect(body.message).toBe('The requested amount is invalid or must be greater than zero.');
  });
});
