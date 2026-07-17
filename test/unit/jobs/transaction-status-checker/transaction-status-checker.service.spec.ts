/**
 * Minimal spec for the reservation-release hook introduced in
 * TransactionStatusCheckerService for issue #81.
 *
 * The full chain is exercised by the existing transaction-status
 * spec; here we drive {@link TransactionStatusCheckerService.finalizeTransaction}
 * directly with stubbed Supabase / Horizon responses so the only
 * behaviour under test is "after a LOAN_CREATE finalises (success
 * OR failed), the matching reservation is released".
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { TransactionStatusCheckerService } from '../../../../src/jobs/transaction-status-checker/transaction-status-checker.service';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { LiquidityReservationService } from '../../../../src/modules/liquidity/reservations/liquidity-reservation.service';
import { TransactionType } from '../../../../src/modules/transactions/dto/submit-transaction-request.dto';

// Minimal stub for the PendingTransaction DB shape the service touches.
const baseTx = {
  id: 'tx-1',
  user_wallet: 'GUSR',
  transaction_hash: 'hash-1',
  type: TransactionType.LOAN_CREATE,
  status: 'pending' as const,
  xdr: 'AAAAAgAAAAC...',
  submitted_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

type TableMock = { [key: string]: jest.Mock | unknown };

function makeTxChainMock(): { update: jest.Mock; insert: jest.Mock } {
  // The service writes by chaining update(...).eq(col, val).eq(col, val).select(...).single()
  // so individual eq calls return further builders until single() resolves.
  const chain = {
    eq: jest.fn(),
    select: jest.fn(),
  };
  chain.eq.mockImplementation(() => chain);
  chain.select.mockImplementation(() => ({ single: jest.fn().mockResolvedValue({ data: baseTx, error: null }) }));
  return {
    update: jest.fn().mockReturnValue(chain),
    insert: jest.fn().mockResolvedValue({ error: null }),
  };
}

function makeLoansMock(): { select: jest.Mock; eq: jest.Mock; update: jest.Mock; single: jest.Mock } {
  const chain = { eq: jest.fn(), single: jest.fn() };
  chain.eq.mockReturnValue(chain);
  chain.single.mockResolvedValue({ data: { loan_id: 'pending-1', status: 'pending' }, error: null });
  return {
    select: jest.fn().mockReturnValue(chain),
    eq: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    single: jest.fn(),
  };
}

describe('TransactionStatusCheckerService \u2014 reservation lifecycle (#81)', () => {
  let service: TransactionStatusCheckerService;
  let mockReservationService: { releaseForLoan: jest.Mock; releaseReservation: jest.Mock };
  let supabaseHandler: {
    transactions: { update: jest.Mock; insert: jest.Mock };
    loans: { select: jest.Mock; eq: jest.Mock; update: jest.Mock; single: jest.Mock };
    notifications: { insert: jest.Mock };
  };
  let mockSupabaseService: { getServiceRoleClient: jest.Mock };

  beforeEach(async () => {
    mockReservationService = {
      releaseForLoan: jest.fn().mockResolvedValue(true),
      releaseReservation: jest.fn().mockResolvedValue(true),
    };

    supabaseHandler = {
      transactions: makeTxChainMock(),
      loans: makeLoansMock(),
      notifications: { insert: jest.fn().mockResolvedValue({ error: null }) },
    };

    mockSupabaseService = {
      getServiceRoleClient: jest.fn(() => ({
        from: (table: string) =>
          (supabaseHandler as unknown as Record<string, TableMock>)[table] ?? undefined,
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionStatusCheckerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => {
              if (key === 'STELLAR_HORIZON_URL') return 'http://horizon.test';
              if (key === 'STELLAR_NETWORK_PASSPHRASE') return StellarSdk.Networks.TESTNET;
              return fallback;
            }),
          },
        },
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: LiquidityReservationService, useValue: mockReservationService },
      ],
    }).compile();

    service = module.get<TransactionStatusCheckerService>(TransactionStatusCheckerService);
  });

  it('releases reservation when LOAN_CREATE transaction finalises successfully', async () => {
    // The fixture xdr is a placeholder string; in production parseTransactionMetadata
    // would resolve a real LoanID. Stub it here so the release path proceeds past
    // its `if (!metadata?.loanId) return;` guard.
    jest.spyOn(
      service as unknown as { parseTransactionMetadata: (x?: string | null) => { loanId?: string } | null },
      'parseTransactionMetadata',
    ).mockReturnValue({ loanId: 'pending-1' });

    await service['finalizeTransaction'](baseTx, 'success', { foo: 'bar' });
    expect(mockReservationService.releaseForLoan).toHaveBeenCalledWith('pending-1');
  });

  it('releases reservation when LOAN_CREATE transaction finalises as FAILED', async () => {
    jest.spyOn(
      service as unknown as { parseTransactionMetadata: (x?: string | null) => { loanId?: string } | null },
      'parseTransactionMetadata',
    ).mockReturnValue({ loanId: 'pending-1' });

    await service['finalizeTransaction'](baseTx, 'failed', { foo: 'bar' }, 'tx_bad_seq');
    expect(mockReservationService.releaseForLoan).toHaveBeenCalledWith('pending-1');
  });

  it('does NOT release reservation for a LOAN_REPAY transaction', async () => {
    const repayTx = { ...baseTx, type: TransactionType.LOAN_REPAY };
    await service['finalizeTransaction'](repayTx, 'success', { foo: 'bar' });
    expect(mockReservationService.releaseForLoan).not.toHaveBeenCalled();
  });

  it('does NOT crash the pipeline if release-reservation throws (TTL is the backstop)', async () => {
    jest.spyOn(
      service as unknown as { parseTransactionMetadata: (x?: string | null) => { loanId?: string } | null },
      'parseTransactionMetadata',
    ).mockReturnValue({ loanId: 'pending-1' });
    mockReservationService.releaseForLoan.mockRejectedValueOnce(new Error('redis down'));

    await expect(
      service['finalizeTransaction'](baseTx, 'success', { foo: 'bar' }),
    ).resolves.not.toThrow();
  });

  it('emits the notification AFTER the reservation has been released', async () => {
    jest.spyOn(
      service as unknown as { parseTransactionMetadata: (x?: string | null) => { loanId?: string } | null },
      'parseTransactionMetadata',
    ).mockReturnValue({ loanId: 'pending-1' });

    const callOrder: string[] = [];
    mockReservationService.releaseForLoan.mockImplementation(async () => {
      callOrder.push('release');
      return true;
    });
    supabaseHandler.notifications.insert.mockImplementation(async () => {
      callOrder.push('notification');
      return { error: null };
    });

    await service['finalizeTransaction'](baseTx, 'success', { foo: 'bar' });

    expect(callOrder).toEqual(['release', 'notification']);
  });
});
