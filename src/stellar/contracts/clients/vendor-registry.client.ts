import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SorobanService } from '../../../blockchain/soroban/soroban.service';
import { VendorInfo, VENDOR_REGISTRY_CONTRACT_ID_KEY, IVendorRegistryClient } from '../interfaces/vendor-registry.interface';
import {
  ContractNotConfiguredError,
  ContractReadError,
  ContractSimulationError,
  ContractTxBuildError,
} from '../errors';

@Injectable()
export class VendorRegistryContractClient implements IVendorRegistryClient {
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
    this.ensureConfigured();

    const vendorIdArg = StellarSdk.nativeToScVal(vendorId, { type: 'string' });

    try {
      const result = await this.sorobanService.simulateContractCall(
        this.contractId,
        'is_vendor_active',
        [vendorIdArg],
      );
      return Boolean(StellarSdk.scValToNative(result));
    } catch (error) {
      try {
        const result = await this.sorobanService.simulateContractCall(
          this.contractId,
          'is_active',
          [vendorIdArg],
        );
        return Boolean(StellarSdk.scValToNative(result));
      } catch {
        this.logger.error(`Failed to check vendor active status for ${vendorId}: ${error.message}`);
        throw new ContractReadError('vendor active status');
      }
    }
  }

  async getVendor(vendorId: string): Promise<VendorInfo | null> {
    this.ensureConfigured();

    const vendorIdArg = StellarSdk.nativeToScVal(vendorId, { type: 'string' });

    try {
      const result = await this.sorobanService.simulateContractCall(
        this.contractId,
        'get_vendor',
        [vendorIdArg],
      );
      const raw = StellarSdk.scValToNative(result) as Record<string, unknown>;

      if (!raw) {
        return null;
      }

      return {
        id: String(raw['id'] ?? raw['vendor_id'] ?? ''),
        name: String(raw['name'] ?? ''),
        active: Boolean(raw['active'] ?? raw['is_active'] ?? false),
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

  async buildApproveVendorXdr(admin: string, vendor: string): Promise<string> {
    this.ensureConfigured();

    try {
      const contract = new StellarSdk.Contract(this.contractId);
      const server = this.sorobanService.getServer();
      const networkPassphrase = this.sorobanService.getNetworkPassphrase();

      const adminArg = StellarSdk.nativeToScVal(StellarSdk.Address.fromString(admin), {
        type: 'address',
      });
      const vendorArg = StellarSdk.nativeToScVal(vendor, { type: 'string' });

      const sourceKeypair = StellarSdk.Keypair.random();
      const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), '0');

      const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(contract.call('approve_vendor', adminArg, vendorArg))
        .setTimeout(300)
        .build();

      const simulation = await server.simulateTransaction(tx);

      if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
        const errorMsg =
          (simulation as StellarSdk.SorobanRpc.Api.SimulateTransactionErrorResponse).error ||
          'Unknown simulation error';
        this.logger.error(`approve_vendor simulation failed: ${errorMsg}`);
        throw new ContractSimulationError('approve_vendor');
      }

      const assembledTx = StellarSdk.SorobanRpc.assembleTransaction(
        tx,
        simulation as StellarSdk.SorobanRpc.Api.SimulateTransactionSuccessResponse,
      ).build();

      return assembledTx.toXDR();
    } catch (error) {
      if (
        error instanceof ContractNotConfiguredError ||
        error instanceof ContractSimulationError
      ) {
        throw error;
      }
      this.logger.error(`Failed to build approve_vendor transaction: ${error.message}`);
      throw new ContractTxBuildError('approve_vendor');
    }
  }

  async buildSuspendVendorXdr(admin: string, vendor: string): Promise<string> {
    this.ensureConfigured();

    try {
      const contract = new StellarSdk.Contract(this.contractId);
      const server = this.sorobanService.getServer();
      const networkPassphrase = this.sorobanService.getNetworkPassphrase();

      const adminArg = StellarSdk.nativeToScVal(StellarSdk.Address.fromString(admin), {
        type: 'address',
      });
      const vendorArg = StellarSdk.nativeToScVal(vendor, { type: 'string' });

      const sourceKeypair = StellarSdk.Keypair.random();
      const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), '0');

      const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(contract.call('suspend_vendor', adminArg, vendorArg))
        .setTimeout(300)
        .build();

      const simulation = await server.simulateTransaction(tx);

      if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
        const errorMsg =
          (simulation as StellarSdk.SorobanRpc.Api.SimulateTransactionErrorResponse).error ||
          'Unknown simulation error';
        this.logger.error(`suspend_vendor simulation failed: ${errorMsg}`);
        throw new ContractSimulationError('suspend_vendor');
      }

      const assembledTx = StellarSdk.SorobanRpc.assembleTransaction(
        tx,
        simulation as StellarSdk.SorobanRpc.Api.SimulateTransactionSuccessResponse,
      ).build();

      return assembledTx.toXDR();
    } catch (error) {
      if (
        error instanceof ContractNotConfiguredError ||
        error instanceof ContractSimulationError
      ) {
        throw error;
      }
      this.logger.error(`Failed to build suspend_vendor transaction: ${error.message}`);
      throw new ContractTxBuildError('suspend_vendor');
    }
  }

  private ensureConfigured(): void {
    if (!this.contractId) {
      throw new ContractNotConfiguredError('Vendor registry contract');
    }
  }
}

