import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { SupabaseService } from '../../database/supabase.client';
import { LiquidityPoolContractClient } from '../../stellar/contracts/clients/liquidity-pool.client';
import { InvestmentSummaryResponseDto } from './dto/investment-summary-response.dto';
import { LiquidityWithdrawRequestDto } from './dto/liquidity-withdraw-request.dto';
import { LiquidityWithdrawResponseDto } from './dto/liquidity-withdraw-response.dto';
import { LiquidityDepositRequestDto } from './dto/liquidity-deposit-request.dto';
import { LiquidityDepositResponseDto } from './dto/liquidity-deposit-response.dto';
import { PoolOverviewResponseDto } from './dto/pool-overview-response.dto';

const SUMMARY_CACHE_TTL = 60;
const STROOPS = 10_000_000n;
const SHARE_PRICE_BPS = 10_000n;
const LP_FEE_RATIO = 0.85;
const MIN_DEPOSIT_AMOUNT = 10;

@Injectable()
export class LiquidityService {
  private readonly logger = new Logger(LiquidityService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly supabaseService: SupabaseService,
    private readonly liquidityClient: LiquidityPoolContractClient,
  ) {}

  async getInvestmentSummary(wallet: string): Promise<InvestmentSummaryResponseDto> {
    const cacheKey = `liquidity:summary:${wallet}`;

    const cached = await this.cacheManager.get<InvestmentSummaryResponseDto>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache HIT for ${wallet.slice(0, 8)}...`);
      return cached;
    }

    this.logger.debug(`Cache MISS for ${wallet.slice(0, 8)}... - fetching from sources`);

    const [sharesInStroops, poolStats, totalInvested, { activeLoans, estimatedApy }] =
      await Promise.all([
        this.liquidityClient.getLpShares(wallet),
        this.liquidityClient.getPoolStats(),
        this.getTotalInvested(wallet),
        this.getActiveLoansStats(),
      ]);

    const currentValueInStroops =
      sharesInStroops > 0n
        ? await this.liquidityClient.calculateWithdrawal(sharesInStroops)
        : 0n;

    const shares = this.fromStroops(sharesInStroops);
    const currentValue = this.fromStroops(currentValueInStroops);
    const poolSize = this.fromStroops(poolStats.totalLiquidity);

    const earnings = this.roundTo7(currentValue - totalInvested);
    const earningsPercent =
      totalInvested > 0 ? Math.round((earnings / totalInvested) * 10000) / 100 : 0;

    const summary: InvestmentSummaryResponseDto = {
      totalInvested,
      currentValue,
      earnings,
      earningsPercent,
      apy: estimatedApy,
      poolSize,
      activeLoans,
      shares,
    };

    await this.cacheManager.set(cacheKey, summary, SUMMARY_CACHE_TTL);
    return summary;
  }

  async getPoolOverview(): Promise<PoolOverviewResponseDto> {
    const cacheKey = 'liquidity:overview';

    const cached = await this.cacheManager.get<PoolOverviewResponseDto>(cacheKey);
    if (cached) {
      this.logger.debug('Cache HIT for pool overview...');
      return cached;
    }

    this.logger.debug('Cache MISS for pool overview... - fetching from sources');

    const [poolStats, loansStats, totalInvestors] = await Promise.all([
      this.liquidityClient.getPoolStats().catch((err) => {
        this.logger.warn(`Failed to fetch pool stats from contract: ${err.message}`);
        return { totalLiquidity: 0n };
      }),
      this.getActiveLoansStats(),
      this.getTotalUniqueInvestors(),
    ]);

    const totalLiquidity = this.fromStroops(poolStats.totalLiquidity as bigint);
    const utilization =
      totalLiquidity > 0
        ? Math.round((loansStats.totalLoaned / totalLiquidity) * 10000) / 100
        : 0;

    const summary: PoolOverviewResponseDto = {
      totalLiquidity,
      apy: loansStats.estimatedApy,
      utilization,
      totalInvestors,
      activeLoans: loansStats.activeLoans,
    };

    await this.cacheManager.set(cacheKey, summary, SUMMARY_CACHE_TTL);
    return summary;
  }

  async depositLiquidity(
    wallet: string,
    dto: LiquidityDepositRequestDto,
  ): Promise<LiquidityDepositResponseDto> {
    if (dto.amount < MIN_DEPOSIT_AMOUNT) {
      throw new BadRequestException({
        code: 'VALIDATION_MINIMUM_DEPOSIT',
        message: `Minimum deposit amount is $${MIN_DEPOSIT_AMOUNT}.`,
      });
    }

    const amountInStroops = this.toStroops(dto.amount);

    const [poolStats, sharesReceived] = await Promise.all([
      this.liquidityClient.getPoolStats(),
      this.liquidityClient.calculateDeposit(amountInStroops),
    ]);

    const unsignedXdr = await this.liquidityClient.buildDepositTx(wallet, amountInStroops);

    const currentTotalLiquidity = this.fromStroops(poolStats.totalLiquidity);
    const currentSharePrice =
      poolStats.totalShares > 0n
        ? this.roundTo7(Number(poolStats.sharePrice) / Number(SHARE_PRICE_BPS))
        : 1;

    return {
      unsignedXdr,
      description: `Deposit $${dto.amount} into liquidity pool`,
      preview: {
        depositAmount: dto.amount,
        sharesReceived: this.fromStroops(sharesReceived),
        currentSharePrice,
        newTotalValue: this.roundTo7(currentTotalLiquidity + dto.amount),
        currentTotalLiquidity,
      },
    };
  }

  async withdrawLiquidity(
    wallet: string,
    dto: LiquidityWithdrawRequestDto,
  ): Promise<LiquidityWithdrawResponseDto> {
    const requestedShares = this.toStroops(dto.shares);

    if (requestedShares <= 0n) {
      throw new BadRequestException({
        code: 'VALIDATION_INVALID_SHARES',
        message: 'Withdrawal shares must be greater than zero.',
      });
    }

    const [ownedShares, poolStats] = await Promise.all([
      this.liquidityClient.getLpShares(wallet),
      this.liquidityClient.getPoolStats(),
    ]);

    if (ownedShares <= 0n || requestedShares > ownedShares) {
      throw new BadRequestException({
        code: 'LIQUIDITY_INSUFFICIENT_SHARES',
        message: 'You do not have enough pool shares to complete this withdrawal.',
      });
    }

    const expectedAmount = await this.liquidityClient.calculateWithdrawal(requestedShares);

    if (expectedAmount > poolStats.availableLiquidity) {
      throw new HttpException(
        {
          code: 'LIQUIDITY_INSUFFICIENT_AVAILABLE_LIQUIDITY',
          message:
            'The pool does not currently have enough liquid funds to satisfy this withdrawal. Please try a smaller amount or wait for liquidity to free up.',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const fee = (expectedAmount * poolStats.withdrawalFeeBps) / SHARE_PRICE_BPS;
    const netAmount = expectedAmount - fee;
    const remainingShares = ownedShares - requestedShares;
    const unsignedXdr = await this.liquidityClient.buildWithdrawTx(wallet, requestedShares);

    return {
      unsignedXdr,
      description: `Withdraw ${this.formatDisplayNumber(requestedShares)} shares from liquidity pool`,
      preview: {
        shares: this.fromStroops(requestedShares),
        ownedShares: this.fromStroops(ownedShares),
        remainingShares: this.fromStroops(remainingShares),
        currentSharePrice: this.roundTo7(Number(poolStats.sharePrice) / Number(SHARE_PRICE_BPS)),
        expectedAmount: this.fromStroops(expectedAmount),
        feeBps: Number(poolStats.withdrawalFeeBps),
        fee: this.fromStroops(fee),
        netAmount: this.fromStroops(netAmount),
        availableLiquidity: this.fromStroops(poolStats.availableLiquidity),
      },
    };
  }

  private async getTotalInvested(wallet: string): Promise<number> {
    const client = this.supabaseService.getServiceRoleClient();

    const { data, error } = await client
      .from('liquidity_positions')
      .select('deposited_amount')
      .eq('provider_wallet', wallet)
      .single();

    if (error || !data) {
      return 0;
    }

    return Number(data.deposited_amount);
  }

  private async getActiveLoansStats(): Promise<{
    activeLoans: number;
    estimatedApy: number;
    totalLoaned: number;
  }> {
    const client = this.supabaseService.getServiceRoleClient();

    const { data, error } = await client
      .from('loans')
      .select('loan_amount, interest_rate')
      .eq('status', 'active');

    if (error || !data || data.length === 0) {
      if (error) {
        this.logger.warn(`Failed to fetch active loans for APY: ${error.message}`);
      }
      return { activeLoans: 0, estimatedApy: 0, totalLoaned: 0 };
    }

    const activeLoans = data.length;
    const totalAmount = data.reduce((sum, loan) => sum + Number(loan.loan_amount), 0);
    const weightedRate =
      totalAmount > 0
        ? data.reduce(
            (sum, loan) =>
              sum + Number(loan.interest_rate) * (Number(loan.loan_amount) / totalAmount),
            0,
          )
        : 0;

    return {
      activeLoans,
      estimatedApy: Math.round(weightedRate * LP_FEE_RATIO * 100) / 100,
      totalLoaned: totalAmount,
    };
  }

  private async getTotalUniqueInvestors(): Promise<number> {
    const client = this.supabaseService.getServiceRoleClient();

    const { count, error } = await client
      .from('liquidity_positions')
      .select('*', { count: 'exact', head: true });

    if (error) {
      this.logger.warn(`Failed to fetch investors count: ${error.message}`);
      return 0;
    }

    return count || 0;
  }

  private toStroops(value: number): bigint {
    return BigInt(Math.round(value * Number(STROOPS)));
  }

  private fromStroops(value: bigint): number {
    return this.roundTo7(Number(value) / Number(STROOPS));
  }

  private roundTo7(value: number): number {
    return Math.round(value * Number(STROOPS)) / Number(STROOPS);
  }

  private formatDisplayNumber(value: bigint): string {
    const normalized = this.fromStroops(value);
    return Number.isInteger(normalized) ? String(normalized) : normalized.toString();
  }
}
