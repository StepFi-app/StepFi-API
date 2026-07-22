import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.client';
import { JobMonitorService } from '../monitoring/job-monitor.service';

/**
 * Keeps the Supabase project active by issuing a lightweight read every 3 days.
 *
 * Previously scheduled via a BullMQ repeatable job; it now uses a plain
 * `setInterval` so no Redis queue is required for such an infrequent task.
 */
@Injectable()
export class SupabaseKeepAliveService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseKeepAliveService.name);
  private isRunning = false;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly jobMonitorService: JobMonitorService,
  ) {}

  onModuleInit(): void {
    // Run every 3 days in milliseconds
    const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
    setInterval(() => this.ping(), THREE_DAYS);
    this.logger.log('Supabase keep-alive scheduled every 3 days');
  }

  async ping(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('Supabase keep-alive already running, skipping');
      return;
    }
    this.isRunning = true;

    try {
      // Lightweight read (equivalent to `SELECT 1 FROM users LIMIT 1`) that keeps
      // the Supabase project active so the free tier does not pause it for
      // inactivity. `head: true` executes the query without transferring rows.
      const { error } = await this.supabaseService
        .getServiceRoleClient()
        .from('users')
        .select('*', { head: true })
        .limit(1);

      if (error) {
        throw new Error(error.message);
      }

      this.logger.log('Supabase keep-alive ping successful');
      this.jobMonitorService.recordSuccess('supabaseKeepAlive');
    } catch (error) {
      this.logger.error('Keep-alive ping failed', error);
      this.jobMonitorService.recordFailure('supabaseKeepAlive', error);
    } finally {
      this.isRunning = false;
    }
  }
}
