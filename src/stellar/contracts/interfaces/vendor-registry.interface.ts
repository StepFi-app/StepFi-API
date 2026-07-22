export const VENDOR_REGISTRY_CONTRACT_ID_KEY = 'VENDOR_REGISTRY_CONTRACT_ID';

export type VendorStatus = 'Pending' | 'Approved' | 'Suspended' | 'Rejected';

export interface VendorInfo {
  id: string;
  name: string;
  status: VendorStatus;
}

export interface IVendorRegistryClient {
  isVendorActive(vendorId: string): Promise<boolean>;

  getVendor(vendorId: string): Promise<VendorInfo | null>;
}
