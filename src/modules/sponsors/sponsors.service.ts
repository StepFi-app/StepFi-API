import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.client';
import { LiquidityPoolContractClient } from '../../stellar/contracts/clients/liquidity-pool.client';
import {
  CreateSponsorDto,
  SponsorDepositDto,
  SponsorResponseDto,
  SponsorStatsDto,
  SponsorType,
} from './dto/sponsor.dto';

interface SponsorPoolRow {
  id: string;
  wallet_address: string;
  org_name: string;
  sponsor_type: SponsorType;
  website: string | null;
  description: string | null;
  total_deposited: string | number;
  available: string | number;
  locked: string | number;
  created_at: string;
}

interface SponsorAggregateRow {
  total_deposited: string | number | null;
  available: string | number | null;
  locked: string | number | null;
}

interface PoolOverview {
  totalDeposited: number;
  totalShares: number;
  utilizationBps: number;
  apyBps: number;
}

const toNumber = (value: string | number | null | undefined): number => {
  if (value === null || value === undefined) {
    return 0;
  }
  return typeof value === 'number' ? value : Number(value);
};

const STROOPS = 10_000_000n;
const LP_FEE_RATIO = 0.85;
const MIN_WITHDRAWAL_SHARES = 1;

@Injectable()
export class SponsorsService {
  private readonly logger = new Logger(SponsorsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly liquidityClient: LiquidityPoolContractClient,
  ) {}

  async register(
    wallet: string,
    dto: CreateSponsorDto,
  ): Promise<SponsorResponseDto> {
    const client = this.supabaseService.getServiceRoleClient();

    const { data: existing, error: existingError } = await client
      .from('sponsor_pools')
      .select('id')
      .eq('wallet_address', wallet)
      .maybeSingle();

    if (existingError) {
      this.logger.error(`Failed to check existing sponsor: ${existingError.message}`);
      throw new Error('Failed to check existing sponsor.');
    }

    if (existing) {
      throw new ConflictException({
        code: 'SPONSOR_ALREADY_REGISTERED',
        message: 'This wallet is already registered as a sponsor.',
      });
    }

    const { data, error } = await client
      .from('sponsor_pools')
      .insert({
        wallet_address: wallet,
        org_name: dto.orgName,
        sponsor_type: dto.sponsorType,
        website: dto.website ?? null,
        description: dto.description ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Failed to register sponsor ${wallet}: ${error?.message}`);
      throw new Error('Failed to register sponsor.');
    }

    this.logger.log(`Sponsor registered: ${wallet} (${dto.orgName})`);
    return this.mapToDto(data as SponsorPoolRow);
  }

  async deposit(
    wallet: string,
    dto: SponsorDepositDto,
  ): Promise<{ unsignedXdr: string }> {
    const unsignedXdr = await this.buildDepositXdr(wallet, dto.amount);
    return { unsignedXdr };
  }

  async getMyPool(wallet: string): Promise<SponsorResponseDto> {
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('sponsor_pools')
      .select('*')
      .eq('wallet_address', wallet)
      .single();

    if (error || !data) {
      throw new NotFoundException({
        code: 'SPONSOR_NOT_FOUND',
        message: 'Sponsor pool not found for this wallet.',
      });
    }

    return this.mapToDto(data as SponsorPoolRow);
  }

  async getStats(): Promise<SponsorStatsDto> {
    const client = this.supabaseService.getServiceRoleClient();

    const { data, error, count } = await client
      .from('sponsor_pools')
      .select('total_deposited, available, locked', { count: 'exact' });

    if (error) {
      this.logger.error(`Failed to aggregate sponsor stats: ${error.message}`);
      throw new Error('Failed to aggregate sponsor stats.');
    }

    const rows = (data ?? []) as SponsorAggregateRow[];
    const totals = rows.reduce(
      (acc, row) => {
        acc.totalDeposited += toNumber(row.total_deposited);
        acc.totalAvailable += toNumber(row.available);
        acc.totalLocked += toNumber(row.locked);
        return acc;
      },
      { totalDeposited: 0, totalAvailable: 0, totalLocked: 0 },
    );

    return {
      totalSponsors: count ?? rows.length,
      totalDeposited: totals.totalDeposited,
      totalAvailable: totals.totalAvailable,
      totalLocked: totals.totalLocked,
    };
  }

  async getPool(): Promise<PoolOverview> {
    const [poolStats, activeLoansData] = await Promise.all([
      this.liquidityClient.getPoolStats(),
      this.getActiveLoans(),
    ]);

    const totalDeposited = Number(poolStats.totalLiquidity) / Number(STROOPS);
    const totalShares = Number(poolStats.totalShares) / Number(STROOPS);

    const totalLoaned = activeLoansData.totalLoaned;
    const utilizationBps =
      totalDeposited > 0
        ? Math.round((totalLoaned / totalDeposited) * 10_000)
        : 0;

    const apyBps = Math.round(activeLoansData.estimatedApy * 100);

    return {
      totalDeposited,
      totalShares,
      utilizationBps,
      apyBps,
    };
  }

  async buildDepositXdr(wallet: string, amount: number): Promise<string> {
    if (amount <= 0) {
      throw new BadRequestException({
        code: 'VALIDATION_INVALID_AMOUNT',
        message: 'Deposit amount must be greater than zero.',
      });
    }

    const amountInStroops = BigInt(Math.round(amount * Number(STROOPS)));
    return this.liquidityClient.buildDepositTx(wallet, amountInStroops);
  }

  async buildWithdrawXdr(wallet: string, shares: number): Promise<string> {
    if (shares < MIN_WITHDRAWAL_SHARES) {
      throw new BadRequestException({
        code: 'VALIDATION_INVALID_SHARES',
        message: `Withdrawal shares must be at least ${MIN_WITHDRAWAL_SHARES}.`,
      });
    }

    const sharesInStroops = BigInt(Math.round(shares * Number(STROOPS)));
    return this.liquidityClient.buildWithdrawTx(wallet, sharesInStroops);
  }

  private async getActiveLoans(): Promise<{
    totalLoaned: number;
    estimatedApy: number;
  }> {
    const client = this.supabaseService.getServiceRoleClient();

    const { data, error } = await client
      .from('loans')
      .select('loan_amount, interest_rate')
      .eq('status', 'active');

    if (error || !data || data.length === 0) {
      if (error) {
        this.logger.warn(`Failed to fetch active loans: ${error.message}`);
      }
      return { totalLoaned: 0, estimatedApy: 0 };
    }

    const totalAmount = data.reduce(
      (sum, loan) => sum + Number(loan.loan_amount),
      0,
    );
    const weightedRate =
      totalAmount > 0
        ? data.reduce(
            (sum, loan) =>
              sum +
              Number(loan.interest_rate) *
                (Number(loan.loan_amount) / totalAmount),
            0,
          )
        : 0;

    return {
      totalLoaned: totalAmount,
      estimatedApy: Math.round(weightedRate * LP_FEE_RATIO * 100) / 100,
    };
  }

  private mapToDto(data: SponsorPoolRow): SponsorResponseDto {
    return {
      id: data.id,
      walletAddress: data.wallet_address,
      orgName: data.org_name,
      sponsorType: data.sponsor_type,
      website: data.website ?? undefined,
      description: data.description ?? undefined,
      totalDeposited: toNumber(data.total_deposited),
      available: toNumber(data.available),
      locked: toNumber(data.locked),
      createdAt: data.created_at,
    };
  }
}