import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { TransactionStatusCheckerService } from '../../../../src/jobs/transaction-status-checker/transaction-status-checker.service';

function chain(result: unknown) {
  const query: Record<string, unknown> = {};
  for (const method of ['update', 'eq', 'select', 'maybeSingle']) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  (query as { then: unknown }).then = (resolve: (value: unknown) => unknown) => resolve(result);
  return query;
}

describe('TransactionStatusCheckerService vendor follow-up', () => {
  const from = jest.fn();
  const supabaseService = {
    getServiceRoleClient: jest.fn(() => ({ from })),
  };
  const service = new TransactionStatusCheckerService(
    new ConfigService(),
    supabaseService as unknown as SupabaseService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('mirrors approved status only from the confirmation follow-up', async () => {
    const query = chain({ data: { id: 'vendor-1' }, error: null });
    from.mockReturnValue(query);

    const result = await (
      service as unknown as {
        applyVendorStatus(wallet: string, status: 'approved'): Promise<unknown>;
      }
    ).applyVendorStatus('GVENDOR', 'approved');

    expect(from).toHaveBeenCalledWith('vendors');
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', verified: true }),
    );
    expect(query.eq).toHaveBeenCalledWith('status', 'pending');
    expect(result).toEqual({ vendorWallet: 'GVENDOR', vendorStatus: 'approved' });
  });

  it('requires approved local state before mirroring suspension', async () => {
    const query = chain({ data: { id: 'vendor-1' }, error: null });
    from.mockReturnValue(query);

    await (
      service as unknown as {
        applyVendorStatus(wallet: string, status: 'suspended'): Promise<unknown>;
      }
    ).applyVendorStatus('GVENDOR', 'suspended');

    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'suspended', verified: false }),
    );
    expect(query.eq).toHaveBeenCalledWith('status', 'approved');
  });
});
