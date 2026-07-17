import { ApiProperty } from '@nestjs/swagger';

export class LoanStatsResponseDto {
  @ApiProperty({ description: 'Total number of loans across all statuses', example: 120 })
  totalLoans: number;

  @ApiProperty({ description: 'Number of currently active loans', example: 45 })
  activeLoans: number;

  @ApiProperty({ description: 'Number of fully repaid loans', example: 70 })
  repaidLoans: number;

  @ApiProperty({ description: 'Number of defaulted loans', example: 5 })
  defaultedLoans: number;

  @ApiProperty({ description: 'Total loan volume disbursed in USD', example: 98500.0 })
  totalVolume: number;

  @ApiProperty({
    description: 'Percentage of loans repaid on time (0-100)',
    example: 93.5,
    minimum: 0,
    maximum: 100,
  })
  onTimeRepaymentRate: number;
}
