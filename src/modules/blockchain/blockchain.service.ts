import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private readonly horizonServer: StellarSdk.Horizon.Server;
  private readonly networkPassphrase: string;

  constructor(private readonly configService: ConfigService) {
    const horizonUrl =
      this.configService.get<string>('STELLAR_HORIZON_URL') ||
      'https://horizon-testnet.stellar.org';

    this.networkPassphrase =
      this.configService.get<string>('STELLAR_NETWORK_PASSPHRASE') ||
      StellarSdk.Networks.TESTNET;

    this.horizonServer = new StellarSdk.Horizon.Server(horizonUrl);
    this.logger.log(`BlockchainService Horizon client initialized: ${horizonUrl}`);
  }

  async submitRepayment(signedXdr: string): Promise<{ transactionHash: string }> {
    const transaction = this.parseTransaction(signedXdr);

    const hash = await this.submitToHorizon(transaction);

    await this.waitForLedgerConfirmation(hash);

    return { transactionHash: hash };
  }

  private parseTransaction(signedXdr: string): StellarSdk.Transaction {
    try {
      const parsed = StellarSdk.TransactionBuilder.fromXDR(
        signedXdr,
        this.networkPassphrase,
      );

      if (parsed instanceof StellarSdk.FeeBumpTransaction) {
        throw new BadRequestException({
          code: 'TRANSACTION_FEE_BUMP_NOT_SUPPORTED',
          message: 'Fee bump transactions are not supported for loan repayments.',
        });
      }

      return parsed;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException({
        code: 'TRANSACTION_INVALID_XDR',
        message: 'The provided XDR string is malformed or invalid.',
      });
    }
  }

  private async submitToHorizon(transaction: StellarSdk.Transaction): Promise<string> {
    try {
      const result = await this.horizonServer.submitTransaction(transaction);
      return result.hash;
    } catch (error) {
      this.handleHorizonError(error);
    }
  }

  private async waitForLedgerConfirmation(
    hash: string,
    maxRetries = 30,
    delayMs = 2000,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const tx = await this.horizonServer
          .transactions()
          .transaction(hash)
          .call();

        if (tx.ledger_attr > 0) {
          this.logger.log(
            `Transaction ${hash} confirmed in ledger ${tx.ledger_attr}`,
          );
          return;
        }
      } catch {
        // Transaction not yet visible in Horizon — continue polling
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new ServiceUnavailableException({
      code: 'TRANSACTION_CONFIRMATION_TIMEOUT',
      message:
        'Transaction was submitted but not confirmed within the expected time.',
    });
  }

  private handleHorizonError(error: unknown): never {
    const err = error as {
      response?: {
        data?: {
          extras?: {
            result_codes?: {
              transaction?: string;
              operations?: string[];
            };
          };
        };
      };
      message?: string;
    };

    const resultCodes = err?.response?.data?.extras?.result_codes;

    if (resultCodes) {
      const txCode = resultCodes.transaction;
      const opCodes = resultCodes.operations ?? [];
      const allCodes = [txCode, ...opCodes].filter(Boolean);

      const code = `STELLAR_TRANSACTION_FAILED`;
      const message = `Transaction rejected by the Stellar network: ${allCodes.join(', ')}`;

      throw new BadRequestException({ code, message });
    }

    const message = err?.message ?? 'Unknown error';

    if (
      message.toLowerCase().includes('timeout') ||
      message.toLowerCase().includes('network')
    ) {
      throw new ServiceUnavailableException({
        code: 'STELLAR_NETWORK_UNAVAILABLE',
        message:
          'Stellar network is temporarily unavailable. Please try again later.',
      });
    }

    this.logger.error(`Horizon submission error: ${message}`);
    throw new InternalServerErrorException({
      code: 'STELLAR_SUBMISSION_FAILED',
      message:
        'Failed to submit transaction to the Stellar network. Please try again.',
    });
  }
}
