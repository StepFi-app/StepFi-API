import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SorobanService } from '../../../blockchain/soroban/soroban.service';
import { PoolStats, LIQUIDITY_POOL_CONTRACT_ID_KEY } from '../interfaces/liquidity-pool.interface';
import {
  ContractNotConfiguredError,
  ContractSimulationError,
  ContractReadError,
  ContractTxBuildError,
} from '../errors';

const STROOPS = 10_000_000n;
const SHARE_PRICE_BPS = 10_000n;

@Injectable()
export class LiquidityPoolContractClient {
  private readonly logger = new Logger(LiquidityPoolContractClient.name);
  private readonly contractId: string;

  constructor(
    private readonly sorobanService: SorobanService,
    private readonly configService: ConfigService,
  ) {
    this.contractId =
      this.configService.get<string>(LIQUIDITY_POOL_CONTRACT_ID_KEY) ||
      this.configService.get<string>('LIQUIDITY_CONTRACT_ID') ||
      '';

    if (this.contractId) {
      this.logger.log(`LiquidityPool contract loaded: ${this.contractId.slice(0, 8)}...`);
    } else {
      this.logger.warn(`${LIQUIDITY_POOL_CONTRACT_ID_KEY} is not set - contract calls will fail`);
    }
  }

  async getLpShares(wallet: string): Promise<bigint> {
    this.ensureConfigured();

    const addressArg = StellarSdk.nativeToScVal(StellarSdk.Address.fromString(wallet), {
      type: 'address',
    });

    try {
      return await this.readBigInt(
        ['get_lp_shares', 'get_provider_shares', 'provider_shares', 'get_shares', 'shares_of'],
        [addressArg],
        'provider shares',
        true,
      );
    } catch (error) {
      if (this.isMissingProviderError(error)) {
        this.logger.debug(`No LP shares for wallet ${wallet.slice(0, 8)}...`);
        return 0n;
      }
      throw error;
    }
  }

  async getPoolStats(): Promise<PoolStats> {
    this.ensureConfigured();

    try {
      const result = await this.sorobanService.simulateContractCall(
        this.contractId,
        'get_pool_stats',
        [],
      );
      const raw = StellarSdk.scValToNative(result) as Record<string, unknown>;
      const totalLiquidity = this.toBigInt(raw['total_liquidity']);
      const availableLiquidity = this.toBigInt(raw['available_liquidity']);
      const totalShares = this.toBigInt(raw['total_shares']);
      const lockedLiquidity =
        raw['locked_liquidity'] !== undefined
          ? this.toBigInt(raw['locked_liquidity'])
          : totalLiquidity - availableLiquidity;
      const sharePrice =
        raw['share_price'] !== undefined
          ? this.toBigInt(raw['share_price'])
          : totalShares > 0n
            ? (totalLiquidity * SHARE_PRICE_BPS) / totalShares
            : 0n;

      return {
        totalLiquidity,
        lockedLiquidity,
        availableLiquidity,
        totalShares,
        sharePrice,
        withdrawalFeeBps: await this.getWithdrawalFeeBps(),
      };
    } catch (error) {
      this.logger.warn(`get_pool_stats unavailable, falling back to granular reads: ${error.message}`);

      const [totalLiquidity, availableLiquidity, totalShares, withdrawalFeeBps] =
        await Promise.all([
          this.readBigInt(['get_total_liquidity', 'total_liquidity'], [], 'total liquidity'),
          this.readBigInt(
            ['get_available_liquidity', 'available_liquidity', 'liquid_assets'],
            [],
            'available liquidity',
          ),
          this.readBigInt(['get_total_shares', 'total_shares'], [], 'total shares'),
          this.getWithdrawalFeeBps(),
        ]);

      const lockedLiquidity = totalLiquidity > availableLiquidity ? totalLiquidity - availableLiquidity : 0n;
      const sharePrice = totalShares > 0n ? (totalLiquidity * SHARE_PRICE_BPS) / totalShares : 0n;

      return {
        totalLiquidity,
        lockedLiquidity,
        availableLiquidity,
        totalShares,
        sharePrice,
        withdrawalFeeBps,
      };
    }
  }

  async calculateWithdrawal(sharesInStroops: bigint): Promise<bigint> {
    this.ensureConfigured();

    const sharesArg = StellarSdk.nativeToScVal(sharesInStroops, { type: 'i128' });

    try {
      return await this.readBigInt(['calculate_withdrawal'], [sharesArg], 'withdrawal preview');
    } catch (error) {
      this.logger.warn(`calculate_withdrawal unavailable, falling back to share-price math: ${error.message}`);
      const stats = await this.getPoolStats();
      if (stats.totalShares <= 0n) {
        return 0n;
      }
      return (sharesInStroops * stats.totalLiquidity) / stats.totalShares;
    }
  }

  async calculateDeposit(amountInStroops: bigint): Promise<bigint> {
    this.ensureConfigured();

    const amountArg = StellarSdk.nativeToScVal(amountInStroops, { type: 'i128' });

    try {
      return await this.readBigInt(
        ['calculate_deposit', 'calculate_deposit_shares', 'preview_deposit'],
        [amountArg],
        'deposit shares preview',
      );
    } catch (error) {
      this.logger.warn(`calculate_deposit unavailable, falling back to share-price math: ${error.message}`);
      const stats = await this.getPoolStats();
      if (stats.totalShares <= 0n || stats.totalLiquidity <= 0n) {
        return amountInStroops;
      }
      return (amountInStroops * stats.totalShares) / stats.totalLiquidity;
    }
  }

  async buildDepositTx(userWallet: string, amountInStroops: bigint): Promise<string> {
    this.ensureConfigured();

    try {
      const contract = new StellarSdk.Contract(this.contractId);
      const server = this.sorobanService.getServer();
      const networkPassphrase = this.sorobanService.getNetworkPassphrase();

      const userArg = StellarSdk.nativeToScVal(StellarSdk.Address.fromString(userWallet), {
        type: 'address',
      });
      const amountArg = StellarSdk.nativeToScVal(amountInStroops, { type: 'i128' });

      const sourceKeypair = StellarSdk.Keypair.random();
      const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), '0');

      const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(contract.call('deposit', userArg, amountArg))
        .setTimeout(300)
        .build();

      const simulation = await server.simulateTransaction(tx);

      if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
        const errorMsg =
          (simulation as StellarSdk.SorobanRpc.Api.SimulateTransactionErrorResponse).error ||
          'Unknown simulation error';
        this.logger.error(`deposit simulation failed: ${errorMsg}`);
        throw new ContractSimulationError('deposit');
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
      this.logger.error(`Failed to build deposit transaction: ${error.message}`);
      throw new ContractTxBuildError('deposit');
    }
  }

  async buildWithdrawTx(userWallet: string, sharesInStroops: bigint): Promise<string> {
    this.ensureConfigured();

    try {
      const contract = new StellarSdk.Contract(this.contractId);
      const server = this.sorobanService.getServer();
      const networkPassphrase = this.sorobanService.getNetworkPassphrase();

      const userArg = StellarSdk.nativeToScVal(StellarSdk.Address.fromString(userWallet), {
        type: 'address',
      });
      const sharesArg = StellarSdk.nativeToScVal(sharesInStroops, { type: 'i128' });

      const sourceKeypair = StellarSdk.Keypair.random();
      const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), '0');

      const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(contract.call('withdraw', userArg, sharesArg))
        .setTimeout(300)
        .build();

      const simulation = await server.simulateTransaction(tx);

      if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
        const errorMsg =
          (simulation as StellarSdk.SorobanRpc.Api.SimulateTransactionErrorResponse).error ||
          'Unknown simulation error';
        this.logger.error(`withdraw simulation failed: ${errorMsg}`);
        throw new ContractSimulationError('withdraw');
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
      this.logger.error(`Failed to build withdraw transaction: ${error.message}`);
      throw new ContractTxBuildError('withdraw');
    }
  }

  private async getWithdrawalFeeBps(): Promise<bigint> {
    const methods = ['get_withdrawal_fee_bps', 'withdrawal_fee_bps', 'get_withdraw_fee_bps'];

    for (const method of methods) {
      try {
        return await this.readBigInt([method], [], 'withdrawal fee', true);
      } catch {
        // try next name
      }
    }

    this.logger.warn('Withdrawal fee method not available on contract; defaulting fee to 0 bps');
    return 0n;
  }

  private async readBigInt(
    methods: string[],
    args: StellarSdk.xdr.ScVal[],
    label: string,
    allowContractError = false,
  ): Promise<bigint> {
    let lastError: unknown;

    for (const method of methods) {
      try {
        const result = await this.sorobanService.simulateContractCall(this.contractId, method, args);
        return this.toBigInt(StellarSdk.scValToNative(result));
      } catch (error) {
        lastError = error;
        if (allowContractError && this.isMissingProviderError(error)) {
          throw error;
        }
      }
    }

    this.logger.error(`Failed to read ${label} from liquidity pool contract`, lastError as Error);
    throw new ContractReadError(label);
  }

  private ensureConfigured(): void {
    if (!this.contractId) {
      throw new ContractNotConfiguredError('Liquidity pool contract');
    }
  }

  private isMissingProviderError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('HostError') ||
      message.includes('Status(ContractError') ||
      message.includes('Error(Contract')
    );
  }

  private toBigInt(value: unknown): bigint {
    if (typeof value === 'bigint') {
      return value;
    }

    if (typeof value === 'number') {
      return BigInt(Math.round(value));
    }

    if (typeof value === 'string') {
      return BigInt(value);
    }

    if (value && typeof value === 'object' && 'toString' in (value as object)) {
      return BigInt(String(value));
    }

    throw new Error(`Unsupported contract numeric value: ${String(value)}`);
  }
}
