import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import {
  SequenceManagerService,
  ServerTransactionResult,
  ServerTransactionSpec,
} from '../../blockchain/sequence-manager/sequence-manager.service';

// Distinct surface-area error codes so client UX can recognise tx_bad_seq
// from server submissions versus user-signed transactions.
const SERVER_TX_RESULT_MAP: Record<string, string> = {
  tx_bad_seq:
    'Server sequence number went stale. The transaction was resubmitted automatically; please retry.',
  tx_bad_auth: 'Invalid server signing key — contact the StepFi team.',
  tx_insufficient_fee: 'Server fee is too low for the network — retry with a higher fee.',
  op_underfunded: 'Source server account is underfunded — top it up.',
};

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private readonly horizonServer: StellarSdk.Horizon.Server;
  private readonly networkPassphrase: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly sequenceManager: SequenceManagerService,
  ) {
    const horizonUrl =
      this.configService.get<string>('STELLAR_HORIZON_URL') ||
      'https://horizon-testnet.stellar.org';

    this.networkPassphrase =
      this.configService.get<string>('STELLAR_NETWORK_PASSPHRASE') ||
      StellarSdk.Networks.TESTNET;

    this.horizonServer = new StellarSdk.Horizon.Server(horizonUrl);
    this.logger.log(`BlockchainService Horizon client initialized: ${horizonUrl}`);
  }

  isServerSubmissionEnabled(): boolean {
    return this.sequenceManager.isEnabled();
  }

  async submitRepayment(signedXdr: string): Promise<{ transactionHash: string }> {
    const transaction = this.parseTransaction(signedXdr);

    const hash = await this.submitToHorizon(transaction);

    await this.waitForLedgerConfirmation(hash);

    return { transactionHash: hash };
  }

  /**
   * Submit a server-signed transaction through the managed source account
   * (or a channel-account pool when configured). The caller supplies a
   * builder that adds operations; the sequence manager assigns the next
   * sequence number, signs, and submits — transparently re-syncing on
   * `tx_bad_seq` or restart.
   */
  async submitServerTransaction(
    spec: ServerTransactionSpec,
  ): Promise<{ transactionHash: string; sourceAccount: string; sequence: string }> {
    try {
      const result: ServerTransactionResult =
        await this.sequenceManager.submitServerTransaction(spec);
      return {
        transactionHash: result.hash,
        sourceAccount: result.sourceAccount,
        sequence: result.sequence,
      };
    } catch (error) {
      this.handleServerSubmissionError(error);
    }
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
    const resultCodes = this.extractResultCodes(error);

    if (resultCodes) {
      const txCode = resultCodes.transaction;
      const opCodes = resultCodes.operations ?? [];
      const allCodes = [txCode, ...opCodes].filter(Boolean);

      const code = `STELLAR_TRANSACTION_FAILED`;
      const message = `Transaction rejected by the Stellar network: ${allCodes.join(', ')}`;

      throw new BadRequestException({ code, message });
    }

    const message = String((error as { message?: string })?.message ?? 'Unknown error');

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

  private handleServerSubmissionError(error: unknown): never {
    // The sequence-manager passes Horizon errors through, so we can
    // surface known Stellar result codes here too.
    const resultCodes = this.extractResultCodes(error);
    if (resultCodes?.transaction) {
      const txCode = resultCodes.transaction;
      const friendly = SERVER_TX_RESULT_MAP[txCode];
      throw new BadRequestException({
        code: `STELLAR_${txCode.toUpperCase()}`,
        message: friendly ?? `Server transaction rejected: ${txCode}`,
      });
    }

    const message = String((error as { message?: string })?.message ?? 'Unknown error');

    if (message.startsWith('SequenceManager:')) {
      // Configuration / sequence-state errors raised by the manager.
      this.logger.error(`Sequence manager error: ${message}`);
      throw new InternalServerErrorException({
        code: 'STELLAR_SEQUENCE_MANAGER_FAILED',
        message,
      });
    }

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

    this.logger.error(`Server submission error: ${message}`);
    throw new InternalServerErrorException({
      code: 'STELLAR_SUBMISSION_FAILED',
      message:
        'Failed to submit server transaction to the Stellar network. Please try again.',
    });
  }

  private extractResultCodes(
    error: unknown,
  ): { transaction?: string; operations?: string[] } | null {
    const candidate = error as {
      response?: {
        data?: {
          extras?: {
            result_codes?: { transaction?: string; operations?: string[] };
          };
        };
      };
      message?: string;
    };
    return candidate?.response?.data?.extras?.result_codes ?? null;
  }
}
