import { validate } from 'class-validator';
import { CreateLearnerProfileDto, CurrentRole, FinanceGoal, Skill } from '../../../../src/modules/learners/dto/learner-profile.dto';

describe('CreateLearnerProfileDto Validation', () => {
  let dto: CreateLearnerProfileDto;

  beforeEach(() => {
    dto = new CreateLearnerProfileDto();
    dto.full_name = 'Test User';
    dto.country = 'Test Country';
    dto.finance_goals = [FinanceGoal.LAPTOP];
  });

  it('should validate a valid dto', async () => {
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail if full_name is missing', async () => {
    delete (dto as any).full_name;
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.property === 'full_name')).toBe(true);
  });

  it('should fail if finance_goals has 0 items', async () => {
    dto.finance_goals = [];
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.property === 'finance_goals')).toBe(true);
  });

  it('should fail if skills has more than 15 items', async () => {
    dto.skills = Array(16).fill(Skill.JAVASCRIPT);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.property === 'skills')).toBe(true);
  });
});
