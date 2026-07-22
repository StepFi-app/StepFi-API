import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import {
  JOB_STALE_THRESHOLD_CONFIG,
  MonitoredJobName,
} from '../../config/env';
import { MetricsService } from '../../modules/metrics/metrics.service';

interface JobState {
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
}

export interface JobHealthStatus {
  job: MonitoredJobName;
  status: 'ok' | 'stale';
  lastSuccessAt: string | null;
  ageSeconds: number;
  thresholdSeconds: number;
  consecutiveFailures: number;
}

@Injectable()
export class JobMonitorService {
  private readonly logger = new Logger(JobMonitorService.name);
  private readonly startedAt = new Date();
  private readonly states = new Map<MonitoredJobName, JobState>();

  constructor(
    private readonly configService: ConfigService,
    private readonly metricsService: MetricsService,
  ) {
    for (const job of Object.keys(
      JOB_STALE_THRESHOLD_CONFIG,
    ) as MonitoredJobName[]) {
      this.states.set(job, { lastSuccessAt: null, consecutiveFailures: 0 });
      this.metricsService.setJobConsecutiveFailures(job, 0);
    }
  }

  recordSuccess(job: MonitoredJobName): void {
    const now = new Date();
    this.states.set(job, { lastSuccessAt: now, consecutiveFailures: 0 });
    this.metricsService.setJobLastSuccessTimestamp(
      job,
      Math.floor(now.getTime() / 1000),
    );
    this.metricsService.setJobConsecutiveFailures(job, 0);
  }

  recordFailure(job: MonitoredJobName, error: unknown): void {
    const current = this.getState(job);
    const consecutiveFailures = current.consecutiveFailures + 1;
    this.states.set(job, { ...current, consecutiveFailures });
    this.metricsService.setJobConsecutiveFailures(job, consecutiveFailures);

    const capturedError =
      error instanceof Error ? error : new Error(String(error));

    this.logger.error(
      {
        job,
        consecutiveFailures,
        error: capturedError.message,
        stack: capturedError.stack,
      },
      'Background job run failed',
    );

    if (this.shouldCaptureFailure(consecutiveFailures)) {
      Sentry.captureException(capturedError, {
        tags: { job },
        contexts: {
          job: { name: job, consecutiveFailures },
        },
      });
    }
  }

  getHealthStatuses(now = new Date()): JobHealthStatus[] {
    return (Object.keys(
      JOB_STALE_THRESHOLD_CONFIG,
    ) as MonitoredJobName[]).map((job) => {
      const state = this.getState(job);
      const referenceTime = state.lastSuccessAt ?? this.startedAt;
      const ageSeconds = Math.max(
        0,
        Math.floor((now.getTime() - referenceTime.getTime()) / 1000),
      );
      const thresholdSeconds = this.getThresholdSeconds(job);

      return {
        job,
        status: ageSeconds > thresholdSeconds ? 'stale' : 'ok',
        lastSuccessAt: state.lastSuccessAt?.toISOString() ?? null,
        ageSeconds,
        thresholdSeconds,
        consecutiveFailures: state.consecutiveFailures,
      };
    });
  }

  private getState(job: MonitoredJobName): JobState {
    return (
      this.states.get(job) ?? {
        lastSuccessAt: null,
        consecutiveFailures: 0,
      }
    );
  }

  private getThresholdSeconds(job: MonitoredJobName): number {
    const definition = JOB_STALE_THRESHOLD_CONFIG[job];
    return this.configService.get<number>(
      definition.env,
      definition.defaultSeconds,
    );
  }

  private shouldCaptureFailure(consecutiveFailures: number): boolean {
    return (
      consecutiveFailures > 0 &&
      (consecutiveFailures & (consecutiveFailures - 1)) === 0
    );
  }
}
