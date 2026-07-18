import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseService } from '../../database/supabase.client';
import {
  AuthoritativeState,
  AuthoritativeStateReader,
} from '../../indexer/authoritative-state.reader';
import { LoansRepository, ReconciliationLoanRow } from '../../modules/loans/loans.repository';
import { MetricsService } from '../../modules/metrics/metrics.service';
import {
  ReconciliationTransaction,
  TransactionsRepository,
} from '../../modules/transactions/transactions.repository';
import { DriftItem, DriftReport, DriftType } from './state-reconciliation.types';

interface LiquidityRow {
  id: string;
  provider_wallet: string;
  deposited_amount: number | string;
}

interface ReputationRow {
  wallet_address: string;
  score: number;
}

const DRIFT_TYPES: DriftType[] = [
  'missing_loan_row',
  'stale_loan_status',
  'provisional_loan_id',
  'orphaned_pending_transaction',
  'missing_transaction_row',
  'stale_liquidity_position',
  'stale_reputation',
];

@Injectable()
export class StateReconciliationProcessor {
  private readonly logger = new Logger(StateReconciliationProcessor.name);
  private isRunning = false;

  constructor(
    private readonly authoritativeStateReader: AuthoritativeStateReader,
    private readonly loansRepository: LoansRepository,
    private readonly transactionsRepository: TransactionsRepository,
    private readonly supabaseService: SupabaseService,
    private readonly metricsService: MetricsService,
  ) {}

  @Cron('0 */15 * * * *')
  async runScheduled(): Promise<void> {
    if (this.isRunning) {
      this.logger.debug('State reconciliation already running; skipping overlapping cycle');
      return;
    }
    this.isRunning = true;
    try {
      const report = await this.reconcile();
      this.logger.log({ event: 'state_reconciliation_completed', report }, 'State reconciliation completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ event: 'state_reconciliation_failed', error: message }, 'State reconciliation failed');
    } finally {
      this.isRunning = false;
    }
  }

  async reconcile(): Promise<DriftReport> {
    const startedAt = new Date().toISOString();
    const [chain, loans, transactions] = await Promise.all([
      this.authoritativeStateReader.read(),
      this.loansRepository.findForReconciliation(),
      this.transactionsRepository.findForReconciliation(),
    ]);
    const items: DriftItem[] = [];
    await this.reconcileLoans(chain, loans, items);
    await this.reconcileTransactions(chain, transactions, items);
    await this.reconcileLiquidity(chain, items);
    await this.reconcileReputation(chain, items);

    const byType = Object.fromEntries(DRIFT_TYPES.map((type) => [type, 0])) as Record<DriftType, number>;
    for (const item of items) byType[item.type] += 1;
    for (const type of DRIFT_TYPES) this.metricsService.setReconciliationDrift(type, byType[type]);

    return {
      startedAt,
      completedAt: new Date().toISOString(),
      driftCount: items.length,
      repairedCount: items.filter((item) => item.repaired).length,
      byType,
      items,
    };
  }

  private async reconcileLoans(
    chain: AuthoritativeState,
    rows: ReconciliationLoanRow[],
    items: DriftItem[],
  ): Promise<void> {
    const rowsByLoanId = new Map(rows.map((row) => [row.loanId, row]));
    const provisional = rows.filter((row) =>
      row.loanId.startsWith('loan_') ||
      row.loanId.startsWith('pending_') ||
      row.loanId.startsWith('pending-'),
    );
    for (const chainLoan of chain.loans) {
      const row = rowsByLoanId.get(chainLoan.loanId);
      if (row) {
        if (row.status !== chainLoan.status) {
          await this.loansRepository.updateStatus(row.id, chainLoan.status);
          items.push({ type: 'stale_loan_status', key: chainLoan.loanId, repaired: true, details: { from: row.status, to: chainLoan.status } });
        }
        continue;
      }
      const candidates = provisional.filter((candidate) => candidate.userWallet === chainLoan.userWallet);
      const match = candidates.find((candidate) =>
        Math.abs(candidate.amount - chainLoan.principalAmount) < 0.000001 ||
        Math.abs(candidate.amount * 0.8 - chainLoan.principalAmount) < 0.000001,
      ) ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (match) {
        await this.loansRepository.resolveProvisionalId(match.id, chainLoan);
        items.push({ type: 'provisional_loan_id', key: match.loanId, repaired: true, details: { chainLoanId: chainLoan.loanId } });
      } else {
        items.push({ type: 'missing_loan_row', key: chainLoan.loanId, repaired: false, details: { userWallet: chainLoan.userWallet } });
      }
    }
  }

  private async reconcileTransactions(
    chain: AuthoritativeState,
    rows: ReconciliationTransaction[],
    items: DriftItem[],
  ): Promise<void> {
    const chainHashes = new Set(chain.transactionHashes.map((hash) => hash.toLowerCase()));
    const rowsByHash = new Map(rows.map((row) => [row.hash.toLowerCase(), row]));
    for (const hash of chainHashes) {
      const row = rowsByHash.get(hash);
      if (!row) {
        await this.transactionsRepository.backfill(hash);
        items.push({ type: 'missing_transaction_row', key: hash, repaired: true, details: {} });
      } else if (row.status === 'pending') {
        await this.transactionsRepository.markSucceeded(row.id);
        items.push({ type: 'orphaned_pending_transaction', key: hash, repaired: true, details: { resolution: 'success' } });
      }
    }
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const row of rows) {
      if (row.status === 'pending' && !chainHashes.has(row.hash.toLowerCase()) && Date.parse(row.submittedAt) < cutoff) {
        await this.transactionsRepository.markOrphaned(row.id);
        items.push({ type: 'orphaned_pending_transaction', key: row.hash, repaired: true, details: { resolution: 'failed' } });
      }
    }
  }

  private async reconcileLiquidity(chain: AuthoritativeState, items: DriftItem[]): Promise<void> {
    const db = this.supabaseService.getServiceRoleClient();
    const { data, error } = await db.from('liquidity_positions').select('id, provider_wallet, deposited_amount');
    if (error) throw new Error(`Failed to read liquidity positions: ${error.message}`);
    const rows = (data ?? []) as LiquidityRow[];
    const byWallet = new Map(rows.map((row) => [row.provider_wallet, row]));
    for (const position of chain.liquidityPositions) {
      const row = byWallet.get(position.userWallet);
      if (!row || Number(row.deposited_amount) !== position.amount) {
        const payload = { provider_wallet: position.userWallet, deposited_amount: position.amount, updated_at: new Date().toISOString() };
        const result = row
          ? await db.from('liquidity_positions').update(payload).eq('id', row.id)
          : await db.from('liquidity_positions').insert(payload);
        if (result.error) throw new Error(`Failed to reconcile liquidity position: ${result.error.message}`);
        items.push({ type: 'stale_liquidity_position', key: position.userWallet, repaired: true, details: { amount: position.amount } });
      }
    }
  }

  private async reconcileReputation(chain: AuthoritativeState, items: DriftItem[]): Promise<void> {
    const db = this.supabaseService.getServiceRoleClient();
    const { data, error } = await db.from('reputation_cache').select('wallet_address, score');
    if (error) throw new Error(`Failed to read reputation cache: ${error.message}`);
    const rows = (data ?? []) as ReputationRow[];
    const byWallet = new Map(rows.map((row) => [row.wallet_address, row]));
    for (const reputation of chain.reputations) {
      const row = byWallet.get(reputation.wallet);
      if (!row) {
        items.push({ type: 'stale_reputation', key: reputation.wallet, repaired: false, details: { score: reputation.score, reason: 'cache row requires user relation' } });
      } else if (row.score !== reputation.score) {
        const { error: updateError } = await db
          .from('reputation_cache')
          .update({ score: reputation.score, last_synced_at: new Date().toISOString() })
          .eq('wallet_address', reputation.wallet);
        if (updateError) throw new Error(`Failed to reconcile reputation: ${updateError.message}`);
        items.push({ type: 'stale_reputation', key: reputation.wallet, repaired: true, details: { score: reputation.score } });
      }
    }
  }
}
