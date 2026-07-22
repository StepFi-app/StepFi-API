import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.client';

export interface ReconciliationTransaction {
  id: string;
  hash: string;
  status: string;
  submittedAt: string;
}

interface TransactionRow {
  id: string;
  transaction_hash: string | null;
  hash: string | null;
  status: string;
  submitted_at: string;
}

@Injectable()
export class TransactionsRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findForReconciliation(): Promise<ReconciliationTransaction[]> {
    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
      .from('transactions')
      .select('id, transaction_hash, hash, status, submitted_at');
    if (error) throw new Error(`Failed to read transactions for reconciliation: ${error.message}`);
    return ((data ?? []) as TransactionRow[]).flatMap((row) => {
      const hash = row.transaction_hash ?? row.hash;
      return hash ? [{ id: row.id, hash, status: row.status, submittedAt: row.submitted_at }] : [];
    });
  }

  async markSucceeded(id: string): Promise<void> {
    await this.update(id, { status: 'success', completed_at: new Date().toISOString(), error: null });
  }

  async markOrphaned(id: string): Promise<void> {
    await this.update(id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: 'Reconciliation: transaction not found in authoritative indexed events',
    });
  }

  async backfill(hash: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabaseService.getServiceRoleClient().from('transactions').upsert(
      {
        transaction_hash: hash,
        user_wallet: 'indexer',
        type: 'indexed_event',
        status: 'success',
        xdr: '',
        submitted_at: now,
        completed_at: now,
        updated_at: now,
      },
      { onConflict: 'transaction_hash', ignoreDuplicates: true },
    );
    if (error) throw new Error(`Failed to backfill indexed transaction: ${error.message}`);
  }

  private async update(id: string, values: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabaseService
      .getServiceRoleClient()
      .from('transactions')
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`Failed to reconcile transaction: ${error.message}`);
  }
}
