import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { HealthModule } from '../../../../src/modules/health/health.module';
import { HealthService } from '../../../../src/modules/health/health.service';
import { HealthController } from '../../../../src/modules/health/health.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../../../src/database/supabase.client';

describe('HealthController (e2e)', () => {
  let app: INestApplication;
  let originalFetch: typeof global.fetch;
  let mockFetch: jest.Mock;

  beforeAll(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';

    originalFetch = global.fetch;
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        horizon_version: '2.0.0',
        network: 'testnet',
        core_version: 'v22.0.0',
        history_latest_ledger: 1000,
      }),
    });
    global.fetch = mockFetch;

    const mockChain = {} as any;
    mockChain.select = jest.fn().mockReturnValue(mockChain);
    mockChain.order = jest.fn().mockReturnValue(mockChain);
    mockChain.limit = jest.fn().mockReturnValue(mockChain);
    mockChain.single = jest.fn().mockResolvedValue({ data: { last_ledger: 990 } });

    const mockSupabaseClient = {
      auth: {
        getSession: jest.fn().mockResolvedValue({ error: null }),
      },
      from: jest.fn().mockReturnValue(mockChain),
    };

    const mockSupabase = {
      getClient: jest.fn().mockReturnValue(mockSupabaseClient),
      getServiceRoleClient: jest.fn().mockReturnValue(mockSupabaseClient),
    };

    const mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'STELLAR_HORIZON_URL') return 'https://horizon-testnet.stellar.org';
        return undefined;
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: SupabaseService, useValue: mockSupabase },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    global.fetch = originalFetch;
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
