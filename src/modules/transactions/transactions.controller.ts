import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { SubmitTransactionRequestDto } from './dto/submit-transaction-request.dto';
import { SubmitTransactionResponseDto } from './dto/submit-transaction-response.dto';
import { TransactionStatusResponseDto } from './dto/transaction-status-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Throttle } from '@nestjs/throttler';
import { WalletThrottlerGuard } from './wallet-throttler.guard';

const SUBMIT_RATE_LIMIT = 10;
const SUBMIT_RATE_TTL_MS = 60000;

@ApiTags('transactions')
@Controller('transactions')
export class TransactionsController {
  private static readonly TRANSACTION_HASH_REGEX = /^[a-f0-9]{64}$/i;

  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: SUBMIT_RATE_LIMIT, ttl: SUBMIT_RATE_TTL_MS } })
  @UseGuards(JwtAuthGuard, WalletThrottlerGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Submit a signed XDR transaction to the Stellar network',
    description:
      'Validates that the XDR source account (or Soroban authorization) matches the authenticated wallet and that the operations match the declared type, then persists the transaction record and submits the signed transaction to the Stellar network via Horizon. Returns the hash immediately without waiting for confirmation. Submission is idempotent per transaction hash: re-submitting an already recorded hash returns the original record. Rate limited per wallet and per IP.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Transaction submitted successfully — hash returned with pending status (or the original record when the hash was already submitted)',
    type: SubmitTransactionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Malformed XDR, source account mismatch (TRANSACTION_SOURCE_MISMATCH), operation/type mismatch (TRANSACTION_TYPE_MISMATCH, TRANSACTION_OPERATION_NOT_ALLOWED), or Stellar rejection',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing or invalid JWT' })
  @ApiResponse({ status: 429, description: 'Too many requests - rate limit exceeded (per wallet or per IP)' })
  @ApiResponse({ status: 500, description: 'Failed to persist the transaction record locally (TRANSACTION_PERSISTENCE_FAILED) or an unexpected Stellar submission failure (STELLAR_SUBMISSION_FAILED)' })
  @ApiResponse({ status: 503, description: 'Stellar network temporarily unavailable, or the contract for the declared type is not configured on the server (TRANSACTION_CONTRACT_NOT_CONFIGURED)' })
  async submitTransaction(
    @CurrentUser() user: { wallet: string },
    @Body() dto: SubmitTransactionRequestDto,
  ): Promise<{ success: boolean; data: SubmitTransactionResponseDto; message: string }> {
    const data = await this.transactionsService.submitTransaction(user.wallet, dto);
    return {
      success: true,
      data,
      message: 'Transaction submitted successfully',
    };
  }

  @Get(':hash')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get Stellar transaction status by hash',
    description:
      'Looks up a Stellar transaction in Horizon, normalizes its status to pending/success/failed, and returns cached finalized results when available. This endpoint is public and does not require authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'Transaction status retrieved successfully',
    type: TransactionStatusResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid transaction hash format' })
  @ApiResponse({ status: 404, description: 'Transaction hash not found' })
  @ApiResponse({ status: 503, description: 'Horizon API temporarily unavailable' })
  async getTransactionStatus(
    @Param('hash') hash: string,
  ): Promise<{ success: boolean; data: TransactionStatusResponseDto; message: string }> {
    if (!TransactionsController.TRANSACTION_HASH_REGEX.test(hash)) {
      throw new BadRequestException({
        code: 'TRANSACTION_INVALID_HASH',
        message: 'Transaction hash must be a 64-character hexadecimal string.',
      });
    }

    const data = await this.transactionsService.getTransactionStatus(hash);

    return {
      success: true,
      data,
      message: 'Transaction status retrieved successfully',
    };
  }
}
