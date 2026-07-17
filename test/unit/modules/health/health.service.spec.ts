import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from '../../../../src/modules/health/health.service';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { HorizonClientService } from '../../../../src/stellar/horizon-client.service';
import { getQueueToken } from '@nestjs/bullmq';

describe('HealthService', () => {
  let service: HealthService;
  let supabaseService: SupabaseService;

  const mockSupabaseClient = {
    auth: {
      getSession: jest.fn(),
    },
  };

  const mockSupabaseService = {
    getClient: jest.fn(() => mockSupabaseClient),
    getServiceRoleClient: jest.fn(() => mockSupabaseClient),
  };

  const mockHorizonClientService = {
    getRoot: jest.fn().mockResolvedValue({
      horizon_version: '2.0.0',
      network: 'testnet',
      core_version: 'v22.0.0',
      history_latest_ledger: 12345,
    }),
    getEndpointStatuses: jest.fn().mockReturnValue([
      { url: 'https://horizon-testnet.stellar.org', status: 'closed', failureCount: 0, lastFailure: null, isPrimary: true },
    ]),
    getNetworkPassphrase: jest.fn().mockReturnValue('Test SDF Network ; September 2015'),
    submitTransaction: jest.fn(),
    getTransaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: SupabaseService,
          useValue: mockSupabaseService,
        },
        {
          provide: HorizonClientService,
          useValue: mockHorizonClientService,
        },
        {
          provide: getQueueToken('blockchain-indexer'),
          useValue: {
            getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, failed: 0 }),
            getWaitingCount: jest.fn().mockResolvedValue(0),
            getActiveCount: jest.fn().mockResolvedValue(0),
            getDelayedCount: jest.fn().mockResolvedValue(0),
            getFailedCount: jest.fn().mockResolvedValue(0),
            client: { ping: jest.fn().mockResolvedValue('PONG') },
            name: 'blockchain-indexer',
          },
        },
        {
          provide: getQueueToken('payment-reminders'),
          useValue: {
            getWaitingCount: jest.fn().mockResolvedValue(0),
            getActiveCount: jest.fn().mockResolvedValue(0),
            getDelayedCount: jest.fn().mockResolvedValue(0),
            getFailedCount: jest.fn().mockResolvedValue(0),
            name: 'payment-reminders',
          },
        },
        {
          provide: getQueueToken('transaction-status-checker'),
          useValue: {
            getWaitingCount: jest.fn().mockResolvedValue(0),
            getActiveCount: jest.fn().mockResolvedValue(0),
            getDelayedCount: jest.fn().mockResolvedValue(0),
            getFailedCount: jest.fn().mockResolvedValue(0),
            name: 'transaction-status-checker',
          },
        },
        {
          provide: getQueueToken('nonce-cleanup'),
          useValue: {
            getWaitingCount: jest.fn().mockResolvedValue(0),
            getActiveCount: jest.fn().mockResolvedValue(0),
            getDelayedCount: jest.fn().mockResolvedValue(0),
            getFailedCount: jest.fn().mockResolvedValue(0),
            name: 'nonce-cleanup',
          },
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    supabaseService = module.get<SupabaseService>(SupabaseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('check', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should return health status', async () => {
      const result = await service.check();

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('service', 'StepFi API');
      expect(result).toHaveProperty('checks');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('checkDatabase', () => {
    it('should return connected status when database is available', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        error: null,
        data: { session: null },
      });

      const result = await service.checkDatabase();

      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('database', 'connected');
      expect(result).toHaveProperty('message', 'Supabase reachable');
      expect(supabaseService.getClient).toHaveBeenCalled();
    });

    it('should return connected status when error is Invalid Refresh Token', async () => {
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        error: { message: 'Invalid Refresh Token' },
        data: { session: null },
      });

      const result = await service.checkDatabase();

      expect(result).toHaveProperty('status', 'ok');
      expect(result).toHaveProperty('database', 'connected');
    });

    it('should return error status when database connection fails', async () => {
      const errorMessage = 'Connection failed';
      mockSupabaseClient.auth.getSession.mockResolvedValue({
        error: { message: errorMessage },
        data: { session: null },
      });

      const result = await service.checkDatabase();

      expect(result).toHaveProperty('status', 'error');
      expect(result).toHaveProperty('database', 'disconnected');
      expect(result).toHaveProperty('message', errorMessage);
    });

    it('should return error status when exception is thrown', async () => {
      const errorMessage = 'Network error';
      mockSupabaseClient.auth.getSession.mockRejectedValue(new Error(errorMessage));

      const result = await service.checkDatabase();

      expect(result).toHaveProperty('status', 'error');
      expect(result).toHaveProperty('database', 'disconnected');
      expect(result).toHaveProperty('message', errorMessage);
    });
  });
});

