import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SorobanService } from '../../../blockchain/soroban/soroban.service';
import {
  VendorInfo,
  VendorStatus,
  VENDOR_REGISTRY_CONTRACT_ID_KEY,
} from '../interfaces/vendor-registry.interface';
import { ContractNotConfiguredError, ContractReadError } from '../errors';

const VENDOR_STATUSES: readonly VendorStatus[] = [
  'Pending',
  'Approved',
  'Suspended',
  'Rejected',
];

@Injectable()
export class VendorRegistryContractClient {
  private readonly logger = new Logger(VendorRegistryContractClient.name);
  private readonly contractId: string;

  constructor(
    private readonly sorobanService: SorobanService,
    private readonly configService: ConfigService,
  ) {
    this.contractId = this.configService.get<string>(VENDOR_REGISTRY_CONTRACT_ID_KEY) || '';

    if (this.contractId) {
      this.logger.log(`VendorRegistry contract loaded: ${this.contractId.slice(0, 8)}...`);
    } else {
      this.logger.warn(`${VENDOR_REGISTRY_CONTRACT_ID_KEY} is not set - contract calls will fail`);
    }
  }

  async isVendorActive(vendorId: string): Promise<boolean> {
    if (!this.contractId) {
      throw new ContractNotConfiguredError('Vendor registry contract');
    }

    const vendorAddressArg = this.toAddressScVal(vendorId);

    try {
      const result = await this.sorobanService.simulateContractCall(
        this.contractId,
        'is_active',
        [vendorAddressArg],
      );
      return Boolean(StellarSdk.scValToNative(result));
    } catch (error) {
      this.logger.error(
        `Failed to check vendor active status for ${vendorId}: ${this.getErrorMessage(error)}`,
      );
      throw new ContractReadError('vendor active status');
    }
  }

  async getVendor(vendorId: string): Promise<VendorInfo | null> {
    if (!this.contractId) {
      throw new ContractNotConfiguredError('Vendor registry contract');
    }

    const vendorAddressArg = this.toAddressScVal(vendorId);

    try {
      const result = await this.sorobanService.simulateContractCall(
        this.contractId,
        'get_vendor_info',
        [vendorAddressArg],
      );
      const raw = StellarSdk.scValToNative(result) as Record<string, unknown>;

      if (!raw) {
        return null;
      }

      return {
        id: String(raw['id'] ?? raw['vendor_id'] ?? vendorId),
        name: String(raw['name'] ?? ''),
        status: this.parseVendorStatus(raw['status']),
      };
    } catch (error) {
      if (this.isVendorNotFoundError(error)) {
        this.logger.debug(`No vendor found for ${vendorId}`);
        return null;
      }
      this.logger.error(`Failed to get vendor ${vendorId}: ${this.getErrorMessage(error)}`);
      throw new ContractReadError('vendor info');
    }
  }

  private toAddressScVal(vendorId: string): StellarSdk.xdr.ScVal {
    return StellarSdk.nativeToScVal(StellarSdk.Address.fromString(vendorId), {
      type: 'address',
    });
  }

  private parseVendorStatus(rawStatus: unknown): VendorStatus {
    const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;

    if (typeof status === 'string' && VENDOR_STATUSES.includes(status as VendorStatus)) {
      return status as VendorStatus;
    }

    throw new Error(`Unknown vendor status: ${String(status)}`);
  }

  private isVendorNotFoundError(error: unknown): boolean {
    const message = this.getErrorMessage(error);

    return (
      message.includes('VendorNotFound') ||
      /Error\(Contract,\s*#?4\)|ContractError\(4\)|Status\(ContractError\(4\)\)/.test(
        message,
      )
    );
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
