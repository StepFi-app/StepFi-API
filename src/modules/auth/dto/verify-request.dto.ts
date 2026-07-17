import { IsString, IsNotEmpty, Matches, Length, IsOptional, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for verifying a Stellar wallet signature and issuing JWT tokens.
 * The client must first request a nonce via POST /auth/nonce, sign it
 * with their wallet private key, then submit it here.
 */
export class VerifyRequestDto {
  @ApiProperty({
    description: 'Stellar wallet address (Ed25519 public key, G + 55 chars)',
    example: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
    minLength: 56,
    maxLength: 56,
  })
  @IsString()
  @IsNotEmpty({ message: 'Wallet address is required' })
  @Matches(/^G[A-Z2-7]{55}$/, {
    message:
      'Invalid Stellar wallet address. Must start with G and have 55 base32 characters [A-Z2-7]',
  })
  wallet: string;

  @ApiProperty({
    description: 'Nonce obtained from POST /auth/nonce (64 lowercase hexadecimal characters)',
    example: 'a1b2c3d4e5f67890abcdef1234567890a1b2c3d4e5f67890abcdef1234567890',
    minLength: 64,
    maxLength: 64,
  })
  @IsString()
  @IsNotEmpty({ message: 'Nonce is required' })
  @Length(64, 64, { message: 'Nonce must be exactly 64 characters' })
  @Matches(/^[a-f0-9]{64}$/, {
    message: 'Nonce must be 64 lowercase hexadecimal characters',
  })
  nonce: string;

  @ApiProperty({
    description:
      'Base64-encoded Ed25519 signature of the nonce bytes, signed with the wallet private key',
    example: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  })
  @IsString()
  @IsNotEmpty({ message: 'Signature is required' })
  signature: string;

  @ApiProperty({
    description: "Signature type — 'raw' for raw Ed25519 or 'sep0043' for browser wallets",
    example: 'raw',
    required: false,
    enum: ['raw', 'sep0043'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['raw', 'sep0043'])
  signatureType?: 'raw' | 'sep0043' = 'raw';
}
