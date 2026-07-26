import { ApiProperty } from '@nestjs/swagger';

/** Reputation tier based on on-chain score */
export type ReputationTier = 'gold' | 'silver' | 'bronze' | 'starter';

/**
 * DTO for the reputation score response.
 * Normalizes on-chain data into a consumer-friendly format with tier,
 * interest rate, and credit limit derived from the raw score.
 */
export class ReputationResponseDto {
  @ApiProperty({
    description: 'Stellar wallet address',
    example: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
  })
  wallet: string;

  @ApiProperty({
    description: 'Reputation score normalized to 0-100 range',
    example: 75,
    minimum: 0,
    maximum: 100,
  })
  score: number;

  @ApiProperty({
    description: 'Reputation tier derived from score (gold, silver, bronze, starter)',
    example: 'silver',
    enum: ['gold', 'silver', 'bronze', 'starter'],
  })
  tier: ReputationTier;

  @ApiProperty({
    description: 'Annual interest rate percentage based on reputation tier',
    example: 8,
  })
  interestRate: number;

  @ApiProperty({
    description: 'Maximum credit limit in USD based on reputation tier',
    example: 3000,
  })
  maxCredit: number;

  @ApiProperty({
    description: 'ISO 8601 timestamp of when the score was last read from chain',
    example: '2026-02-13T10:00:00.000Z',
  })
  lastUpdated: string;
}
