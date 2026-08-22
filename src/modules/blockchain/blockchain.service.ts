import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SupabaseService } from '../../database/supabase.client';

const IDEMPOTENCY_RECORD_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

type IdempotencyRecord = {
  id: string;
  idempotency_key: string;
  transaction_hash: string;
  response_body: Record<string, unknown> | null;
  status: string;
  expires_at: string;
};

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);
  private readonly horizonServer: StellarSdk.Horizon.Server;
  private readonly networkPassphrase: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
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

  async submitRepayment(
    signedXdr: string,
    idempotencyKey?: string,
  ): Promise<{ transactionHash: string }> {
    const transaction = this.parseTransaction(signedXdr);
    const transactionHash = transaction.hash().toString('hex');

    if (idempotencyKey) {
      const existing = await this.findIdempotencyRecord(idempotencyKey);
      if (existing) {
        if (existing.status === 'completed' && existing.response_body) {
          return existing.response_body as { transactionHash: string };
        }
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_IN_USE',
          message: 'This idempotency key is already associated with an in-flight transaction.',
        });
      }
    }

    const duplicate = await this.findRecordByHash(transactionHash);
    if (duplicate) {
      if (duplicate.status === 'completed' && duplicate.response_body) {
        return duplicate.response_body as { transactionHash: string };
      }
      throw new ConflictException({
        code: 'TRANSACTION_ALREADY_SUBMITTED',
        message: 'This transaction has already been submitted.',
      });
    }

    if (idempotencyKey) {
      await this.createIdempotencyRecord(idempotencyKey, transactionHash, signedXdr);
    }

    const hash = await this.submitToHorizon(transaction);

    await this.waitForLedgerConfirmation(hash);

    const response = { transactionHash: hash };

    if (idempotencyKey) {
      await this.completeIdempotencyRecord(idempotencyKey, response);
    }

    return response;
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

  private async findIdempotencyRecord(
    idempotencyKey: string,
  ): Promise<IdempotencyRecord | null> {
    const client = this.supabaseService.getServiceRoleClient();
    const { data, error } = await client
      .from('idempotency_records')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Failed to query idempotency record for key ${idempotencyKey}: ${error.message}`,
      );
      throw new InternalServerErrorException({
        code: 'IDEMPOTENCY_LOOKUP_FAILED',
        message: 'Failed to check idempotency record.',
      });
    }

    return data as IdempotencyRecord | null;
  }

  private async findRecordByHash(
    transactionHash: string,
  ): Promise<IdempotencyRecord | null> {
    const client = this.supabaseService.getServiceRoleClient();
    const { data, error } = await client
      .from('idempotency_records')
      .select('*')
      .eq('transaction_hash', transactionHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Failed to query idempotency record for hash ${transactionHash}: ${error.message}`,
      );
      throw new InternalServerErrorException({
        code: 'IDEMPOTENCY_LOOKUP_FAILED',
        message: 'Failed to check transaction hash deduplication.',
      });
    }

    return data as IdempotencyRecord | null;
  }

  private async createIdempotencyRecord(
    idempotencyKey: string,
    transactionHash: string,
    signedXdr: string,
  ): Promise<void> {
    const client = this.supabaseService.getServiceRoleClient();
    const { error } = await client.from('idempotency_records').insert({
      idempotency_key: idempotencyKey,
      transaction_hash: transactionHash,
      request_body: { xdr: signedXdr },
      status: 'pending',
      expires_at: new Date(Date.now() + IDEMPOTENCY_RECORD_TTL_MS).toISOString(),
    });

    if (error) {
      this.logger.error(
        `Failed to create idempotency record for key ${idempotencyKey}: ${error.message}`,
      );
      throw new InternalServerErrorException({
        code: 'IDEMPOTENCY_RECORD_CREATE_FAILED',
        message: 'Failed to create idempotency record.',
      });
    }
  }

  private async completeIdempotencyRecord(
    idempotencyKey: string,
    response: { transactionHash: string },
  ): Promise<void> {
    const client = this.supabaseService.getServiceRoleClient();
    const { error } = await client
      .from('idempotency_records')
      .update({
        status: 'completed',
        response_body: response,
      })
      .eq('idempotency_key', idempotencyKey);

    if (error) {
      this.logger.error(
        `Failed to complete idempotency record for key ${idempotencyKey}: ${error.message}`,
      );
    }
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
