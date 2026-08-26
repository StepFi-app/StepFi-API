import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { UserRole } from '../../../database/repositories/users.repository';

export class AdminResetRoleDto {
  @ApiPropertyOptional({
    description: 'New role to assign (sponsor | vendor | mentor), or null to reset/remove the role',
    enum: ['sponsor', 'vendor', 'mentor'],
    nullable: true,
  })
  @IsOptional()
  @IsIn(['sponsor', 'vendor', 'mentor', null])
  role?: UserRole | null;
}
