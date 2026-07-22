import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.client';
import { AuthoritativeLoan } from '../../indexer/authoritative-state.reader';

export interface ReconciliationLoanRow {
  id: string;
  loanId: string;
  userWallet: string;
  amount: number;
  status: string;
}

interface LoanRow {
  id: string;
  loan_id: string;
  user_wallet: string;
  amount: number | string;
  status: string;
}

@Injectable()
export class LoansRepository {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findForReconciliation(): Promise<ReconciliationLoanRow[]> {
    const { data, error } = await this.supabaseService
      .getServiceRoleClient()
      .from('loans')
      .select('id, loan_id, user_wallet, amount, status');
    if (error) throw new Error(`Failed to read loans for reconciliation: ${error.message}`);
    return ((data ?? []) as LoanRow[]).map((row) => ({
      id: row.id,
      loanId: row.loan_id,
      userWallet: row.user_wallet,
      amount: Number(row.amount),
      status: row.status,
    }));
  }

  async resolveProvisionalId(rowId: string, chainLoan: AuthoritativeLoan): Promise<void> {
    const { error } = await this.supabaseService
      .getServiceRoleClient()
      .from('loans')
      .update({ loan_id: chainLoan.loanId, status: chainLoan.status, updated_at: new Date().toISOString() })
      .eq('id', rowId);
    if (error) throw new Error(`Failed to resolve provisional loan ID: ${error.message}`);
  }

  async updateStatus(rowId: string, status: string): Promise<void> {
    const { error } = await this.supabaseService
      .getServiceRoleClient()
      .from('loans')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', rowId);
    if (error) throw new Error(`Failed to reconcile loan status: ${error.message}`);
  }
}
