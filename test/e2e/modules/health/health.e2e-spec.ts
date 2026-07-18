import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../../../src/app.module';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { HorizonClientService } from '../../../../src/stellar/horizon-client.service';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test_jwt_secret_for_e2e_testing_min_32_chars';
    process.env.JWT_REFRESH_SECRET = 'test_jwt_refresh_secret_for_e2e_testing_min_32_chars';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';

    const mockSupabase = {
      getClient: jest.fn().mockReturnValue({ auth: { getSession: jest.fn().mockResolvedValue({ error: null }) } }),
      getServiceRoleClient: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: { last_ledger: 990 } }),
              }),
            }),
          }),
        }),
      }),
    };

    const mockHorizon = {
      getRoot: jest.fn().mockResolvedValue({
        horizon_version: '2.0.0',
        network: 'testnet',
        core_version: 'v22.0.0',
        history_latest_ledger: 1000,
      }),
      getEndpointStatuses: jest.fn().mockReturnValue([
        { url: 'https://horizon.stellar.org', status: 'closed', failureCount: 0, lastFailure: null, isPrimary: true },
      ]),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SupabaseService)
      .useValue(mockSupabase)
      .overrideProvider(HorizonClientService)
      .useValue(mockHorizon)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/health (GET)', () => {
    it('should return health status', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('status', 'ok');
          expect(res.body).toHaveProperty('timestamp');
          expect(res.body).toHaveProperty('service', 'StepFi API');
        });
    });
  });

  describe('/health/db (GET)', () => {
    it('should return database status', () => {
      return request(app.getHttpServer())
        .get('/health/db')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('status');
          expect(res.body).toHaveProperty('database');
          expect(res.body).toHaveProperty('timestamp');
        });
    });
  });
});

