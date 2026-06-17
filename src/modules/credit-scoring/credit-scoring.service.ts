import { Injectable } from '@nestjs/common';
import { CreditAssessmentResultDto } from './dto/credit-scoring-response.dto';

export interface AssessParams {
  amount: number;
  reputationScore: number;
  maxCredit: number;
  creditUtilization: number;
}

@Injectable()
export class CreditScoringService {
  assess(params: AssessParams): CreditAssessmentResultDto {
    const { amount, reputationScore, maxCredit, creditUtilization } = params;
    const reasons: string[] = [];

    if (reputationScore < 60) {
      reasons.push(
        `Reputation score ${reputationScore} is below the minimum threshold of 60`,
      );
      return { decision: 'rejected', score: reputationScore, reasons };
    }

    if (amount > maxCredit) {
      reasons.push(
        `Loan amount $${amount} exceeds maximum credit limit of $${maxCredit}`,
      );
      return { decision: 'rejected', score: reputationScore, reasons };
    }

    if (
      reputationScore >= 75 &&
      amount <= maxCredit * 0.8 &&
      creditUtilization < 0.7
    ) {
      reasons.push(
        `Strong reputation score of ${reputationScore} with sufficient available credit`,
      );
      return { decision: 'approved', score: reputationScore, reasons };
    }

    if (reputationScore >= 75) {
      if (amount > maxCredit * 0.8) {
        reasons.push(
          `Loan amount ($${amount}) exceeds 80% of credit limit ($${maxCredit})`,
        );
      }
      if (creditUtilization >= 0.7) {
        reasons.push(
          `Credit utilization at ${Math.round(creditUtilization * 100)}% exceeds 70% threshold`,
        );
      }
      return { decision: 'manual_review', score: reputationScore, reasons };
    }

    reasons.push(
      `Bronze tier reputation score (${reputationScore}) requires manual review`,
    );
    return { decision: 'manual_review', score: reputationScore, reasons };
  }
}
