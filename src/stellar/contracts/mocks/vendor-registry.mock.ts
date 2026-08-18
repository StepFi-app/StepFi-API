import { Injectable } from '@nestjs/common';
import type { VendorInfo } from '../interfaces/vendor-registry.interface';

@Injectable()
export class MockVendorRegistryContractClient {
  isVendorActive = jest.fn(
    async (_vendorId: string): Promise<boolean> => true,
  );

  getVendor = jest.fn(
    async (vendorId: string): Promise<VendorInfo | null> => ({
      id: vendorId,
      name: 'Mock Vendor',
      active: true,
    }),
  );

  buildApproveVendorXdr = jest.fn(
    async (_admin: string, _vendor: string): Promise<string> => 'AAAAAMockApproveVendorXDR',
  );

  buildSuspendVendorXdr = jest.fn(
    async (_admin: string, _vendor: string): Promise<string> => 'AAAAAMockSuspendVendorXDR',
  );
}

