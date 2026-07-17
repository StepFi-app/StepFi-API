import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.client';

@Injectable()
export class IndexerStatusService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getStatus() {
    const db = this.supabaseService.getServiceRoleClient();
    const { data, error } = await db
      .from('indexer_state')
      .select('contract_id, last_ledger, updated_at')
      .order('updated_at', { ascending: false });

    return {
      status: error ? 'error' : 'ok',
      data: data ?? [],
      error: error?.message || null,
    };
  }
}
