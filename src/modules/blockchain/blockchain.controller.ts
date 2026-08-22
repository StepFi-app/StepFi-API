import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BlockchainService } from './blockchain.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

class SubmitTransactionRequestDto {
  @ApiProperty({
    description: 'Signed XDR transaction string to submit to the Stellar network',
    example: 'AAAAAgAAAAA...',
  })
  @IsString({ message: 'xdr must be a string' })
  @IsNotEmpty({ message: 'xdr must not be empty' })
  xdr: string;

  @ApiProperty({
    description: 'Idempotency key to deduplicate repeated submissions',
    example: 'repay_loan_12345',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'idempotencyKey must be a string' })
  idempotencyKey?: string;
}

@ApiTags('blockchain')
@Controller('blockchain')
export class BlockchainController {
  constructor(private readonly blockchainService: BlockchainService) {}

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Optional idempotency key to deduplicate repeated submissions',
    required: false,
  })
  @ApiOperation({
    summary: 'Submit a signed XDR transaction idempotently',
    description:
      'Validates the XDR, deduplicates by transaction hash, and returns the same response for repeated submissions with the same idempotency key.',
  })
  @ApiResponse({
    status: 200,
    description: 'Transaction submitted successfully',
    schema: {
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          properties: {
            transactionHash: {
              type: 'string',
              example: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
            },
          },
        },
        message: { type: 'string', example: 'Transaction submitted successfully' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid XDR' })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing or invalid JWT' })
  @ApiResponse({ status: 409, description: 'Duplicate transaction or idempotency key in use' })
  @ApiResponse({ status: 503, description: 'Stellar network unavailable or confirmation timeout' })
  async submitTransaction(
    @Body() dto: SubmitTransactionRequestDto,
    @Headers('idempotency-key') idempotencyKeyHeader?: string,
  ): Promise<{ success: boolean; data: { transactionHash: string }; message: string }> {
    const idempotencyKey = dto.idempotencyKey ?? idempotencyKeyHeader;

    if (idempotencyKey !== undefined && idempotencyKey.trim() === '') {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_INVALID',
        message: 'Idempotency key must not be empty.',
      });
    }

    const data = await this.blockchainService.submitRepayment(
      dto.xdr,
      idempotencyKey,
    );

    return {
      success: true,
      data,
      message: 'Transaction submitted successfully',
    };
  }
}
