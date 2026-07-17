import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../../database/supabase.client';

@Injectable()
export class NonceCleanupService {
  private readonly logger = new Logger(NonceCleanupService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredNonces(): Promise<void> {
    try {
      const client = this.supabaseService.getServiceRoleClient();

      const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const { error, count } = await client
        .from('nonces')
        .delete({ count: 'exact' })
        .lt('expires_at', cutoff);

      if (error) {
        this.logger.error(`Failed to delete expired nonces: ${error.message}`);
        throw error;
      }

      this.logger.log(`Deleted ${count ?? 0} expired nonces`);
    } catch (error) {
      this.logger.error('Nonce cleanup failed', error);
    }
  }
}
