import { ApiProperty } from '@nestjs/swagger';

export type AssessmentDecision = 'approved' | 'rejected' | 'manual_review';

export class CreditAssessmentResultDto {
  @ApiProperty({
    description: 'Assessment decision',
    enum: ['approved', 'rejected', 'manual_review'],
  })
  decision: AssessmentDecision;

  @ApiProperty({
    description: 'Reputation score used for assessment',
    example: 75,
  })
  score: number;

  @ApiProperty({
    description: 'Reasons for the assessment decision',
    example: ['Strong reputation score of 75 with sufficient available credit'],
  })
  reasons: string[];
}
