import { Test, TestingModule } from '@nestjs/testing';
import { CreditScoringService } from '../../../../src/modules/credit-scoring/credit-scoring.service';
import { AssessParams } from '../../../../src/modules/credit-scoring/credit-scoring.service';

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

  function makeParams(overrides: Partial<AssessParams> = {}): AssessParams {
    return {
      amount: 500,
      reputationScore: 75,
      maxCredit: 3000,
      creditUtilization: 0.3,
      ...overrides,
    };
  }

  describe('assess', () => {
    it('should auto-approve gold tier users with low utilization', () => {
      const result = service.assess(makeParams({ reputationScore: 95, maxCredit: 5000 }));
      expect(result.decision).toBe('approved');
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toContain('Strong reputation score');
    });

    it('should auto-approve silver tier users with low utilization', () => {
      const result = service.assess(makeParams({ reputationScore: 85, maxCredit: 3000 }));
      expect(result.decision).toBe('approved');
    });

    it('should auto-approve when score is exactly 75 with good parameters', () => {
      const result = service.assess(makeParams({ reputationScore: 75, amount: 200, maxCredit: 3000 }));
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
      const result = service.assess(makeParams({ reputationScore: 80, amount: 5000, maxCredit: 3000 }));
      expect(result.decision).toBe('rejected');
      expect(result.reasons[0]).toContain('exceeds maximum credit limit');
    });

    it('should flag for manual review when amount exceeds 80% of credit limit', () => {
      const result = service.assess(makeParams({ reputationScore: 85, amount: 2800, maxCredit: 3000 }));
      expect(result.decision).toBe('manual_review');
      expect(result.reasons[0]).toContain('exceeds 80% of credit limit');
    });

    it('should flag for manual review when credit utilization exceeds 70%', () => {
      const result = service.assess(makeParams({ reputationScore: 85, amount: 500, maxCredit: 3000, creditUtilization: 0.75 }));
      expect(result.decision).toBe('manual_review');
      expect(result.reasons[0]).toContain('exceeds 70% threshold');
    });

    it('should flag for manual review with multiple reasons when both conditions apply', () => {
      const result = service.assess(makeParams({ reputationScore: 85, amount: 2800, maxCredit: 3000, creditUtilization: 0.8 }));
      expect(result.decision).toBe('manual_review');
      expect(result.reasons).toHaveLength(2);
    });

    it('should flag bronze tier for manual review', () => {
      const result = service.assess(makeParams({ reputationScore: 65 }));
      expect(result.decision).toBe('manual_review');
      expect(result.reasons[0]).toContain('Bronze tier');
    });

    it('should flag score of exactly 60 for manual review', () => {
      const result = service.assess(makeParams({ reputationScore: 60 }));
      expect(result.decision).toBe('manual_review');
    });

    it('should flag score of exactly 74 for manual review', () => {
      const result = service.assess(makeParams({ reputationScore: 74 }));
      expect(result.decision).toBe('manual_review');
    });

    it('should flag score of exactly 75 with high utilization for manual review', () => {
      const result = service.assess(makeParams({ reputationScore: 75, amount: 500, maxCredit: 3000, creditUtilization: 0.8 }));
      expect(result.decision).toBe('manual_review');
    });

    it('should include the reputation score in the result', () => {
      const result = service.assess(makeParams({ reputationScore: 80 }));
      expect(result.score).toBe(80);
    });

    it('should return empty reasons when none provided', () => {
      const result = service.assess(makeParams({ reputationScore: 95, maxCredit: 5000 }));
      expect(result.reasons).toBeInstanceOf(Array);
      expect(result.reasons.length).toBeGreaterThan(0);
    });
  });
});
