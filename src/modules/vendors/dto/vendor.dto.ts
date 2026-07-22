import { IsString, IsOptional, IsEnum, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum VendorType {
  SCHOOL = 'school',
  BOOTCAMP = 'bootcamp',
  ELECTRONICS = 'electronics',
  BOOKS = 'books',
  SUBSCRIPTIONS = 'subscriptions',
}

export enum VendorStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  SUSPENDED = 'suspended',
  REJECTED = 'rejected',
}

export class CreateVendorDto {
  @ApiProperty({ example: 'University of Lagos' })
  @IsString()
  name: string;

  @ApiProperty({ enum: VendorType })
  @IsEnum(VendorType)
  type: VendorType;

  @ApiPropertyOptional({ example: 'https://unilag.edu.ng' })
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiPropertyOptional({ example: 'Nigeria' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: 'Lagos' })
  @IsOptional()
  @IsString()
  city?: string;
}

export class VendorResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() walletAddress: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: VendorType }) type: VendorType;
  @ApiProperty() verified: boolean;
  @ApiProperty({ enum: VendorStatus }) status: VendorStatus;
  @ApiPropertyOptional() website?: string;
  @ApiPropertyOptional() country?: string;
  @ApiPropertyOptional() city?: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() createdAt: string;
}

export class VendorStatusChangeResponseDto {
  @ApiProperty({ description: 'Unsigned transaction XDR for the admin wallet to sign' })
  unsignedXdr: string;

  @ApiProperty({ example: 'Approve vendor Acme University' })
  description: string;

  @ApiProperty({ description: 'Local vendor UUID' })
  vendorId: string;

  @ApiProperty({ enum: VendorStatus })
  targetStatus: VendorStatus;
}
