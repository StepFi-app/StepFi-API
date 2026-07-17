import { Module } from '@nestjs/common';
import { SupabaseKeepAliveService } from './supabase-keepalive.service';
import { SupabaseService } from '../../database/supabase.client';

@Module({
  providers: [SupabaseKeepAliveService, SupabaseService],
})
export class SupabaseKeepAliveModule {}
