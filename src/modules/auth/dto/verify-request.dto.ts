import { IsString, IsNotEmpty, Matches, Length, IsOptional, IsIn, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO for verifying a Stellar wallet signature and issuing JWT tokens.
 * The client must first request a nonce via POST /auth/nonce, sign the
 * returned challenge message with their wallet private key, then submit
 * it here.
 *
 * Every accepted signature must be over the domain-bound challenge message
 * issued by POST /auth/nonce (bound to the nonce row via a stored hash).
 * The legacy 'raw' scheme (signing the bare nonce hex) is deprecated and
 * only accepted while AUTH_ALLOW_LEGACY_RAW_SIGNATURES is enabled.
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
      'Base64-encoded Ed25519 signature over the challenge message (or, for the deprecated raw scheme, over the nonce bytes). ' +
      'Not used for signatureType sep0010, where the signature is carried inside signedXdr.',
    example: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    required: false,
  })
  @ValidateIf((o: VerifyRequestDto) => o.signatureType !== 'sep0010')
  @IsString()
  @IsNotEmpty({ message: 'Signature is required' })
  signature?: string;

  @ApiProperty({
    description:
      "Signature scheme. 'sep0043' — browser wallets (SEP-53: SHA-256 of \"Stellar Signed Message:\\n\" + envelope). 'envelope' — native clients signing the canonical envelope with raw Ed25519. 'sep0010' — SEP-10-style challenge transaction, wallet signs the server-issued challengeXdr and returns it as signedXdr (works with transaction-only wallets such as mobile Lobstr). 'raw' — legacy, signature over the bare nonce hex (deprecated, flag-gated).",
    example: 'envelope',
    required: false,
    enum: ['raw', 'sep0043', 'envelope', 'sep0010'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['raw', 'sep0043', 'envelope', 'sep0010'])
  signatureType?: 'raw' | 'sep0043' | 'envelope' | 'sep0010' = 'raw';

  @ApiProperty({
    description:
      'Base64-encoded signed challenge transaction envelope XDR (required for signatureType sep0010). ' +
      'This is the challengeXdr from POST /auth/nonce after signing it with the wallet. The server ' +
      'verifies the transaction matches the issued challenge and carries a valid wallet signature.',
    example: 'AAAAAgAAAAD...==',
    required: false,
  })
  @ValidateIf((o: VerifyRequestDto) => o.signatureType === 'sep0010')
  @IsString()
  @IsNotEmpty({ message: 'Signed transaction is required for sep0010' })
  @MaxLength(8192, { message: 'Signed transaction must be at most 8192 characters' })
  signedXdr?: string;

  @ApiProperty({
    description:
      'Exact challenge message returned by POST /auth/nonce (required for signatureType sep0043/envelope). ' +
      'When omitted, the server reconstructs the canonical challenge from the stored nonce row. ' +
      'The server only verifies signatures against a message whose digest matches the stored challenge hash.',
    example:
      '{\n  "domain": "stepfi-api.onrender.com",\n  "address": "G...",\n  "statement": "StepFi requests...",\n  "uri": "https://stepfi-api.onrender.com/api/v1/auth/verify",\n  "version": "1.0.0",\n  "nonce": "a1b2c3d4e5f67890abcdef1234567890a1b2c3d4e5f67890abcdef1234567890",\n  "issuedAt": "2026-08-25T12:00:00.000Z",\n  "expirationTime": "2026-08-25T12:05:00.000Z",\n  "networkPassphrase": "Test SDF Network ; September 2015"\n}',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Message must not be empty when provided' })
  @MaxLength(2048, { message: 'Message must be at most 2048 characters' })
  message?: string;
}
