export interface CreateLoanParams {
  loanId: string;
  vendorId: string;
  amount: number;
  loanAmount: number;
  guarantee: number;
  interestRate: number;
  term: number;
}

export const CREDIT_LINE_CONTRACT_ID_KEY = 'CREDIT_LINE_CONTRACT_ID';

export interface ICreditLineClient {
  buildCreateLoanTransaction(
    borrowerWallet: string,
    params: CreateLoanParams,
  ): Promise<string>;

  buildRepayLoanTx(
    userWallet: string,
    loanId: string,
    amount: number,
  ): Promise<string>;
}
