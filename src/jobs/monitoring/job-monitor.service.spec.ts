import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import {
  JOB_STALE_THRESHOLD_CONFIG,
  validateEnvironment,
} from '../../config/env';
import { MetricsService } from '../../modules/metrics/metrics.service';
import { JobMonitorService } from './job-monitor.service';

describe('JobMonitorService', () => {
  const metricsService = {
    setJobLastSuccessTimestamp: jest.fn(),
    setJobConsecutiveFailures: jest.fn(),
  };
  const configService = {
    get: jest.fn((_key: string, defaultValue: number) => defaultValue),
  };

  let service: JobMonitorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new JobMonitorService(
      configService as unknown as ConfigService,
      metricsService as unknown as MetricsService,
    );
  });

  it('records success timestamps and resets the failure gauge', () => {
    service.recordFailure('indexer', new Error('temporary failure'));
    service.recordSuccess('indexer');

    expect(metricsService.setJobLastSuccessTimestamp).toHaveBeenCalledWith(
      'indexer',
      expect.any(Number),
    );
    expect(metricsService.setJobConsecutiveFailures).toHaveBeenLastCalledWith(
      'indexer',
      0,
    );
  });

  it('captures the first failure and then powers of two to avoid alert noise', () => {
    const captureException = jest
      .spyOn(Sentry, 'captureException')
      .mockReturnValue('event-id');

    for (let failure = 1; failure <= 8; failure++) {
      service.recordFailure('transactionStatusChecker', new Error('down'));
    }

    expect(captureException).toHaveBeenCalledTimes(4);
    expect(captureException).toHaveBeenLastCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { job: 'transactionStatusChecker' },
        contexts: {
          job: {
            name: 'transactionStatusChecker',
            consecutiveFailures: 8,
          },
        },
      }),
    );
  });

  it('reports a job as stale after its configured threshold', () => {
    service.recordSuccess('indexer');
    const statuses = service.getHealthStatuses(
      new Date(Date.now() + 181_000),
    );

    expect(statuses.find((status) => status.job === 'indexer')).toEqual(
      expect.objectContaining({ status: 'stale', thresholdSeconds: 180 }),
    );
  });

  it('validates and applies job threshold defaults at startup', () => {
    const validated = validateEnvironment({});
    expect(
      validated[JOB_STALE_THRESHOLD_CONFIG.indexer.env],
    ).toBe(JOB_STALE_THRESHOLD_CONFIG.indexer.defaultSeconds);

    expect(() =>
      validateEnvironment({
        [JOB_STALE_THRESHOLD_CONFIG.indexer.env]: '0',
      }),
    ).toThrow('must be a positive integer');
  });
});
