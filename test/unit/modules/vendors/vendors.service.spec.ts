import { Test, TestingModule } from '@nestjs/testing';
<<<<<<< Updated upstream
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VendorsService } from '../../../../src/modules/vendors/vendors.service';
import { VendorsRepository } from '../../../../src/database/repositories/vendors.repository';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { VendorType } from '../../../../src/modules/vendors/dto/vendor.dto';

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
  const vendorRecord = { id: 'vendor-1', wallet_address: wallet, name: 'Acme', type: 'school', verified: true };

  const vendorRow = {
    id: 'vendor-1',
    wallet_address: wallet,
    name: 'Acme University',
    type: 'school',
    verified: false,
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
  const mockVendorsRepository = { findByWallet: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VendorsService,
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: VendorsRepository, useValue: mockVendorsRepository },
=======
import { ConflictException, NotFoundException, ForbiddenException, UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VendorsService } from '../../../../src/modules/vendors/vendors.service';
import { VendorsController } from '../../../../src/modules/vendors/vendors.controller';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { VendorRegistryContractClient } from '../../../../src/stellar/contracts/clients/vendor-registry.client';
import { VendorType, VendorStatus } from '../../../../src/modules/vendors/dto/vendor.dto';
import { AdminGuard } from '../../../../src/common/guards/admin.guard';

describe('VendorsModule', () => {
  let service: VendorsService;
  let controller: VendorsController;
  let mockSupabaseService: any;
  let mockVendorRegistryClient: any;
  let mockConfigService: any;
  let adminGuard: AdminGuard;

  const mockAdminWallet = 'GA3D5342W...ADMIN_WALLET_ADDRESS';
  const mockUserWallet = 'GB7B2342W...REGULAR_USER_ADDRESS';
  const mockVendorId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  const pendingVendorRow = {
    id: mockVendorId,
    wallet_address: 'GAVENDOR1234567890',
    name: 'Tech Academy',
    type: VendorType.BOOTCAMP,
    status: VendorStatus.PENDING,
    verified: false,
    website: 'https://techacademy.com',
    country: 'Nigeria',
    city: 'Lagos',
    created_at: '2026-08-17T00:00:00Z',
  };

  const approvedVendorRow = {
    ...pendingVendorRow,
    status: VendorStatus.APPROVED,
    verified: true,
  };

  beforeEach(async () => {
    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn(),
      update: jest.fn().mockReturnThis(),
    };

    mockSupabaseService = {
      getClient: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue(mockQueryBuilder),
      }),
      getServiceRoleClient: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue(mockQueryBuilder),
      }),
      _queryBuilder: mockQueryBuilder,
    };

    mockVendorRegistryClient = {
      isVendorActive: jest.fn().mockResolvedValue(true),
      getVendor: jest.fn().mockResolvedValue({ id: mockVendorId, name: 'Tech Academy', active: true }),
      buildApproveVendorXdr: jest.fn().mockResolvedValue('AAAA_MOCK_APPROVE_VENDOR_XDR'),
      buildSuspendVendorXdr: jest.fn().mockResolvedValue('AAAA_MOCK_SUSPEND_VENDOR_XDR'),
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'ADMIN_WALLETS') {
          return `${mockAdminWallet},GADMIN222222222`;
        }
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VendorsController],
      providers: [
        VendorsService,
        AdminGuard,
        { provide: SupabaseService, useValue: mockSupabaseService },
        { provide: VendorRegistryContractClient, useValue: mockVendorRegistryClient },
        { provide: ConfigService, useValue: mockConfigService },
>>>>>>> Stashed changes
      ],
    }).compile();

    service = module.get<VendorsService>(VendorsService);
<<<<<<< Updated upstream
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
    });

    it('throws ConflictException when the wallet is already a vendor', async () => {
      mockVendorsRepository.findByWallet.mockResolvedValue(vendorRecord);

      await expect(
        service.registerVendor(wallet, { name: 'Acme', category: VendorType.SCHOOL, country: 'Nigeria' }),
      ).rejects.toThrow(ConflictException);
      expect(mockSupabaseClient.from).not.toHaveBeenCalled();
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
=======
    controller = module.get<VendorsController>(VendorsController);
    adminGuard = module.get<AdminGuard>(AdminGuard);
  });

  describe('VendorsService.getAll', () => {
    it('should return all vendors mapped with status', async () => {
      const qb = mockSupabaseService._queryBuilder;
      qb.order.mockResolvedValueOnce({ data: [pendingVendorRow, approvedVendorRow], error: null });

      const result = await service.getAll();

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe(VendorStatus.PENDING);
      expect(result[1].status).toBe(VendorStatus.APPROVED);
    });

    it('should filter vendors by type when provided', async () => {
      const qb = mockSupabaseService._queryBuilder;
      qb.order.mockResolvedValueOnce({ data: [pendingVendorRow], error: null });

      const result = await service.getAll(VendorType.BOOTCAMP);

      expect(qb.eq).toHaveBeenCalledWith('type', VendorType.BOOTCAMP);
      expect(result).toHaveLength(1);
    });
  });

  describe('VendorsService.getById', () => {
    it('should return single vendor by id', async () => {
      const qb = mockSupabaseService._queryBuilder;
      qb.single.mockResolvedValueOnce({ data: pendingVendorRow, error: null });

      const result = await service.getById(mockVendorId);

      expect(result.id).toBe(mockVendorId);
      expect(result.status).toBe(VendorStatus.PENDING);
    });

    it('should throw NotFoundException if vendor does not exist', async () => {
      const qb = mockSupabaseService._queryBuilder;
      qb.single.mockResolvedValueOnce({ data: null, error: { message: 'Not found' } });

      await expect(service.getById('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('VendorsService.approveVendor', () => {
    it('should return unsigned XDR for vendor in pending status', async () => {
      const qb = mockSupabaseService._queryBuilder;
      qb.single.mockResolvedValueOnce({ data: pendingVendorRow, error: null });

      const result = await service.approveVendor(mockAdminWallet, mockVendorId);

      expect(result.unsignedXdr).toBe('AAAA_MOCK_APPROVE_VENDOR_XDR');
      expect(result.vendorId).toBe(mockVendorId);
      expect(result.status).toBe(VendorStatus.PENDING);
      expect(mockVendorRegistryClient.buildApproveVendorXdr).toHaveBeenCalledWith(mockAdminWallet, mockVendorId);
      expect(qb.update).not.toHaveBeenCalled();
    });

    it('should throw ConflictException (409) if vendor is not pending', async () => {
      const qb = mockSupabaseService._queryBuilder;
      qb.single.mockResolvedValueOnce({ data: approvedVendorRow, error: null });

      await expect(service.approveVendor(mockAdminWallet, mockVendorId)).rejects.toThrow(ConflictException);
      expect(mockVendorRegistryClient.buildApproveVendorXdr).not.toHaveBeenCalled();
    });
  });

  describe('VendorsService.suspendVendor', () => {
    it('should return unsigned XDR for vendor in approved status', async () => {
      const qb = mockSupabaseService._queryBuilder;
      qb.single.mockResolvedValueOnce({ data: approvedVendorRow, error: null });

      const result = await service.suspendVendor(mockAdminWallet, mockVendorId);

      expect(result.unsignedXdr).toBe('AAAA_MOCK_SUSPEND_VENDOR_XDR');
      expect(result.vendorId).toBe(mockVendorId);
      expect(result.status).toBe(VendorStatus.APPROVED);
      expect(mockVendorRegistryClient.buildSuspendVendorXdr).toHaveBeenCalledWith(mockAdminWallet, mockVendorId);
      expect(qb.update).not.toHaveBeenCalled();
    });

    it('should throw ConflictException (409) if vendor is not approved', async () => {
      const qb = mockSupabaseService._queryBuilder;
      qb.single.mockResolvedValueOnce({ data: pendingVendorRow, error: null });

      await expect(service.suspendVendor(mockAdminWallet, mockVendorId)).rejects.toThrow(ConflictException);
      expect(mockVendorRegistryClient.buildSuspendVendorXdr).not.toHaveBeenCalled();
    });
  });

  describe('VendorsController', () => {
    it('should delegate approveVendor to service', async () => {
      const qb = mockSupabaseService._queryBuilder;
      qb.single.mockResolvedValueOnce({ data: pendingVendorRow, error: null });

      const response = await controller.approveVendor({ wallet: mockAdminWallet }, mockVendorId);

      expect(response.success).toBe(true);
      expect(response.data.unsignedXdr).toBe('AAAA_MOCK_APPROVE_VENDOR_XDR');
    });

    it('should delegate suspendVendor to service', async () => {
      const qb = mockSupabaseService._queryBuilder;
      qb.single.mockResolvedValueOnce({ data: approvedVendorRow, error: null });

      const response = await controller.suspendVendor({ wallet: mockAdminWallet }, mockVendorId);

      expect(response.success).toBe(true);
      expect(response.data.unsignedXdr).toBe('AAAA_MOCK_SUSPEND_VENDOR_XDR');
    });
  });

  describe('AdminGuard', () => {
    const createMockContext = (user?: any): ExecutionContext => {
      return {
        switchToHttp: () => ({
          getRequest: () => ({ user }),
        }),
      } as any;
    };

    it('should allow execution for an allowlisted admin wallet', () => {
      const ctx = createMockContext({ wallet: mockAdminWallet });
      expect(adminGuard.canActivate(ctx)).toBe(true);
    });

    it('should throw ForbiddenException (403) for a non-admin wallet', () => {
      const ctx = createMockContext({ wallet: mockUserWallet });
      expect(() => adminGuard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should throw UnauthorizedException (401) when user is unauthenticated', () => {
      const ctx = createMockContext(undefined);
      expect(() => adminGuard.canActivate(ctx)).toThrow(UnauthorizedException);
>>>>>>> Stashed changes
    });
  });
});
