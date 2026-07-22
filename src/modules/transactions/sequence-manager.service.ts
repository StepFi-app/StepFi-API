import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { TransactionsService } from './transactions.service';
import { TransactionType } from './dto/submit-transaction-request.dto';

@Injectable()
export class SequenceManagerService {
  private readonly logger = new Logger(SequenceManagerService.name);
  private readonly horizonServer: StellarSdk.Horizon.Server;
  private readonly networkPassphrase: string;
  private readonly adminKeypair: StellarSdk.Keypair | null = null;
  private currentSequence: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly transactionsService: TransactionsService,
  ) {
    const horizonUrl =
      this.configService.get<string>('STELLAR_HORIZON_URL') ||
      'https://horizon-testnet.stellar.org';

    this.networkPassphrase =
      this.configService.get<string>('STELLAR_NETWORK_PASSPHRASE') ||
      StellarSdk.Networks.TESTNET;

    this.horizonServer = new StellarSdk.Horizon.Server(horizonUrl);

    const secret = this.configService.get<string>('STELLAR_ADMIN_SECRET');
    if (secret) {
      try {
        this.adminKeypair = StellarSdk.Keypair.fromSecret(secret);
        this.logger.log(`Admin keypair loaded: ${this.adminKeypair.publicKey().slice(0, 8)}...`);
      } catch {
        this.logger.warn('STELLAR_ADMIN_SECRET is invalid — admin transactions will fail');
      }
    } else {
      this.logger.warn('STELLAR_ADMIN_SECRET is not set — admin transactions cannot be submitted');
    }
  }

  get hasAdminKeypair(): boolean {
    return this.adminKeypair !== null;
  }

  async submitAdminTransaction(
    txType: TransactionType,
    buildTx: (source: StellarSdk.Account) => Promise<string>,
  ): Promise<{ transactionHash: string }> {
    if (!this.adminKeypair) {
      throw new Error('Admin keypair not configured — cannot submit admin transaction');
    }

    const adminAccount = await this.fetchAdminAccount();

    const unsignedXdr = await buildTx(adminAccount);

    const transaction = StellarSdk.TransactionBuilder.fromXDR(unsignedXdr, this.networkPassphrase);
    transaction.sign(this.adminKeypair);
    const signedXdr = transaction.toXDR();

    try {
      const result = await this.transactionsService.submitTransaction(
        this.adminKeypair.publicKey(),
        { xdr: signedXdr, type: txType },
      );

      this.currentSequence = String(Number(adminAccount.sequenceNumber()) + 1);

      return result;
    } catch (error) {
      this.currentSequence = null;
      throw error;
    }
  }

  private async fetchAdminAccount(): Promise<StellarSdk.Account> {
    const adminPubKey = this.adminKeypair!.publicKey();

    try {
      const accountRecord = await this.horizonServer
        .accounts()
        .accountId(adminPubKey)
        .call();

      const account = new StellarSdk.Account(adminPubKey, accountRecord.sequence);
      this.currentSequence = accountRecord.sequence;
      return account;
    } catch (error) {
      this.logger.error(
        `Failed to fetch admin account ${adminPubKey.slice(0, 8)}...: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
