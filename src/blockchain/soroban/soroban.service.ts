import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { TransactionBuilderService } from '../../stellar/transaction-builder.service';

/**
 * Low-level Soroban RPC client for interacting with smart contracts on the Stellar network.
 * Handles connection management, contract invocation simulation, and response parsing.
 */
@Injectable()
export class SorobanService {
  private readonly logger = new Logger(SorobanService.name);
  private readonly server: StellarSdk.SorobanRpc.Server;
  private readonly networkPassphrase: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly transactionBuilderService: TransactionBuilderService,
  ) {
    const rpcUrl =
      this.configService.get<string>('STELLAR_SOROBAN_URL') ||
      'https://soroban-testnet.stellar.org';

    this.networkPassphrase =
      this.configService.get<string>('STELLAR_NETWORK_PASSPHRASE') ||
      StellarSdk.Networks.TESTNET;

    this.server = new StellarSdk.SorobanRpc.Server(rpcUrl);
    this.logger.log(`Soroban RPC client initialized: ${rpcUrl}`);
  }

  getServer(): StellarSdk.SorobanRpc.Server {
    return this.server;
  }

  getNetworkPassphrase(): string {
    return this.networkPassphrase;
  }

  /**
   * Simulates a read-only contract call and returns the result xdr value.
   * Uses a disposable source account so no real signing is needed.
   *
   * @param contractId - Deployed contract address (C... format)
   * @param method     - Contract function name
   * @param args       - Soroban ScVal arguments
   * @returns The raw xdr.ScVal result from the simulation
   */
  async simulateContractCall(
    contractId: string,
    method: string,
    args: StellarSdk.xdr.ScVal[] = [],
  ): Promise<StellarSdk.xdr.ScVal> {
    const contract = new StellarSdk.Contract(contractId);

    // Build a read-only transaction using a throwaway source account
    const sourceKeypair = StellarSdk.Keypair.random();
    const sourcePublic = sourceKeypair.publicKey();

    const account = new StellarSdk.Account(sourcePublic, '0');

    return this.transactionBuilderService.buildWithFeeRetry(
      1,
      `${method} simulation`,
      async (fee) => {
        const tx = new StellarSdk.TransactionBuilder(account, {
          fee,
          networkPassphrase: this.networkPassphrase,
        })
          .addOperation(contract.call(method, ...args))
          .setTimeout(30)
          .build();

        const simulation = await this.server.simulateTransaction(tx);

        if (StellarSdk.SorobanRpc.Api.isSimulationError(simulation)) {
          const errorMsg =
            (simulation as StellarSdk.SorobanRpc.Api.SimulateTransactionErrorResponse).error ||
            'Unknown simulation error';
          throw new Error(`Soroban simulation failed: ${errorMsg}`);
        }

        const successResult = simulation as StellarSdk.SorobanRpc.Api.SimulateTransactionSuccessResponse;
        if (!successResult.result) {
          throw new Error('Soroban simulation returned no result');
        }

        return successResult.result.retval;
      },
    );
  }
}
