import { IsString, IsNotEmpty, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum TransactionType {
  LOAN_CREATE = 'loan_create',
  LOAN_REPAY = 'loan_repay',
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
  VENDOR_APPROVE = 'vendor_approve',
  VENDOR_SUSPEND = 'vendor_suspend',
}


/**
 * DTO for submitting a signed Stellar XDR transaction to the network.
 */
export class SubmitTransactionRequestDto {
  @ApiProperty({
    description: 'Signed XDR transaction string to submit to the Stellar network',
    example: 'AAAAAgAAAAA...',
  })
  @IsString({ message: 'xdr must be a string' })
  @IsNotEmpty({ message: 'xdr must not be empty' })
  xdr: string;

  @ApiProperty({
    description: 'Transaction type for record classification',
    enum: TransactionType,
    example: TransactionType.DEPOSIT,
  })
  @IsEnum(TransactionType, {
    message: `type must be one of: ${Object.values(TransactionType).join(', ')}`,
  })
  type: TransactionType;
}
