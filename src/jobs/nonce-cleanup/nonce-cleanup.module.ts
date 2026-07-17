import { Module } from '@nestjs/common';
import { NonceCleanupService } from './nonce-cleanup.service';
import { SupabaseService } from '../../database/supabase.client';

@Module({
  providers: [NonceCleanupService, SupabaseService],
})
export class NonceCleanupModule {}
