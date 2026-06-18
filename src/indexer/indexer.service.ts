import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * Schedules the blockchain-indexer repeating job on module initialisation.
 *
 * The job runs every 6 seconds. If the job already exists (e.g. after a
 * hot-reload) BullMQ silently skips the duplicate.
 */
@Injectable()
export class IndexerService implements OnModuleInit {
  private readonly logger = new Logger(IndexerService.name);

  constructor(
    @InjectQueue('blockchain-indexer')
    private readonly indexerQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.indexerQueue.getRepeatableJobs();
    for (const job of existing) {
      await this.indexerQueue.removeRepeatableByKey(job.key);
    }

    await this.indexerQueue.add(
      'index-events',
      {},
      {
        repeat: { every: 6_000 }, // 6 seconds
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 50 },
      },
    );

    this.logger.log(
      {
        context: 'IndexerService',
        action: 'onModuleInit',
      },
      'Indexer job scheduled — runs every 6 seconds',
    );
  }
}
