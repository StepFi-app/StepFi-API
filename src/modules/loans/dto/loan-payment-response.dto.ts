import { ApiProperty } from '@nestjs/swagger';

/**
 * Preview of the payment's effect on the loan before submission.
 */
export class LoanPaymentPreviewDto {
  @ApiProperty({ description: 'Payment amount being applied', example: 108.33 })
  paymentAmount: number;

  @ApiProperty({ description: 'Remaining balance before this payment', example: 325.0 })
  currentBalance: number;

  @ApiProperty({ description: 'Remaining balance after this payment', example: 216.67 })
  newBalance: number;

  @ApiProperty({
    description: 'Whether this payment will fully complete the loan',
    example: false,
  })
  willComplete: boolean;
}

/**
 * DTO for the loan repayment response.
 * Returns an unsigned XDR transaction for the mobile app to sign,
 * along with a preview of the payment's effect on the loan.
 */
export class LoanPaymentResponseDto {
  @ApiProperty({
    description: 'Unsigned XDR transaction for the repay_installment() Soroban call',
    example: 'AAAAAgAAAAA...',
  })
  unsignedXdr: string;

  @ApiProperty({
    description: 'Preview of the payment effect on the loan',
    type: LoanPaymentPreviewDto,
  })
  preview: LoanPaymentPreviewDto;
}
