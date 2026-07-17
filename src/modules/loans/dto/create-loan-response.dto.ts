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
}
