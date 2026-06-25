import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * Schedules the default-detection repeating job on module initialisation.
 *
 * The job runs every 6 hours. Stale repeatable jobs from previous runs
 * are removed before re-scheduling to avoid duplicate executions after
 * hot-reloads or restarts.
 */
@Injectable()
export class DefaultDetectionService implements OnModuleInit {
  private readonly logger = new Logger(DefaultDetectionService.name);

  constructor(
    @InjectQueue('default-detection')
    private readonly defaultDetectionQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Clean up any stale repeatable jobs from a previous run
    const existing = await this.defaultDetectionQueue.getRepeatableJobs();
    for (const job of existing) {
      await this.defaultDetectionQueue.removeRepeatableByKey(job.key);
    }

    await this.defaultDetectionQueue.add(
      'detect-defaults',
      {},
      {
        repeat: { pattern: '0 */6 * * *' },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    );

    this.logger.log(
      {
        context: 'DefaultDetectionService',
        action: 'onModuleInit',
      },
      'Default detection job scheduled — runs every 6 hours',
    );
  }
}
