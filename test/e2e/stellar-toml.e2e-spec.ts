import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as request from 'supertest';
import { HealthModule } from '../../src/modules/health/health.module';
import { SupabaseService } from '../../src/database/supabase.client';

describe('StellarTomlController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';
    process.env.CREDIT_LINE_CONTRACT_ID = 'C_CREDIT_LINE_TEST';
    process.env.LIQUIDITY_POOL_CONTRACT_ID = 'C_LIQUIDITY_POOL_TEST';
    process.env.REPUTATION_CONTRACT_ID = 'C_REPUTATION_TEST';
    process.env.VENDOR_REGISTRY_CONTRACT_ID = 'C_VENDOR_REGISTRY_TEST';

    const mockSupabase = {
      getClient: jest.fn().mockReturnValue({ auth: { getSession: jest.fn().mockResolvedValue({}) } }),
      getServiceRoleClient: jest.fn().mockReturnValue({ from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ order: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null }) }) }) }) }) }),
    };

    const mockQueue = {
      client: Promise.resolve({ ping: jest.fn().mockResolvedValue('PONG') }),
      getWaitingCount: jest.fn().mockResolvedValue(0),
      getActiveCount: jest.fn().mockResolvedValue(0),
      getDelayedCount: jest.fn().mockResolvedValue(0),
      getFailedCount: jest.fn().mockResolvedValue(0),
      name: 'test',
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), HealthModule],
    })
      .overrideProvider(SupabaseService)
      .useValue(mockSupabase)
      .overrideProvider('BullQueue_blockchain-indexer')
      .useValue(mockQueue)
      .overrideProvider('BullQueue_payment-reminders')
      .useValue(mockQueue)
      .overrideProvider('BullQueue_transaction-status-checker')
      .useValue(mockQueue)
      .overrideProvider('BullQueue_nonce-cleanup')
      .useValue(mockQueue)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/.well-known/stellar.toml (GET)', () => {
    it('should return 200 with text/plain content', () => {
      return request(app.getHttpServer())
        .get('/.well-known/stellar.toml')
        .expect(200)
        .expect('Content-Type', /text\/plain/)
        .expect('Access-Control-Allow-Origin', '*')
        .expect((res) => {
          expect(res.text).toContain('C_CREDIT_LINE_TEST');
          expect(res.text).toContain('C_LIQUIDITY_POOL_TEST');
          expect(res.text).toContain('C_REPUTATION_TEST');
          expect(res.text).toContain('C_VENDOR_REGISTRY_TEST');
          expect(res.text).toContain('ORG_NAME="StepFi"');
        });
    });
  });
});
