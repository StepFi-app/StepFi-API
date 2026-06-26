import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CurrentRole, Skill, FinanceGoal, MonthlyIncomeRange } from './learner-profile.dto';

export class LearnerResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() walletAddress: string;
  @ApiPropertyOptional() fullName?: string;
  @ApiPropertyOptional() bio?: string;
  @ApiPropertyOptional() country?: string;
  @ApiPropertyOptional() city?: string;
  @ApiPropertyOptional({ enum: CurrentRole }) currentRole?: CurrentRole;
  @ApiPropertyOptional() institution?: string;
  @ApiPropertyOptional() program?: string;
  @ApiPropertyOptional() graduationYear?: number;
  @ApiPropertyOptional({ enum: Skill, isArray: true }) skills?: Skill[];
  @ApiPropertyOptional({ enum: FinanceGoal, isArray: true }) financeGoals?: FinanceGoal[];
  @ApiPropertyOptional({ enum: MonthlyIncomeRange }) monthlyIncomeRange?: MonthlyIncomeRange;
  @ApiPropertyOptional() githubUrl?: string;
  @ApiPropertyOptional() linkedinUrl?: string;
  @ApiPropertyOptional() profileComplete?: boolean;
  @ApiPropertyOptional() onboardingCompletedAt?: string;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
