import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VendorLoanDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'On-chain loan identifier' }) loanId: string;
  @ApiProperty({ description: 'Borrower Stellar wallet address' }) borrowerWallet: string;
  @ApiProperty({ example: 500 }) amount: number;
  @ApiProperty({ example: 450 }) loanAmount: number;
  @ApiProperty({ example: 200 }) remainingBalance: number;
  @ApiProperty({ example: 'active' }) status: string;
  @ApiPropertyOptional({ nullable: true }) nextPaymentDue?: string | null;
  @ApiProperty() createdAt: string;
}

export class VendorLoansPageDto {
  @ApiProperty({ type: [VendorLoanDto] }) items: VendorLoanDto[];
  @ApiProperty({ example: 42 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 5 }) totalPages: number;
}
