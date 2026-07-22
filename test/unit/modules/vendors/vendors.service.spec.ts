import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VendorsService } from '../../../../src/modules/vendors/vendors.service';
import { VendorsRepository } from '../../../../src/database/repositories/vendors.repository';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { VendorType } from '../../../../src/modules/vendors/dto/vendor.dto';
import { VendorRegistryContractClient } from '../../../../src/stellar/contracts/clients/vendor-registry.client';

/**
 * Builds a Supabase query-builder mock whose every chainable method returns the
 * same object, and which resolves (thenable) to `result` when awaited — so any
 * terminal call (.eq / .single / .maybeSingle / .range / .in) yields `result`.
 */
function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'range', 'maybeSingle', 'single']) {
    c[m] = jest.fn().mockReturnValue(c);
  }
  (c as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(result);
  return c;
}

describe('VendorsService', () => {
  let service: VendorsService;

  const wallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
  const vendorRecord = { id: 'vendor-1', wallet_address: wallet, name: 'Acme', type: 'school', verified: false, status: 'pending' };

  const vendorRow = {
    id: 'vendor-1',
    wallet_address: wallet,
    name: 'Acme University',
    type: 'school',
    verified: false,
    status: 'pending',
    website: 'https://acme.edu',
    country: 'Nigeria',
    city: 'Lagos',
    description: 'STEM programs',
    created_at: '2026-07-17T00:00:00.000Z',
  };

  const mockSupabaseClient = { from: jest.fn() };
  const mockSupabaseService = {
    getClient: jest.fn(),
    getServiceRoleClient: jest.fn(),
  };
  const mockVendorsRepository = { findByWallet: jest.fn(), findById: jest.fn() };
  const mockVendorRegistryClient = {
    buildApproveVendorXdr: jest.fn(),
    buildSuspendVendorXdr: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VendorsService,
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: VendorsRepository, useValue: mockVendorsRepository },
        { provide: VendorRegistryContractClient, useValue: mockVendorRegistryClient },
      ],
    }).compile();

    service = module.get<VendorsService>(VendorsService);
    jest.clearAllMocks();
    mockSupabaseService.getClient.mockReturnValue(mockSupabaseClient);
    mockSupabaseService.getServiceRoleClient.mockReturnValue(mockSupabaseClient);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('registerVendor', () => {
    it('registers a new vendor and maps the response', async () => {
      mockVendorsRepository.findByWallet.mockResolvedValue(null);
      mockSupabaseClient.from.mockReturnValueOnce(chain({ data: vendorRow, error: null }));

      const result = await service.registerVendor(wallet, {
        name: 'Acme University',
        category: VendorType.SCHOOL,
        country: 'Nigeria',
        city: 'Lagos',
        website: 'https://acme.edu',
        description: 'STEM programs',
      });

      expect(result.id).toBe('vendor-1');
      expect(result.type).toBe(VendorType.SCHOOL);
      expect(result.description).toBe('STEM programs');
      expect(result.walletAddress).toBe(wallet);
      expect(result.status).toBe('pending');
    });

    it('throws ConflictException when the wallet is already a vendor', async () => {
      mockVendorsRepository.findByWallet.mockResolvedValue(vendorRecord);

      await expect(
        service.registerVendor(wallet, { name: 'Acme', category: VendorType.SCHOOL, country: 'Nigeria' }),
      ).rejects.toThrow(ConflictException);
      expect(mockSupabaseClient.from).not.toHaveBeenCalled();
    });
  });

  describe('vendor approval lifecycle', () => {
    it('builds approval XDR without updating local status', async () => {
      mockVendorsRepository.findById.mockResolvedValue(vendorRecord);
      mockVendorRegistryClient.buildApproveVendorXdr.mockResolvedValue('approve-xdr');

      const result = await service.buildApproveVendorXdr('GADMIN', 'vendor-1');

      expect(result).toMatchObject({
        unsignedXdr: 'approve-xdr',
        vendorId: 'vendor-1',
        targetStatus: 'approved',
      });
      expect(mockVendorRegistryClient.buildApproveVendorXdr).toHaveBeenCalledWith(
        'GADMIN',
        wallet,
      );
      expect(mockSupabaseService.getServiceRoleClient).not.toHaveBeenCalled();
    });

    it('rejects approval when the vendor is not pending', async () => {
      mockVendorsRepository.findById.mockResolvedValue({
        ...vendorRecord,
        status: 'approved',
      });

      await expect(service.buildApproveVendorXdr('GADMIN', 'vendor-1')).rejects.toThrow(
        ConflictException,
      );
      expect(mockVendorRegistryClient.buildApproveVendorXdr).not.toHaveBeenCalled();
    });

    it('builds suspension XDR only for an approved vendor', async () => {
      mockVendorsRepository.findById.mockResolvedValue({
        ...vendorRecord,
        status: 'approved',
      });
      mockVendorRegistryClient.buildSuspendVendorXdr.mockResolvedValue('suspend-xdr');

      const result = await service.buildSuspendVendorXdr('GADMIN', 'vendor-1');

      expect(result.targetStatus).toBe('suspended');
      expect(mockVendorRegistryClient.buildSuspendVendorXdr).toHaveBeenCalledWith(
        'GADMIN',
        wallet,
      );
    });
  });

  describe('getDashboard', () => {
    it('computes totals, active borrowers and default rate', async () => {
      mockVendorsRepository.findByWallet.mockResolvedValue(vendorRecord);
      const loans = [
        { loan_id: 'L1', user_wallet: 'W1', status: 'active' },
        { loan_id: 'L2', user_wallet: 'W2', status: 'active' },
        { loan_id: 'L3', user_wallet: 'W1', status: 'defaulted' },
        { loan_id: 'L4', user_wallet: 'W3', status: 'completed' },
      ];
      mockSupabaseClient.from
        .mockReturnValueOnce(chain({ data: loans, error: null }))
        .mockReturnValueOnce(chain({ data: [{ amount: 100 }, { amount: '50' }], error: null }));

      const result = await service.getDashboard(wallet);

      expect(result).toEqual({
        totalLoansFunded: 4,
        totalReceived: 150,
        activeBorrowers: 2,
        defaultRate: 25,
      });
    });

    it('throws NotFoundException when no vendor exists for the wallet', async () => {
      mockVendorsRepository.findByWallet.mockResolvedValue(null);
      await expect(service.getDashboard(wallet)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getLoans', () => {
    it('returns a paginated page of the vendor loans', async () => {
      mockVendorsRepository.findByWallet.mockResolvedValue(vendorRecord);
      const loanRow = {
        id: 'loan-1',
        loan_id: 'L1',
        user_wallet: 'W1',
        amount: 500,
        loan_amount: 450,
        remaining_balance: 200,
        status: 'active',
        next_payment_due: '2026-08-01T00:00:00.000Z',
        created_at: '2026-07-01T00:00:00.000Z',
      };
      mockSupabaseClient.from.mockReturnValueOnce(chain({ data: [loanRow], count: 1, error: null }));

      const result = await service.getLoans(wallet, 1, 10);

      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.items[0]).toMatchObject({
        id: 'loan-1',
        loanId: 'L1',
        borrowerWallet: 'W1',
        amount: 500,
        remainingBalance: 200,
        status: 'active',
      });
    });
  });

  describe('getPayments', () => {
    it('returns an empty page when the vendor has no loans', async () => {
      mockVendorsRepository.findByWallet.mockResolvedValue(vendorRecord);
      mockSupabaseClient.from.mockReturnValueOnce(chain({ data: [], error: null }));

      const result = await service.getPayments(wallet, 1, 10);

      expect(result).toEqual({ items: [], total: 0, page: 1, limit: 10, totalPages: 0 });
      expect(mockSupabaseClient.from).toHaveBeenCalledTimes(1);
    });

    it('returns payment records for the vendor loans', async () => {
      mockVendorsRepository.findByWallet.mockResolvedValue(vendorRecord);
      const payment = { id: 'p1', loan_id: 'L1', amount: 50, tx_hash: 'tx-abc', paid_at: '2026-07-10T00:00:00.000Z' };
      mockSupabaseClient.from
        .mockReturnValueOnce(chain({ data: [{ loan_id: 'L1' }], error: null }))
        .mockReturnValueOnce(chain({ data: [payment], count: 1, error: null }));

      const result = await service.getPayments(wallet, 1, 10);

      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({ id: 'p1', loanId: 'L1', amount: 50, txHash: 'tx-abc' });
    });
  });

  describe('products', () => {
    const productRow = {
      id: 'prod-1',
      vendor_id: 'vendor-1',
      name: 'Course',
      price: 199.99,
      category: 'course',
      description: 'desc',
      created_at: '2026-07-17T00:00:00.000Z',
      updated_at: '2026-07-17T00:00:00.000Z',
    };

    it('lists the vendor products', async () => {
      mockVendorsRepository.findByWallet.mockResolvedValue(vendorRecord);
      mockSupabaseClient.from.mockReturnValueOnce(chain({ data: [productRow], error: null }));

      const result = await service.getProducts(wallet);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: 'prod-1', vendorId: 'vendor-1', name: 'Course', price: 199.99 });
    });

    it('creates a product for the vendor', async () => {
      mockVendorsRepository.findByWallet.mockResolvedValue(vendorRecord);
      mockSupabaseClient.from.mockReturnValueOnce(chain({ data: productRow, error: null }));

      const result = await service.createProduct(wallet, { name: 'Course', price: 199.99, category: 'course' });

      expect(result).toMatchObject({ id: 'prod-1', name: 'Course', price: 199.99 });
    });

    it('rejects updating a product owned by another vendor', async () => {
      mockVendorsRepository.findByWallet.mockResolvedValue(vendorRecord);
      mockSupabaseClient.from.mockReturnValueOnce(chain({ data: { vendor_id: 'other-vendor' }, error: null }));

      await expect(
        service.updateProduct(wallet, 'prod-1', { price: 10 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('updates an owned product', async () => {
      mockVendorsRepository.findByWallet.mockResolvedValue(vendorRecord);
      mockSupabaseClient.from
        .mockReturnValueOnce(chain({ data: { vendor_id: 'vendor-1' }, error: null }))
        .mockReturnValueOnce(chain({ data: { ...productRow, price: 149.99 }, error: null }));

      const result = await service.updateProduct(wallet, 'prod-1', { price: 149.99 });

      expect(result.price).toBe(149.99);
    });

    it('throws NotFoundException when deleting a missing product', async () => {
      mockVendorsRepository.findByWallet.mockResolvedValue(vendorRecord);
      mockSupabaseClient.from.mockReturnValueOnce(chain({ data: null, error: null }));

      await expect(service.deleteProduct(wallet, 'prod-x')).rejects.toThrow(NotFoundException);
    });

    it('deletes an owned product', async () => {
      mockVendorsRepository.findByWallet.mockResolvedValue(vendorRecord);
      mockSupabaseClient.from
        .mockReturnValueOnce(chain({ data: { vendor_id: 'vendor-1' }, error: null }))
        .mockReturnValueOnce(chain({ error: null }));

      await expect(service.deleteProduct(wallet, 'prod-1')).resolves.toBeUndefined();
    });
  });
});
