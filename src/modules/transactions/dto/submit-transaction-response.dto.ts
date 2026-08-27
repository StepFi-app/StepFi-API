import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO returned after successfully submitting a transaction to the Stellar network.
 *
 * Submission is idempotent per transaction hash: when the same hash was already
 * recorded locally, the original record is returned (with `duplicate: true`)
 * instead of submitting to Horizon a second time.
 */
export class SubmitTransactionResponseDto {
  @ApiProperty({
    description: 'Stellar transaction hash',
    example: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  })
  transactionHash: string;

  @ApiProperty({
    description:
      'Transaction status. Fresh submissions return `pending`; duplicate submissions return the recorded status of the original record.',
    enum: ['pending', 'success', 'failed'],
    example: 'pending',
  })
  status: 'pending' | 'success' | 'failed';

  @ApiPropertyOptional({
    description:
      'True when the hash was already recorded locally and the original record is returned without re-submitting to Horizon.',
    example: false,
  })
  duplicate?: boolean;
}
