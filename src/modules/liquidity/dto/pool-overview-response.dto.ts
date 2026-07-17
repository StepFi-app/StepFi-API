import { ApiProperty } from '@nestjs/swagger';

export class PoolOverviewResponseDto {
  @ApiProperty({
    description: 'Total deposits (alias for totalLiquidity)',
    example: 1500000,
  })
  totalDeposits: number;

  @ApiProperty({
    description: 'Total liquidity in the pool (in USD/USDC)',
    example: 1500000,
  })
  totalLiquidity: number;

  @ApiProperty({
    description: 'Liquidity locked against active loans (in USD/USDC)',
    example: 975000,
  })
  lockedLiquidity: number;

  @ApiProperty({
    description: 'Available liquidity not backing active loans (in USD/USDC)',
    example: 525000,
  })
  availableLiquidity: number;

  @ApiProperty({
    description: 'Total pool shares outstanding',
    example: 1492500,
  })
  totalShares: number;

  @ApiProperty({
    description: 'Current share price in USDC',
    example: 1.005,
  })
  sharePrice: number;

  @ApiProperty({
    description: 'Current Estimated APY based on active loans',
    example: 8.5,
  })
  apy: number;

  @ApiProperty({
    description: 'Pool utilization rate (locked / total * 100)',
    example: 65.2,
  })
  utilization: number;

  @ApiProperty({
    description: 'Total unique liquidity providers',
    example: 245,
  })
  totalInvestors: number;

  @ApiProperty({
    description: 'Number of currently active loans',
    example: 124,
  })
  activeLoans: number;
}
