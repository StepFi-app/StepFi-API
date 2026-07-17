import { ApiProperty } from '@nestjs/swagger';

/**
 * Aggregated summary for the authenticated vendor's own activity.
 * All figures are scoped to loans tied to this vendor via `loans.vendor_id`.
 */
export class VendorDashboardDto {
  @ApiProperty({ example: 42, description: 'Total number of loans funded through this vendor' })
  totalLoansFunded: number;

  @ApiProperty({
    example: 12500.5,
    description: 'Total amount received, summed from repayment records for this vendor\'s loans',
  })
  totalReceived: number;

  @ApiProperty({ example: 8, description: 'Distinct borrowers with an active loan through this vendor' })
  activeBorrowers: number;

  @ApiProperty({ example: 4.76, description: 'Percentage of this vendor\'s loans in default (0-100)' })
  defaultRate: number;
}
