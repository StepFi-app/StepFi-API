import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, ForbiddenException, UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VendorsService } from './vendors.service';
import { VendorsController } from './vendors.controller';
import { SupabaseService } from '../../database/supabase.client';
import { VendorRegistryContractClient } from '../../stellar/contracts/clients/vendor-registry.client';
import { VendorType, VendorStatus } from './dto/vendor.dto';
import { AdminGuard } from '../../common/guards/admin.guard';

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

  const suspendedVendorRow = {
    ...pendingVendorRow,
    status: VendorStatus.SUSPENDED,
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
      ],
    }).compile();

    service = module.get<VendorsService>(VendorsService);
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
      // Database write must NOT be triggered on XDR build
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
      // Database write must NOT be triggered on XDR build
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
    });
  });
});
