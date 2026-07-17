import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum LoanListStatusFilter {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  DEFAULTED = 'defaulted',
  UNDER_REVIEW = 'under_review',
  REJECTED = 'rejected',
}

export class LoanListQueryDto {
  @ApiPropertyOptional({
    description: 'Filter loans by status',
    enum: LoanListStatusFilter,
    example: LoanListStatusFilter.ACTIVE,
  })
  @IsOptional()
  @IsEnum(LoanListStatusFilter, {
    message: 'status must be one of: active, completed, defaulted, under_review, rejected',
  })
  status?: LoanListStatusFilter;

  @ApiPropertyOptional({
    description: 'Maximum number of loans to return',
    example: 20,
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Number of loans to skip for pagination',
    example: 0,
    default: 0,
    minimum: 0,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
