import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.client';

export interface AuthoritativeLoan {
  loanId: string;
  userWallet: string;
  status: string;
  principalAmount: number;
  transactionHash: string | null;
}

export interface AuthoritativeLiquidityPosition {
  userWallet: string;
  amount: number;
}

export interface AuthoritativeReputation {
  wallet: string;
  score: number;
}

export interface AuthoritativeState {
  loans: AuthoritativeLoan[];
  liquidityPositions: AuthoritativeLiquidityPosition[];
  reputations: AuthoritativeReputation[];
  transactionHashes: string[];
}

interface LoanIndexRow {
  loan_id: string;
  user_wallet: string;
  status: string;
  principal_amount: number | string;
  transaction_hash: string | null;
}

interface InvestmentIndexRow {
  user_wallet: string;
  amount: number | string;
}

interface ReputationHistoryRow {
  user_wallet: string;
  new_score: number;
  transaction_hash: string | null;
  ledger_sequence: number | null;
}

interface PaymentIndexRow {
  tx_hash: string;
}

@Injectable()
export class AuthoritativeStateReader {
  constructor(private readonly supabaseService: SupabaseService) {}

  async read(): Promise<AuthoritativeState> {
    const db = this.supabaseService.getServiceRoleClient();
    const [loanResult, investmentResult, reputationResult, paymentResult] = await Promise.all([
      db.from('loan_index').select('loan_id, user_wallet, status, principal_amount, transaction_hash'),
      db.from('investments_index').select('user_wallet, amount'),
      db
        .from('reputation_history')
        .select('user_wallet, new_score, transaction_hash, ledger_sequence')
        .order('ledger_sequence', { ascending: false }),
      db.from('payment_index').select('tx_hash'),
    ]);

    const error = loanResult.error ?? investmentResult.error ?? reputationResult.error ?? paymentResult.error;
    if (error) {
      throw new Error(`Failed to read authoritative indexed state: ${error.message}`);
    }

    const loans = (loanResult.data ?? []) as LoanIndexRow[];
    const investments = (investmentResult.data ?? []) as InvestmentIndexRow[];
    const reputationRows = (reputationResult.data ?? []) as ReputationHistoryRow[];
    const payments = (paymentResult.data ?? []) as PaymentIndexRow[];
    const latestReputation = new Map<string, AuthoritativeReputation>();
    for (const row of reputationRows) {
      if (!latestReputation.has(row.user_wallet)) {
        latestReputation.set(row.user_wallet, { wallet: row.user_wallet, score: row.new_score });
      }
    }

    const transactionHashes = new Set<string>();
    for (const row of loans) if (row.transaction_hash) transactionHashes.add(row.transaction_hash);
    for (const row of reputationRows) if (row.transaction_hash) transactionHashes.add(row.transaction_hash);
    for (const row of payments) if (row.tx_hash) transactionHashes.add(row.tx_hash);

    const liquidityByWallet = new Map<string, number>();
    for (const row of investments) {
      liquidityByWallet.set(
        row.user_wallet,
        (liquidityByWallet.get(row.user_wallet) ?? 0) + Number(row.amount),
      );
    }

    return {
      loans: loans.map((row) => ({
        loanId: row.loan_id,
        userWallet: row.user_wallet,
        status: row.status,
        principalAmount: Number(row.principal_amount),
        transactionHash: row.transaction_hash,
      })),
      liquidityPositions: [...liquidityByWallet].map(([userWallet, amount]) => ({
        userWallet,
        amount,
      })),
      reputations: [...latestReputation.values()],
      transactionHashes: [...transactionHashes],
    };
  }
}
