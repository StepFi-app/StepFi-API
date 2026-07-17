import { ApiProperty } from '@nestjs/swagger';

export class VendorPaymentDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'On-chain loan identifier the payment belongs to' }) loanId: string;
  @ApiProperty({ example: 50 }) amount: number;
  @ApiProperty({ description: 'Settlement transaction hash' }) txHash: string;
  @ApiProperty() paidAt: string;
}

export class VendorPaymentsPageDto {
  @ApiProperty({ type: [VendorPaymentDto] }) items: VendorPaymentDto[];
  @ApiProperty({ example: 120 }) total: number;
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 12 }) totalPages: number;
}
