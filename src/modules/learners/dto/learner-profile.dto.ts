import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
  Max,
  MinLength,
  MaxLength,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsUrl,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export enum CurrentRole {
  STUDENT = 'Student',
  INTERN = 'Intern',
  EARLY_CAREER_DEV = 'EarlyCareerDev',
  FREELANCER = 'Freelancer',
  EMPLOYED = 'Employed',
}

export enum Skill {
  JAVASCRIPT = 'JavaScript',
  TYPESCRIPT = 'TypeScript',
  RUST = 'Rust',
  PYTHON = 'Python',
  GO = 'Go',
  REACT = 'React',
  REACT_NATIVE = 'React Native',
  NESTJS = 'NestJS',
  SOLIDITY = 'Solidity',
  SOROBAN = 'Soroban',
  DESIGN = 'Design',
  DEVOPS = 'DevOps',
  TESTING = 'Testing',
  TECHNICAL_WRITING = 'Technical Writing',
  OTHER = 'Other',
}

export enum FinanceGoal {
  LAPTOP = 'Laptop',
  COURSE = 'Course',
  BOOTCAMP = 'Bootcamp',
  DEV_TOOLS = 'Dev Tools',
  SUBSCRIPTIONS = 'Subscriptions',
  BOOKS = 'Books',
  OTHER = 'Other',
}

export enum MonthlyIncomeRange {
  NO_INCOME = 'No Income',
  UNDER_500 = 'Under $500',
  RANGE_500_1000 = '$500-$1000',
  RANGE_1000_5000 = '$1000-$5000',
  ABOVE_5000 = 'Above $5000',
}

export class CreateLearnerProfileDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  full_name: string;

  @ApiPropertyOptional({ example: 'I am a passionate learner.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @ApiProperty({ example: 'Nigeria' })
  @IsString()
  country: string;

  @ApiPropertyOptional({ example: 'Lagos' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ enum: CurrentRole })
  @IsOptional()
  @IsEnum(CurrentRole)
  current_role?: CurrentRole;

  @ApiPropertyOptional({ example: 'University of Lagos' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  institution?: string;

  @ApiPropertyOptional({ example: 'Computer Science' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  program?: string;

  @ApiPropertyOptional({ example: 2024 })
  @IsOptional()
  @IsNumber()
  @Min(2020)
  @Max(2035)
  graduation_year?: number;

  @ApiPropertyOptional({ enum: Skill, isArray: true, maxItems: 15 })
  @IsOptional()
  @IsArray()
  @IsEnum(Skill, { each: true })
  @ArrayMaxSize(15)
  skills?: Skill[];

  @ApiProperty({ enum: FinanceGoal, isArray: true, minItems: 1 })
  @IsArray()
  @IsEnum(FinanceGoal, { each: true })
  @ArrayMinSize(1)
  finance_goals: FinanceGoal[];

  @ApiPropertyOptional({ enum: MonthlyIncomeRange })
  @IsOptional()
  @IsEnum(MonthlyIncomeRange)
  monthly_income_range?: MonthlyIncomeRange;

  @ApiPropertyOptional({ example: 'https://github.com/johndoe' })
  @IsOptional()
  @IsUrl()
  github_url?: string;

  @ApiPropertyOptional({ example: 'https://linkedin.com/in/johndoe' })
  @IsOptional()
  @IsUrl()
  linkedin_url?: string;
}

export class UpdateLearnerProfileDto extends PartialType(CreateLearnerProfileDto) {}
