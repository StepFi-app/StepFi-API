import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from '../../../../src/modules/health/health.service';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { ConfigService } from '@nestjs/config';

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: SupabaseService,
          useValue: mockSupabaseService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: any) => defaultValue),
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
      jest.spyOn(service, 'checkDatabase').mockResolvedValue({
        status: 'ok',
        database: 'connected',
        message: 'Supabase reachable',
      });
      jest.spyOn(service, 'checkHorizon').mockResolvedValue({ status: 'ok' });
      jest.spyOn(service, 'checkIndexerLag').mockResolvedValue({ status: 'ok' });

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
