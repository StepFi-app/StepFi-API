import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { BlockchainService } from '../blockchain/blockchain.service';
import { LoansService } from './loans.service';
import { LoanQuoteRequestDto } from './dto/loan-quote-request.dto';
import { LoanQuoteResponseDto } from './dto/loan-quote-response.dto';
import { CreateLoanRequestDto } from './dto/create-loan-request.dto';
import { CreateLoanResponseDto } from './dto/create-loan-response.dto';
import { LoanPaymentRequestDto } from './dto/loan-payment-request.dto';
import { LoanPaymentResponseDto } from './dto/loan-payment-response.dto';
import { AvailableCreditResponseDto } from './dto/available-credit-response.dto';
import { LoanListQueryDto, LoanListStatusFilter } from './dto/loan-list-query.dto';
import { LoanListResponseDto } from './dto/loan-list-response.dto';
import { LoanStatsResponseDto } from './dto/loan-stats-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('loans')
@Controller('loans')
export class LoansController {
  constructor(
    private readonly loansService: LoansService,
    private readonly blockchainService: BlockchainService,
  ) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Calculate loan quote',
    description:
      'Calculates loan terms (interest rate, repayment schedule, total cost) based on user reputation without creating an actual loan on-chain. Requires JWT authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'Loan quote calculated successfully',
    type: LoanQuoteResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input or amount exceeds credit limit' })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  async getLoanQuote(
    @CurrentUser() user: { wallet: string },
    @Body() dto: LoanQuoteRequestDto,
  ) {
    const data = await this.loansService.calculateLoanQuote(user.wallet, dto);
    return { success: true, data, message: 'Loan quote calculated successfully' };
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get protocol-wide loan statistics',
    description:
      'Returns aggregated loan counts and volume across all users. No authentication required.',
  })
  @ApiResponse({
    status: 200,
    description: 'Loan statistics retrieved successfully',
    type: LoanStatsResponseDto,
  })
  async getStats() {
    const data = await this.loansService.getStats();
    return { success: true, data, message: 'Loan statistics retrieved successfully' };
  }

  @Get('my-loans')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List loans for the authenticated user',
    description:
      'Returns paginated loans for the authenticated user ordered by creation date (newest first). Supports filtering by active, completed, or defaulted status and includes vendor information plus payment summary fields.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: LoanListStatusFilter,
    description: 'Filter loans by status',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Page size (default 20, max 100)',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of records to skip (default 0)',
  })
  @ApiResponse({
    status: 200,
    description: 'User loans retrieved successfully',
    type: LoanListResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid status or pagination parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing or invalid JWT' })
  async getMyLoans(
    @CurrentUser() user: { wallet: string },
    @Query() query: LoanListQueryDto,
  ) {
    const data = await this.loansService.getMyLoans(user.wallet, query);
    return { success: true, ...data };
  }

  @Get('available-credit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get available credit for the authenticated user',
    description:
      'Reads the current reputation score from the reputation contract, sums outstanding balances from active loans, and returns the user borrowing capacity breakdown.',
  })
  @ApiResponse({
    status: 200,
    description: 'Available credit calculated successfully',
    type: AvailableCreditResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing or invalid JWT' })
  @ApiResponse({ status: 503, description: 'Reputation contract temporarily unavailable' })
  async getAvailableCredit(@CurrentUser() user: { wallet: string }) {
    const data = await this.loansService.getAvailableCredit(user.wallet);
    return { success: true, data, message: 'Available credit calculated successfully' };
  }

  @Post('create')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create BNPL loan',
    description:
      'Creates a pending BNPL loan record and returns an unsigned Soroban XDR transaction for the authenticated user to sign.',
  })
  @ApiResponse({
    status: 200,
    description: 'Pending loan created and unsigned transaction generated successfully',
    type: CreateLoanResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input, insufficient reputation, or amount exceeds credit limit',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  @ApiResponse({ status: 500, description: 'Failed to construct XDR or persist pending loan' })
  async createLoan(
    @CurrentUser() user: { wallet: string },
    @Body() dto: CreateLoanRequestDto,
  ) {
    const data = await this.loansService.createLoan(user.wallet, dto);
    return { success: true, data, message: 'Pending loan created successfully' };
  }

  @Post(':loanId/pay')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'loanId',
    description: 'UUID of the loan to repay',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiOperation({
    summary: 'Make a loan repayment',
    description:
      'Validates the payment, constructs an unsigned Soroban repay_loan() transaction, and returns it alongside a payment preview. The mobile app must sign the XDR and submit the signed transaction back to the network. Requires JWT authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'Unsigned XDR transaction and payment preview returned successfully',
    type: LoanPaymentResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid payment amount or loan not active' })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing or invalid JWT' })
  @ApiResponse({
    status: 404,
    description: 'Loan not found or does not belong to authenticated user',
  })
  @ApiResponse({ status: 503, description: 'Blockchain contract unavailable' })
  async repayLoan(
    @CurrentUser() user: { wallet: string },
    @Param('loanId', ParseUUIDPipe) loanId: string,
    @Body() dto: LoanPaymentRequestDto,
  ) {
    const data = await this.loansService.repayLoan(user.wallet, loanId, dto);
    return { success: true, data, message: 'Repayment transaction constructed successfully' };
  }

  @Post(':loanId/repay')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'loanId',
    description: 'UUID of the loan being repaid',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiOperation({
    summary: 'Submit signed repayment transaction',
    description:
      'Accepts a signed Soroban repay_installment() XDR transaction, submits it to the Stellar network, and waits for ledger confirmation. Returns the transaction hash on success.',
  })
  @ApiResponse({
    status: 200,
    description: 'Repayment transaction submitted and confirmed',
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
        message: { type: 'string', example: 'Repayment submitted and confirmed successfully' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid XDR or loan state' })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing or invalid JWT' })
  @ApiResponse({ status: 503, description: 'Stellar network unavailable or confirmation timeout' })
  async submitRepayment(
    @Param('loanId', ParseUUIDPipe) loanId: string,
    @Body('xdr') signedXdr: string,
  ) {
    const data = await this.blockchainService.submitRepayment(signedXdr);
    return { success: true, data, message: 'Repayment submitted and confirmed successfully' };
  }

  @Post(':loanId/assess')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'loanId',
    description: 'UUID of the loan to assess',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiOperation({
    summary: 'Run credit assessment on a loan',
    description:
      'Runs the credit scoring pipeline on a pending or under_review loan and updates its status based on the assessment result. Auto-approved loans stay pending, auto-rejected loans are marked rejected, and edge cases are flagged for manual review.',
  })
  @ApiResponse({
    status: 200,
    description: 'Loan assessed successfully',
  })
  @ApiResponse({ status: 400, description: 'Loan cannot be assessed in its current status' })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing or invalid JWT' })
  @ApiResponse({ status: 404, description: 'Loan not found or does not belong to user' })
  async assessLoan(
    @CurrentUser() user: { wallet: string },
    @Param('loanId', ParseUUIDPipe) loanId: string,
  ) {
    const data = await this.loansService.assessLoan(user.wallet, loanId);
    return { success: true, data, message: 'Loan assessment completed successfully' };
  }
}
