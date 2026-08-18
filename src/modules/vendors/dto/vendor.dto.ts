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
  @ApiProperty({ enum: VendorStatus }) status: VendorStatus;
  @ApiProperty() verified: boolean;
  @ApiPropertyOptional() website?: string;
  @ApiPropertyOptional() country?: string;
  @ApiPropertyOptional() city?: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() createdAt: string;
}

export class VendorActionResponseDto {
  @ApiProperty({ description: 'Unsigned Soroban XDR transaction string to sign' })
  unsignedXdr: string;

  @ApiProperty({ description: 'Human-readable action description' })
  description: string;

  @ApiProperty({ description: 'Target vendor UUID' })
  vendorId: string;

  @ApiProperty({ enum: VendorStatus, description: 'Current vendor status before on-chain confirmation' })
  status: VendorStatus;
}

