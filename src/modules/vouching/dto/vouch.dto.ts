import { IsString, IsOptional, Matches, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum VouchStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

export class RequestVouchDto {
  @ApiProperty({
    example: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF',
    description: 'Mentor Stellar wallet address (G... 56 chars)',
  })
  @IsString()
  @Length(56, 56)
  @Matches(STELLAR_ADDRESS_REGEX, { message: 'mentorWallet must be a valid Stellar address (G...)' })
  mentorWallet: string;

  @ApiPropertyOptional({ example: 'Please vouch for me to boost my credit limit.' })
  @IsOptional()
  @IsString()
  message?: string;
}

export class ApproveVouchDto {
  @ApiProperty({
    example: 'GLEARNER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',
    description: 'Learner Stellar wallet address (G... 56 chars)',
  })
  @IsString()
  @Length(56, 56)
  @Matches(STELLAR_ADDRESS_REGEX, { message: 'learnerWallet must be a valid Stellar address (G...)' })
  learnerWallet: string;
}

export class VouchResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() mentorWallet: string;
  @ApiProperty() learnerWallet: string;
  @ApiPropertyOptional() message?: string;
  @ApiProperty({ enum: VouchStatus }) status: VouchStatus;
  @ApiProperty() createdAt: string;
  @ApiProperty() expiresAt: string;
}

export class VouchRequestItemDto {
  @ApiProperty({
    description: 'Learner Stellar wallet address',
    example: 'GALPHABCDEFGHIJKLMNOPQRSTUVWXYZ23456789ABCDEFGHIJKLMN',
  })
  learnerWallet: string;

  @ApiProperty({
    description: 'Learner reputation score (0-100)',
    example: 72,
  })
  reputationScore: number;

  @ApiProperty({
    description: 'Requested loan amount in USD',
    example: 500,
    nullable: true,
  })
  requestedLoanAmount: number | null;

  @ApiProperty({
    description: 'Loan purpose or message from the learner',
    example: 'Need a loan for inventory restocking',
    nullable: true,
  })
  loanPurpose: string | null;

  @ApiProperty({
    description: 'ISO 8601 timestamp when the vouch was requested',
    example: '2026-06-19T12:00:00.000Z',
  })
  requestedAt: string;
}
