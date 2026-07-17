import { IsString, IsOptional, IsEnum, IsUrl, Length, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VendorType } from './vendor.dto';

/**
 * Body for POST /vendors — a wallet with role='vendor' registering its
 * one-and-only vendor profile.
 *
 * `category` is the client-facing name for the persisted `type` column. It is
 * lower-cased before validation so the frontend may send either 'Electronics'
 * or 'electronics'; the value must resolve to a known {@link VendorType}.
 */
export class RegisterVendorDto {
  @ApiProperty({ example: 'University of Lagos' })
  @IsString()
  @Length(1, 200)
  name: string;

  @ApiProperty({ enum: VendorType, description: 'Vendor category (stored as `type`)' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsEnum(VendorType, {
    message: `category must be one of: ${Object.values(VendorType).join(', ')}`,
  })
  category: VendorType;

  @ApiProperty({ example: 'Nigeria' })
  @IsString()
  @Length(1, 100)
  country: string;

  @ApiPropertyOptional({ example: 'Lagos' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: 'https://unilag.edu.ng' })
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiPropertyOptional({ example: 'Accredited university offering STEM programs.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
