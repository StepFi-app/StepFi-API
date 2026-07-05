import { ApiProperty } from '@nestjs/swagger';
import { PaginatedResponseDto, PaginationMetaDto } from '../../../common/dto/paginated-response.dto';
import { VendorResponseDto } from './vendor.dto';

export class VendorListResponseDto implements PaginatedResponseDto<VendorResponseDto> {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ type: [VendorResponseDto] })
  data: VendorResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination: PaginationMetaDto;

  @ApiProperty({ example: 'Vendors retrieved successfully' })
  message: string;
}
