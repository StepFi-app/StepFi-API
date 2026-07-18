import { StateReconciliationProcessor } from '../../../../src/jobs/state-reconciliation/state-reconciliation.processor';
import { AuthoritativeState } from '../../../../src/indexer/authoritative-state.reader';

const emptyState: AuthoritativeState = {
  loans: [],
  liquidityPositions: [],
  reputations: [],
  transactionHashes: [],
};

function createSupabaseMock(
  liquidity: Array<{ id: string; provider_wallet: string; deposited_amount: number }> = [],
  reputation: Array<{ wallet_address: string; score: number }> = [],
) {
  const eq = jest.fn().mockResolvedValue({ error: null });
  const update = jest.fn().mockReturnValue({ eq });
  const insert = jest.fn().mockResolvedValue({ error: null });
  return {
    client: {
      from: jest.fn((table: string) => ({
        select: jest.fn().mockResolvedValue({
          data: table === 'liquidity_positions' ? liquidity : reputation,
          error: null,
        }),
        update,
        insert,
      })),
    },
    update,
    insert,
  };
}

function createProcessor(state: AuthoritativeState, options: {
  loans?: Array<{ id: string; loanId: string; userWallet: string; amount: number; status: string }>;
  transactions?: Array<{ id: string; hash: string; status: string; submittedAt: string }>;
  liquidity?: Array<{ id: string; provider_wallet: string; deposited_amount: number }>;
  reputation?: Array<{ wallet_address: string; score: number }>;
} = {}) {
  const supabase = createSupabaseMock(options.liquidity, options.reputation);
  const loansRepository = {
    findForReconciliation: jest.fn().mockResolvedValue(options.loans ?? []),
    resolveProvisionalId: jest.fn().mockResolvedValue(undefined),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  };
  const transactionsRepository = {
    findForReconciliation: jest.fn().mockResolvedValue(options.transactions ?? []),
    markSucceeded: jest.fn().mockResolvedValue(undefined),
    markOrphaned: jest.fn().mockResolvedValue(undefined),
    backfill: jest.fn().mockResolvedValue(undefined),
  };
  const metrics = { setReconciliationDrift: jest.fn() };
  const processor = new StateReconciliationProcessor(
    { read: jest.fn().mockResolvedValue(state) } as never,
    loansRepository as never,
    transactionsRepository as never,
    { getServiceRoleClient: () => supabase.client } as never,
    metrics as never,
  );
  return { processor, loansRepository, transactionsRepository, metrics, supabase };
}

describe('StateReconciliationProcessor', () => {
  it('classifies and repairs provisional IDs and stale loan status, and reports missing rows', async () => {
    const state: AuthoritativeState = {
      ...emptyState,
      loans: [
        { loanId: 'chain-1', userWallet: 'GA', status: 'active', principalAmount: 100, transactionHash: null },
        { loanId: 'chain-2', userWallet: 'GB', status: 'paid', principalAmount: 200, transactionHash: null },
        { loanId: 'chain-3', userWallet: 'GC', status: 'active', principalAmount: 300, transactionHash: null },
      ],
    };
    const context = createProcessor(state, {
      loans: [
        { id: '1', loanId: 'loan_provisional', userWallet: 'GA', amount: 100, status: 'pending' },
        { id: '2', loanId: 'chain-2', userWallet: 'GB', amount: 200, status: 'active' },
      ],
    });

    const report = await context.processor.reconcile();

    expect(context.loansRepository.resolveProvisionalId).toHaveBeenCalledTimes(1);
    expect(context.loansRepository.updateStatus).toHaveBeenCalledWith('2', 'paid');
    expect(report.byType.provisional_loan_id).toBe(1);
    expect(report.byType.stale_loan_status).toBe(1);
    expect(report.byType.missing_loan_row).toBe(1);
  });

  it('backfills missed events and resolves successful and orphaned pending transactions', async () => {
    const state: AuthoritativeState = { ...emptyState, transactionHashes: ['known', 'missing'] };
    const context = createProcessor(state, {
      transactions: [
        { id: '1', hash: 'known', status: 'pending', submittedAt: new Date().toISOString() },
        { id: '2', hash: 'orphan', status: 'pending', submittedAt: '2020-01-01T00:00:00.000Z' },
      ],
    });

    const report = await context.processor.reconcile();

    expect(context.transactionsRepository.markSucceeded).toHaveBeenCalledWith('1');
    expect(context.transactionsRepository.backfill).toHaveBeenCalledWith('missing');
    expect(context.transactionsRepository.markOrphaned).toHaveBeenCalledWith('2');
    expect(report.byType.missing_transaction_row).toBe(1);
    expect(report.byType.orphaned_pending_transaction).toBe(2);
  });

  it('repairs stale liquidity and reputation projections and exports drift gauges', async () => {
    const state: AuthoritativeState = {
      ...emptyState,
      liquidityPositions: [{ userWallet: 'GA', amount: 50 }],
      reputations: [{ wallet: 'GA', score: 700 }],
    };
    const context = createProcessor(state, {
      liquidity: [{ id: 'lp-1', provider_wallet: 'GA', deposited_amount: 10 }],
      reputation: [{ wallet_address: 'GA', score: 600 }],
    });

    const report = await context.processor.reconcile();

    expect(report.byType.stale_liquidity_position).toBe(1);
    expect(report.byType.stale_reputation).toBe(1);
    expect(context.supabase.update).toHaveBeenCalledTimes(2);
    expect(context.metrics.setReconciliationDrift).toHaveBeenCalledWith('stale_reputation', 1);
  });

  it('is idempotent when indexed state and database projections agree', async () => {
    const context = createProcessor(emptyState);
    const report = await context.processor.reconcile();
    expect(report.driftCount).toBe(0);
    expect(report.repairedCount).toBe(0);
  });
});
