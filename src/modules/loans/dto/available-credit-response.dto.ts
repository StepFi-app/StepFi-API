import { ApiProperty } from '@nestjs/swagger';
import { ReputationTier } from '../../reputation/dto/reputation-response.dto';

/**
 * DTO for the available credit breakdown of the authenticated user.
 */
export class AvailableCreditResponseDto {
  @ApiProperty({
    description: 'Current on-chain reputation score normalized to the 0-100 range',
    example: 75,
    minimum: 0,
    maximum: 100,
  })
  reputationScore: number;

  @ApiProperty({
    description: 'Reputation tier derived from the on-chain score',
    example: 'silver',
    enum: ['gold', 'silver', 'bronze', 'starter'],
  })
  reputationTier: ReputationTier;

  @ApiProperty({
    description: 'Maximum credit limit in USD available for the current reputation tier',
    example: 3000,
  })
  maxCreditLimit: number;

  @ApiProperty({
    description: 'Total outstanding balance across the user active loans in USD',
    example: 825.5,
  })
  creditUsed: number;

  @ApiProperty({
    description: 'Remaining borrowing capacity in USD, never below zero',
    example: 2174.5,
  })
  availableCredit: number;

  @ApiProperty({
    description: 'Number of active loans currently counted in the utilization calculation',
    example: 2,
  })
  activeLoans: number;
}
