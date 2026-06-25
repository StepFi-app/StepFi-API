import { Injectable } from '@nestjs/common';
import type { CreateLoanParams } from '../interfaces/creditline.interface';

@Injectable()
export class MockCreditLineContractClient {
  buildCreateLoanTransaction = jest.fn(
    async (_borrowerWallet: string, _params: CreateLoanParams): Promise<string> => {
      return 'AAAAAgAAAQAAAAAAAAAAiZ3TgwAAAAAyMZyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
    },
  );

  buildRepayLoanTx = jest.fn(
    async (_userWallet: string, _loanId: string, _amount: number): Promise<string> => {
      return 'AAAAAgAAAQAAAAAAAAAAiZ3TgwAAAAAyMZyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
    },
  );

  buildDeclareDefaultTx = jest.fn(
    async (_callerWallet: string, _loanId: string): Promise<string> => {
      return 'AAAAAgAAAQAAAAAAAAAAiZ3TgwAAAAAyMZyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
    },
  );
}
