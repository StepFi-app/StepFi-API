import { ApiProperty } from '@nestjs/swagger';

export class PaginationMetaDto {
  @ApiProperty({ description: 'Number of items per page', example: 20 })
  limit: number;

  @ApiProperty({ description: 'Number of items skipped', example: 0 })
  offset: number;

  @ApiProperty({ description: 'Total number of items matching the query', example: 42 })
  total: number;
}

export class PaginatedResponseDto<T> {
  @ApiProperty({ description: 'Indicates whether the request was successful', example: true })
  success: boolean;

  data: T[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;

  @ApiProperty({ example: 'Resources retrieved successfully' })
  message: string;
}
