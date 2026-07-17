import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches, MinLength, Equals, IsOptional } from 'class-validator';

export class RegisterRequestDto {
  @ApiProperty({ description: 'Stellar wallet address starting with G, 56 characters total' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^G[A-Z0-9]{55}$/, { message: 'Invalid Stellar wallet address format' })
  walletAddress: string;

  @ApiProperty({ description: 'Unique username, minimum 3 characters, alphanumeric and underscore only' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'Username can only contain alphanumeric characters and underscores' })
  username: string;

  @ApiProperty({ description: 'Display name, minimum 2 characters' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  displayName: string;

  @ApiProperty({ description: 'Must accept terms and conditions', example: 'true' })
  @IsNotEmpty()
  @Equals('true', { message: 'Terms must be accepted' })
  termsAccepted: string;

  @ApiPropertyOptional({ type: 'string', format: 'binary', description: 'Profile image (JPEG, PNG, WebP, max 2MB)' })
  @IsOptional()
  profileImage?: unknown;
}
