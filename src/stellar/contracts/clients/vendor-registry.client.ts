import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SorobanService } from '../../../blockchain/soroban/soroban.service';
import { VendorInfo, VENDOR_REGISTRY_CONTRACT_ID_KEY } from '../interfaces/vendor-registry.interface';
import { ContractNotConfiguredError, ContractReadError, ContractTxBuildError } from '../errors';

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

    const vendorIdArg = this.addressArg(vendorId);

    try {
      const result = await this.sorobanService.simulateContractCall(
        this.contractId,
        'is_active',
        [vendorIdArg],
      );
      return Boolean(StellarSdk.scValToNative(result));
    } catch (error) {
      this.logger.error(`Failed to check vendor active status for ${vendorId}: ${error.message}`);
      throw new ContractReadError('vendor active status');
    }
  }

  async getVendor(vendorId: string): Promise<VendorInfo | null> {
    if (!this.contractId) {
      throw new ContractNotConfiguredError('Vendor registry contract');
    }

    const vendorIdArg = this.addressArg(vendorId);

    try {
      const result = await this.sorobanService.simulateContractCall(
        this.contractId,
        'get_vendor_info',
        [vendorIdArg],
      );
      const raw = StellarSdk.scValToNative(result) as Record<string, unknown>;

      if (!raw) {
        return null;
      }

      return {
        id: vendorId,
        name: String(raw['name'] ?? ''),
        active:
          String(raw['status'] ?? '').toLowerCase().includes('approved') ||
          Boolean(raw['active'] ?? raw['is_active'] ?? false),
      };
    } catch (error) {
      if (
        error.message?.includes('HostError') ||
        error.message?.includes('Status(ContractError')
      ) {
        this.logger.debug(`No vendor found for ${vendorId}`);
        return null;
      }
      this.logger.error(`Failed to get vendor ${vendorId}: ${error.message}`);
      throw new ContractReadError('vendor info');
    }
  }

  buildApproveVendorXdr(admin: string, vendor: string): Promise<string> {
    return this.buildStatusTransaction('approve_vendor', admin, vendor);
  }

  buildSuspendVendorXdr(admin: string, vendor: string): Promise<string> {
    return this.buildStatusTransaction('suspend_vendor', admin, vendor);
  }

  private async buildStatusTransaction(
    method: 'approve_vendor' | 'suspend_vendor',
    admin: string,
    vendor: string,
  ): Promise<string> {
    if (!this.contractId) {
      throw new ContractNotConfiguredError('Vendor registry contract');
    }

    try {
      const server = this.sorobanService.getServer();
      const sourceAccount = await server.getAccount(admin);
      const contract = new StellarSdk.Contract(this.contractId);
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.sorobanService.getNetworkPassphrase(),
      })
        .addOperation(contract.call(method, this.addressArg(admin), this.addressArg(vendor)))
        .setTimeout(300)
        .build();

      const prepared = await server.prepareTransaction(transaction);
      return prepared.toXDR();
    } catch (error) {
      if (error instanceof ContractNotConfiguredError) throw error;
      this.logger.error(`Failed to build ${method} transaction: ${error.message}`);
      throw new ContractTxBuildError(method);
    }
  }

  private addressArg(address: string): StellarSdk.xdr.ScVal {
    return StellarSdk.nativeToScVal(StellarSdk.Address.fromString(address), { type: 'address' });
  }
}
