import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ReputationModule } from '../../../../src/modules/reputation/reputation.module';
import { ReputationContractClient } from '../../../../src/stellar/contracts/clients/reputation.client';
import { SorobanService } from '../../../../src/blockchain/soroban/soroban.service';

describe('ReputationController (e2e)', () => {
  let app: NestFastifyApplication;

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

  const mockReputationContract = {
    getScore: jest.fn().mockResolvedValue(75),
  };

  const mockSorobanService = {
    simulateContractCall: jest.fn(),
    getServer: jest.fn(),
    getNetworkPassphrase: jest.fn().mockReturnValue('Test SDF Network ; September 2015'),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        ReputationModule,
      ],
    })
      .overrideProvider(ReputationContractClient)
      .useValue(mockReputationContract)
      .overrideProvider(SorobanService)
      .useValue(mockSorobanService)
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );

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

  // ---------------------------------------------------------------------------
  // GET /reputation/:wallet
  // ---------------------------------------------------------------------------
  describe('GET /reputation/:wallet', () => {
    it('should return 200 with reputation data for a valid wallet', async () => {
      mockReputationContract.getScore.mockResolvedValue(75);

      const res = await app.inject({
        method: 'GET',
        url: `/reputation/${validWallet}`,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('message', 'Reputation score retrieved successfully');
      expect(body.data).toHaveProperty('wallet', validWallet);
      expect(body.data).toHaveProperty('score', 75);
      expect(body.data).toHaveProperty('tier', 'silver');
      expect(body.data).toHaveProperty('interestRate');
      expect(body.data).toHaveProperty('maxCredit');
      expect(body.data).toHaveProperty('lastUpdated');
    }, 10000);

    it('should return 200 with default score when wallet has no on-chain data', async () => {
      mockReputationContract.getScore.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: `/reputation/${validWallet}`,
      });

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.payload);
      expect(body.success).toBe(true);
      expect(body.data.score).toBe(50);
      expect(body.data.tier).toBe('poor');
    }, 10000);

    it('should return 400 for an invalid wallet address', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/reputation/INVALID_WALLET',
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 400 for a wallet that does not start with G', async () => {
      const badWallet = 'XABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

      const res = await app.inject({
        method: 'GET',
        url: `/reputation/${badWallet}`,
      });

      expect(res.statusCode).toBe(400);
    });

    it('should return 500 when the blockchain RPC is unavailable', async () => {
      mockReputationContract.getScore.mockRejectedValue(
        new Error('request timeout'),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/reputation/${validWallet}`,
      });

      expect(res.statusCode).toBe(500);
    }, 10000);
  });

  // ---------------------------------------------------------------------------
  // GET /reputation/me
  // ---------------------------------------------------------------------------
  describe('GET /reputation/me', () => {
    it('should return 401 since auth guard is not yet implemented', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/reputation/me',
      });

      // Returns 401 because auth guard (API-03) is not wired yet
      expect(res.statusCode).toBe(401);
    });
  });
});
