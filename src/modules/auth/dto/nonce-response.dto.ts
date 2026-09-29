import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO for the nonce endpoint.
 * Returns the generated nonce and its expiration time.
 */
export class NonceResponseDto {
  @ApiProperty({
    description: 'Cryptographically secure nonce to be signed by the wallet',
    example: 'a1b2c3d4e5f67890abcdef1234567890a1b2c3d4e5f67890abcdef1234567890',
  })
  nonce: string;

  @ApiProperty({
    description: 'ISO 8601 timestamp when the nonce expires (5 minutes from creation)',
    example: '2026-02-13T10:05:00.000Z',
  })
  expiresAt: string;

  @ApiProperty({
    description:
      'Canonical StepFi challenge message the wallet must sign. Contains domain, address, ' +
      'statement, uri, version, nonce, issuedAt, expirationTime and networkPassphrase, ' +
      'binding the signature to this API and environment. Echo it back in POST /auth/verify.',
    example:
      '{\n  "domain": "stepfi-api.onrender.com",\n  "address": "G...",\n  "statement": "StepFi requests...",\n  "uri": "https://stepfi-api.onrender.com/api/v1/auth/verify",\n  "version": "1.0.0",\n  "nonce": "a1b2c3d4e5f67890abcdef1234567890a1b2c3d4e5f67890abcdef1234567890",\n  "issuedAt": "2026-08-25T12:00:00.000Z",\n  "expirationTime": "2026-08-25T12:05:00.000Z",\n  "networkPassphrase": "Test SDF Network ; September 2015"\n}',
  })
  message: string;

  @ApiProperty({
    description:
      'Base64-encoded SEP-10-style challenge transaction (unsigned envelope XDR) bound to ' +
      'this nonce. Wallets that only expose transaction signing (e.g. mobile Lobstr over ' +
      'WalletConnect stellar_signXDR) sign this and return it as `signedXdr` with ' +
      '`signatureType: "sep0010"` in POST /auth/verify. Its single manageData operation ' +
      'value equals the SHA-256 hash of `message`, binding the transaction to this challenge.',
    example: 'AAAAAgAAAAD...==',
  })
  challengeXdr: string;
}
