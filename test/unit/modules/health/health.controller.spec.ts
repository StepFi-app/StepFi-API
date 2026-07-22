import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from '../../../../src/modules/health/health.controller';
import { HealthService } from '../../../../src/modules/health/health.service';
import { ServiceUnavailableException } from '@nestjs/common';

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: HealthService;

  const mockHealthService = {
    check: jest.fn(),
    checkDatabase: jest.fn(),
    checkDatabaseMinimal: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: mockHealthService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthService = module.get<HealthService>(HealthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check', () => {
    it('should return health status', async () => {
      const expectedResult = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'StepFi API',
      };

      mockHealthService.check.mockResolvedValue(expectedResult);

      const result = await controller.check();

      expect(result).toEqual(expectedResult);
      expect(healthService.check).toHaveBeenCalledTimes(1);
    });

    it('should throw ServiceUnavailableException if health is degraded', async () => {
      const degradedResult = {
        status: 'degraded',
        timestamp: new Date().toISOString(),
        service: 'StepFi API',
      };

      mockHealthService.check.mockResolvedValue(degradedResult);

      await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
      expect(healthService.check).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkDatabase', () => {
    it('should return database status', async () => {
      const expectedResult = {
        status: 'ok',
        database: 'connected',
        message: 'Successfully connected to Supabase',
        timestamp: new Date().toISOString(),
      };

      mockHealthService.checkDatabaseMinimal.mockResolvedValue(expectedResult);

      const result = await controller.checkDatabase();

      expect(result).toEqual(expectedResult);
      expect(healthService.checkDatabaseMinimal).toHaveBeenCalledTimes(1);
    });

    it('should throw ServiceUnavailableException if database connection failed', async () => {
      const failedResult = {
        status: 'error',
        database: 'disconnected',
        message: 'Connection failed',
        timestamp: new Date().toISOString(),
      };

      mockHealthService.checkDatabaseMinimal.mockResolvedValue(failedResult);

      await expect(controller.checkDatabase()).rejects.toThrow(ServiceUnavailableException);
      expect(healthService.checkDatabaseMinimal).toHaveBeenCalledTimes(1);
    });
  });
});

