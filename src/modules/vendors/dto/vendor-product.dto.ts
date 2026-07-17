import { IsString, IsOptional, IsNumber, Min, Length, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVendorProductDto {
  @ApiProperty({ example: 'Intro to Solidity Course' })
  @IsString()
  @Length(1, 200)
  name: string;

  @ApiProperty({ example: 199.99 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 'course' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ example: 'A 6-week beginner-friendly course.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateVendorProductDto {
  @ApiPropertyOptional({ example: 'Intro to Solidity Course' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @ApiPropertyOptional({ example: 149.99 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ example: 'course' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ example: 'Updated course description.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class VendorProductDto {
  @ApiProperty() id: string;
  @ApiProperty() vendorId: string;
  @ApiProperty() name: string;
  @ApiProperty({ example: 199.99 }) price: number;
  @ApiPropertyOptional({ nullable: true }) category?: string | null;
  @ApiPropertyOptional({ nullable: true }) description?: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
}
