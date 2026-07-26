import { Test, TestingModule } from '@nestjs/testing';
import { CreditScoringService, CREDIT_TIERS, AssessParams } from '../../../../src/modules/credit-scoring/credit-scoring.service';

describe('CreditScoringService', () => {
  let service: CreditScoringService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CreditScoringService],
    }).compile();

    service = module.get<CreditScoringService>(CreditScoringService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('CREDIT_TIERS — contract alignment', () => {
    it('should match the authoritative tier table from parameters-contract', () => {
      expect(CREDIT_TIERS).toEqual([
        { minScore: 90, tier: 'gold', interestRate: 4, maxCredit: 10_000 },
        { minScore: 75, tier: 'silver', interestRate: 6, maxCredit: 5_000 },
        { minScore: 60, tier: 'bronze', interestRate: 8, maxCredit: 2_500 },
        { minScore: 0, tier: 'starter', interestRate: 10, maxCredit: 1_000 },
      ]);
    });

    it('should have exactly four tiers', () => {
      expect(CREDIT_TIERS).toHaveLength(4);
    });

    it('should have tiers in descending minScore order', () => {
      const scores = CREDIT_TIERS.map((t) => t.minScore);
      expect(scores).toEqual([90, 75, 60, 0]);
    });

    it('should have unique tier names', () => {
      const names = CREDIT_TIERS.map((t) => t.tier);
      expect(new Set(names).size).toBe(CREDIT_TIERS.length);
    });

    it('should have positive maxCredit for every tier', () => {
      for (const tier of CREDIT_TIERS) {
        expect(tier.maxCredit).toBeGreaterThan(0);
      }
    });
  });

  describe('resolveTier — boundary scores', () => {
    it('should resolve score 90 to gold', () => {
      const result = service.resolveTier(90);
      expect(result).toEqual({ tier: 'gold', interestRate: 4, maxCredit: 10_000 });
    });

    it('should resolve score 89 to silver', () => {
      const result = service.resolveTier(89);
      expect(result).toEqual({ tier: 'silver', interestRate: 6, maxCredit: 5_000 });
    });

    it('should resolve score 75 to silver', () => {
      const result = service.resolveTier(75);
      expect(result).toEqual({ tier: 'silver', interestRate: 6, maxCredit: 5_000 });
    });

    it('should resolve score 74 to bronze', () => {
      const result = service.resolveTier(74);
      expect(result).toEqual({ tier: 'bronze', interestRate: 8, maxCredit: 2_500 });
    });

    it('should resolve score 60 to bronze', () => {
      const result = service.resolveTier(60);
      expect(result).toEqual({ tier: 'bronze', interestRate: 8, maxCredit: 2_500 });
    });

    it('should resolve score 59 to starter', () => {
      const result = service.resolveTier(59);
      expect(result).toEqual({ tier: 'starter', interestRate: 10, maxCredit: 1_000 });
    });

    it('should resolve score 100 to gold', () => {
      const result = service.resolveTier(100);
      expect(result).toEqual({ tier: 'gold', interestRate: 4, maxCredit: 10_000 });
    });

    it('should resolve score 0 to starter', () => {
      const result = service.resolveTier(0);
      expect(result).toEqual({ tier: 'starter', interestRate: 10, maxCredit: 1_000 });
    });

    it('should clamp negative scores to starter', () => {
      const result = service.resolveTier(-10);
      expect(result).toEqual({ tier: 'starter', interestRate: 10, maxCredit: 1_000 });
    });

    it('should clamp scores above 100 to gold', () => {
      const result = service.resolveTier(150);
      expect(result).toEqual({ tier: 'gold', interestRate: 4, maxCredit: 10_000 });
    });

    it('should resolve score 99 to gold', () => {
      const result = service.resolveTier(99);
      expect(result.tier).toBe('gold');
    });

    it('should resolve score 1 to starter', () => {
      const result = service.resolveTier(1);
      expect(result.tier).toBe('starter');
    });
  });

  describe('resolveTier — tier boundaries match contracts', () => {
    it('gold tier covers scores 90-100', () => {
      for (const score of [90, 91, 95, 99, 100]) {
        const result = service.resolveTier(score);
        expect(result.tier).toBe('gold');
        expect(result.maxCredit).toBe(10_000);
        expect(result.interestRate).toBe(4);
      }
    });

    it('silver tier covers scores 75-89', () => {
      for (const score of [75, 76, 80, 85, 89]) {
        const result = service.resolveTier(score);
        expect(result.tier).toBe('silver');
        expect(result.maxCredit).toBe(5_000);
        expect(result.interestRate).toBe(6);
      }
    });

    it('bronze tier covers scores 60-74', () => {
      for (const score of [60, 61, 65, 70, 74]) {
        const result = service.resolveTier(score);
        expect(result.tier).toBe('bronze');
        expect(result.maxCredit).toBe(2_500);
        expect(result.interestRate).toBe(8);
      }
    });

    it('starter tier covers scores 0-59', () => {
      for (const score of [0, 1, 30, 50, 59]) {
        const result = service.resolveTier(score);
        expect(result.tier).toBe('starter');
        expect(result.maxCredit).toBe(1_000);
        expect(result.interestRate).toBe(10);
      }
    });
  });

  describe('assess', () => {
    function makeParams(overrides: Partial<AssessParams> = {}): AssessParams {
      return {
        amount: 500,
        reputationScore: 75,
        maxCredit: 5000,
        creditUtilization: 0.3,
        ...overrides,
      };
    }

    it('should auto-approve gold tier users with low utilization', () => {
      const result = service.assess(makeParams({ reputationScore: 95, maxCredit: 10000 }));
      expect(result.decision).toBe('approved');
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toContain('Strong reputation score');
    });

    it('should auto-approve silver tier users with low utilization', () => {
      const result = service.assess(makeParams({ reputationScore: 85, maxCredit: 5000 }));
      expect(result.decision).toBe('approved');
    });

    it('should auto-approve when score is exactly 75 with good parameters', () => {
      const result = service.assess(makeParams({ reputationScore: 75, amount: 200, maxCredit: 5000 }));
      expect(result.decision).toBe('approved');
    });

    it('should reject when reputation score is below 60', () => {
      const result = service.assess(makeParams({ reputationScore: 45 }));
      expect(result.decision).toBe('rejected');
      expect(result.reasons[0]).toContain('below the minimum threshold');
    });

    it('should reject when reputation score is exactly 59', () => {
      const result = service.assess(makeParams({ reputationScore: 59 }));
      expect(result.decision).toBe('rejected');
    });

    it('should reject when amount exceeds max credit', () => {
      const result = service.assess(makeParams({ reputationScore: 80, amount: 5001, maxCredit: 5000 }));
      expect(result.decision).toBe('rejected');
      expect(result.reasons[0]).toContain('exceeds maximum credit limit');
    });

    it('should flag for manual review when amount exceeds 80% of credit limit', () => {
      const result = service.assess(makeParams({ reputationScore: 85, amount: 4500, maxCredit: 5000 }));
      expect(result.decision).toBe('manual_review');
      expect(result.reasons[0]).toContain('exceeds 80% of credit limit');
    });

    it('should flag for manual review when credit utilization exceeds 70%', () => {
      const result = service.assess(makeParams({ reputationScore: 85, amount: 500, maxCredit: 5000, creditUtilization: 0.75 }));
      expect(result.decision).toBe('manual_review');
      expect(result.reasons[0]).toContain('exceeds 70% threshold');
    });

    it('should flag for manual review with multiple reasons when both conditions apply', () => {
      const result = service.assess(makeParams({ reputationScore: 85, amount: 4500, maxCredit: 5000, creditUtilization: 0.8 }));
      expect(result.decision).toBe('manual_review');
      expect(result.reasons).toHaveLength(2);
    });

    it('should flag bronze tier for manual review', () => {
      const result = service.assess(makeParams({ reputationScore: 65, maxCredit: 2500 }));
      expect(result.decision).toBe('manual_review');
      expect(result.reasons[0]).toContain('Bronze tier');
    });

    it('should flag score of exactly 60 for manual review', () => {
      const result = service.assess(makeParams({ reputationScore: 60, maxCredit: 2500 }));
      expect(result.decision).toBe('manual_review');
    });

    it('should flag score of exactly 74 for manual review', () => {
      const result = service.assess(makeParams({ reputationScore: 74, maxCredit: 2500 }));
      expect(result.decision).toBe('manual_review');
    });

    it('should flag score of exactly 75 with high utilization for manual review', () => {
      const result = service.assess(makeParams({ reputationScore: 75, amount: 500, maxCredit: 5000, creditUtilization: 0.8 }));
      expect(result.decision).toBe('manual_review');
    });

    it('should include the reputation score in the result', () => {
      const result = service.assess(makeParams({ reputationScore: 80 }));
      expect(result.score).toBe(80);
    });
  });
});
