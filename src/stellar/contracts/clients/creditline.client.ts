import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from 'stellar-sdk';
import { SorobanService } from '../../../blockchain/soroban/soroban.service';
import { CreateLoanParams, CREDIT_LINE_CONTRACT_ID_KEY } from '../interfaces/creditline.interface';
import {
  ContractNotConfiguredError,
  ContractTxBuildError,
} from '../errors';

@Injectable()
export class CreditLineContractClient {
  private readonly logger = new Logger(CreditLineContractClient.name);
  private readonly contractId: string;

  constructor(
    private readonly sorobanService: SorobanService,
    private readonly configService: ConfigService,
  ) {
    this.contractId =
      this.configService.get<string>(CREDIT_LINE_CONTRACT_ID_KEY) ||
      this.configService.get<string>('CREDITLINE_CONTRACT_ID') ||
      '';

    if (this.contractId) {
      this.logger.log(`CreditLine contract loaded: ${this.contractId.slice(0, 8)}...`);
    } else {
      this.logger.warn(`${CREDIT_LINE_CONTRACT_ID_KEY} is not set - contract calls will fail`);
    }
  }

  async buildCreateLoanTransaction(
    borrowerWallet: string,
    params: CreateLoanParams,
  ): Promise<string> {
    this.ensureConfigured();

    const contract = new StellarSdk.Contract(this.contractId);
    const server = this.sorobanService.getServer();
    const networkPassphrase = this.sorobanService.getNetworkPassphrase();
    const sourceAccount = await server.getAccount(borrowerWallet);
    const amount = this.toContractAmount(params.amount);
    const loanAmount = this.toContractAmount(params.loanAmount);
    const guarantee = this.toContractAmount(params.guarantee);

    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          'create_loan',
          StellarSdk.nativeToScVal(params.loanId, { type: 'string' }),
          StellarSdk.nativeToScVal(params.vendorId, { type: 'string' }),
          StellarSdk.nativeToScVal(amount, { type: 'i128' }),
          StellarSdk.nativeToScVal(loanAmount, { type: 'i128' }),
          StellarSdk.nativeToScVal(guarantee, { type: 'i128' }),
          StellarSdk.nativeToScVal(params.interestRate, { type: 'u32' }),
          StellarSdk.nativeToScVal(params.term, { type: 'u32' }),
        ),
      )
      .setTimeout(30)
      .build();

    const prepared = await server.prepareTransaction(tx);
    return prepared.toXDR();
  }

  async buildRepayLoanTx(userWallet: string, loanId: string, amount: number): Promise<string> {
    this.ensureConfigured();

    try {
      const contract = new StellarSdk.Contract(this.contractId);
      const server = this.sorobanService.getServer();
      const networkPassphrase = this.sorobanService.getNetworkPassphrase();
      const userArg = StellarSdk.nativeToScVal(StellarSdk.Address.fromString(userWallet), {
        type: 'address',
      });
      const loanIdArg = StellarSdk.nativeToScVal(loanId, { type: 'string' });
      const amountInStroops = BigInt(Math.round(amount * 10_000_000));
      const amountArg = StellarSdk.nativeToScVal(amountInStroops, { type: 'i128' });

      const sourceKeypair = StellarSdk.Keypair.random();
      const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), '0');

      const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      })
        .addOperation(contract.call('repay_loan', userArg, loanIdArg, amountArg))
        .setTimeout(300)
        .build();

      const prepared = await server.prepareTransaction(tx);
      return prepared.toXDR();
    } catch (error) {
      if (error instanceof ContractNotConfiguredError) {
        throw error;
      }
      this.logger.error(`Failed to build repay_loan transaction: ${error.message}`);
      throw new ContractTxBuildError('repayment');
    }
  }

  private ensureConfigured(): void {
    if (!this.contractId) {
      throw new ContractNotConfiguredError('Credit line contract');
    }
  }

  private toContractAmount(value: number): bigint {
    return BigInt(Math.round(value * 100));
  }
}
