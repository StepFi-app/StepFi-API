import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LiquidityService } from './liquidity.service';
import { InvestmentSummaryResponseDto } from './dto/investment-summary-response.dto';
import { PoolOverviewResponseDto } from './dto/pool-overview-response.dto';
import { LiquidityWithdrawRequestDto } from './dto/liquidity-withdraw-request.dto';
import { LiquidityWithdrawResponseDto } from './dto/liquidity-withdraw-response.dto';
import { LiquidityDepositRequestDto } from './dto/liquidity-deposit-request.dto';
import { LiquidityDepositResponseDto } from './dto/liquidity-deposit-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('liquidity')
@Controller('liquidity')
export class LiquidityController {
  constructor(private readonly liquidityService: LiquidityService) {}

  @Get('overview')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get public liquidity pool overview',
    description:
      'Returns general metrics about the liquidity pool without requiring authentication. Includes total liquidity, current APY, utilization rate, total unique investors, and active loans. Data is cached for 1 minute.',
  })
  @ApiResponse({
    status: 200,
    description: 'Pool overview metrics retrieved successfully',
    type: PoolOverviewResponseDto,
  })
  @ApiResponse({ status: 503, description: 'Liquidity contract temporarily unavailable or fallback data used' })
  async getPoolOverview(): Promise<{ success: boolean; data: PoolOverviewResponseDto; message: string }> {
    const data = await this.liquidityService.getPoolOverview();
    return { success: true, data, message: 'Pool overview retrieved successfully' };
  }

  @Get('my-summary')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get personal investment summary',
    description:
      'Returns a comprehensive summary of the authenticated user\'s liquidity pool investment, including share balance, current value, earnings, APY, pool size, and active loan count. Data is cached in Redis with a 1-minute TTL. Users with no investment receive a valid zero-value response.',
  })
  @ApiResponse({
    status: 200,
    description: 'Investment summary retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          totalInvested: 1000,
          currentValue: 1085.5,
          earnings: 85.5,
          earningsPercent: 8.55,
          apy: 9.2,
          poolSize: 2500000,
          activeLoans: 142,
          shares: 950.1234567,
        },
        message: 'Investment summary retrieved successfully',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing or invalid JWT' })
  @ApiResponse({ status: 503, description: 'Liquidity contract temporarily unavailable' })
  async getMyInvestmentSummary(
    @CurrentUser() user: { wallet: string },
  ): Promise<{ success: boolean; data: InvestmentSummaryResponseDto; message: string }> {
    const data = await this.liquidityService.getInvestmentSummary(user.wallet);
    return { success: true, data, message: 'Investment summary retrieved successfully' };
  }

  @Post('deposit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('sponsor')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Construct a liquidity pool deposit transaction',
    description:
      'Validates the deposit amount (minimum $10), queries the pool smart contract for current state, calculates the expected shares the user will receive, and returns an unsigned Soroban deposit() XDR for the client to sign.',
  })
  @ApiResponse({
    status: 200,
    description: 'Unsigned XDR transaction and deposit preview returned successfully',
    type: LiquidityDepositResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid amount or deposit below minimum ($10)' })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing or invalid JWT' })
  @ApiResponse({ status: 503, description: 'Liquidity contract unavailable or network issue' })
  async depositLiquidity(
    @CurrentUser() user: { wallet: string },
    @Body() dto: LiquidityDepositRequestDto,
  ): Promise<{ success: boolean; data: LiquidityDepositResponseDto; message: string }> {
    const data = await this.liquidityService.depositLiquidity(user.wallet, dto);
    return {
      success: true,
      data,
      message: 'Deposit transaction constructed successfully',
    };
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('sponsor')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Construct a liquidity withdrawal transaction',
    description:
      'Validates the authenticated user share balance, checks pool available liquidity, calculates the expected payout and fees, and returns an unsigned Soroban withdraw() XDR for the client to sign.',
  })
  @ApiResponse({
    status: 200,
    description: 'Unsigned XDR transaction and withdrawal preview returned successfully',
    type: LiquidityWithdrawResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid share amount or insufficient shares' })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing or invalid JWT' })
  @ApiResponse({ status: 402, description: 'Pool has insufficient available liquidity' })
  @ApiResponse({ status: 503, description: 'Liquidity contract unavailable or network issue' })
  async withdrawLiquidity(
    @CurrentUser() user: { wallet: string },
    @Body() dto: LiquidityWithdrawRequestDto,
  ): Promise<{ success: boolean; data: LiquidityWithdrawResponseDto; message: string }> {
    const data = await this.liquidityService.withdrawLiquidity(user.wallet, dto);
    return {
      success: true,
      data,
      message: 'Withdrawal transaction constructed successfully',
    };
  }
}
