import { ApiProperty } from '@nestjs/swagger';
import { LoanQuoteResponseDto } from './loan-quote-response.dto';
import { CreditAssessmentResultDto } from '../../credit-scoring/dto/credit-scoring-response.dto';

export class CreateLoanResponseDto {
  @ApiProperty({
    description: 'Provisional loan identifier used to track the pending record',
    example: 'pending-1711180800000-ab12cd34',
  })
  loanId: string;

  @ApiProperty({
    description: 'Unsigned Soroban XDR transaction to be signed by the user',
    example: 'AAAAAgAAAAC...',
    nullable: true,
  })
  xdr: string | null;

  @ApiProperty({
    description: 'Human-readable transaction description',
    example: 'Create BNPL loan for $500 at TechStore',
  })
  description: string;

  @ApiProperty({
    description: 'Complete loan preview returned alongside the unsigned transaction',
    type: LoanQuoteResponseDto,
  })
  terms: LoanQuoteResponseDto;

  @ApiProperty({
    description: 'Credit assessment result',
    type: CreditAssessmentResultDto,
    nullable: true,
  })
  assessment: CreditAssessmentResultDto | null;

  @ApiProperty({
    description:
      'Liquidity reservation handle that proves the pool has committed the requested amount until the loan settles (or auto-expires).',
    example: 'resv-pending-1711180800000-ab12cd34-1f9b2d4a-...',
    nullable: true,
  })
  reservationId: string | null;

  @ApiProperty({
    description:
      'ISO 8601 timestamp at which the reservation auto-releases if the loan has not been confirmed on-chain by then.',
    example: '2026-07-17T12:34:56.000Z',
    nullable: true,
  })
  reservationExpiresAt: string | null;

  @ApiProperty({
    description:
      'Effective pool capacity (in USD) used during the reservation check. Useful for the UI to display remaining headroom.',
    example: 8420.5,
    nullable: true,
  })
  reservationPoolCapacityUsd: number | null;
}
