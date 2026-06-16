export const VENDOR_REGISTRY_CONTRACT_ID_KEY = 'VENDOR_REGISTRY_CONTRACT_ID';

export interface VendorInfo {
  id: string;
  name: string;
  active: boolean;
}

export interface IVendorRegistryClient {
  isVendorActive(vendorId: string): Promise<boolean>;

  getVendor(vendorId: string): Promise<VendorInfo | null>;
}
