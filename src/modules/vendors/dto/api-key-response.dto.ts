import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiKeyResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  vendorId: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'First 8 characters of the API key for identification' })
  keyPrefix: string;

  @ApiProperty({ type: [String] })
  permissions: string[];

  @ApiProperty()
  isActive: boolean;

  @ApiPropertyOptional()
  lastUsedAt?: string;

  @ApiPropertyOptional()
  expiresAt?: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}

export class ApiKeyCreatedResponseDto extends ApiKeyResponseDto {
  @ApiProperty({ description: 'Full API key — this will only be shown once on creation' })
  fullKey: string;
}
