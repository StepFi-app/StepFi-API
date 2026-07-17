import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginatedResponseDto, PaginationMetaDto } from '../../../common/dto/paginated-response.dto';

export class AuditLogItemDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiProperty({ example: 'GABCDEF1234567890' })
  actorWallet: string;

  @ApiProperty({ example: 'UPDATE_USER' })
  action: string;

  @ApiProperty({ example: 'users' })
  resource: string;

  @ApiPropertyOptional({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  resourceId: string | null;

  @ApiPropertyOptional({ description: 'State before the mutation' })
  beforeState: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'State after the mutation' })
  afterState: Record<string, unknown> | null;

  @ApiPropertyOptional({ example: '192.168.1.1' })
  ipAddress: string | null;

  @ApiProperty({ example: '2026-06-18T12:00:00.000Z' })
  createdAt: string;
}

export class AuditLogListResponseDto implements PaginatedResponseDto<AuditLogItemDto> {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ type: [AuditLogItemDto] })
  data: AuditLogItemDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;

  @ApiProperty({ example: 'Audit logs retrieved successfully' })
  message: string;
}
