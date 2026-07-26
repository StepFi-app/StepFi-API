import { Injectable } from '@nestjs/common';
import { CreditAssessmentResultDto } from './dto/credit-scoring-response.dto';

export interface AssessParams {
  amount: number;
  reputationScore: number;
  maxCredit: number;
  creditUtilization: number;
}

export interface CreditTier {
  minScore: number;
  tier: 'gold' | 'silver' | 'bronze' | 'starter';
  interestRate: number;
  maxCredit: number;
}

/**
 * Authoritative credit tier definitions matching the parameters-contract
 * deployed on Stellar testnet. The contracts enforce these exact values —
 * the API must match, not the reverse.
 *
 * Source: context/architecture-context.md → StepFi-Contracts → Reputation → Credit Tiers
 */
export const CREDIT_TIERS: readonly CreditTier[] = [
  { minScore: 90, tier: 'gold', interestRate: 4, maxCredit: 10_000 },
  { minScore: 75, tier: 'silver', interestRate: 6, maxCredit: 5_000 },
  { minScore: 60, tier: 'bronze', interestRate: 8, maxCredit: 2_500 },
  { minScore: 0, tier: 'starter', interestRate: 10, maxCredit: 1_000 },
] as const;

@Injectable()
export class CreditScoringService {
  /**
   * Resolves a reputation score to its canonical credit tier, interest rate,
   * and credit limit. This is the single source of truth for tier resolution
   * across the entire API.
   */
  resolveTier(score: number): { tier: CreditTier['tier']; interestRate: number; maxCredit: number } {
    const normalizedScore = Math.max(0, Math.min(100, score));

    for (const tier of CREDIT_TIERS) {
      if (normalizedScore >= tier.minScore) {
        return { tier: tier.tier, interestRate: tier.interestRate, maxCredit: tier.maxCredit };
      }
    }

    // Should never reach here, but return starter as the lowest tier
    return { tier: 'starter', interestRate: 10, maxCredit: 1_000 };
  }

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
