import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ReputationService } from '../reputation/reputation.service';
import { SupabaseService } from '../../database/supabase.client';
import { CreditLineContractClient } from '../../stellar/contracts/clients/creditline.client';
import { ReputationContractClient } from '../../stellar/contracts/clients/reputation.client';
import { LoanQuoteRequestDto } from './dto/loan-quote-request.dto';
import { LoanQuoteResponseDto, SchedulePaymentDto } from './dto/loan-quote-response.dto';
import { CreateLoanRequestDto } from './dto/create-loan-request.dto';
import { CreateLoanResponseDto } from './dto/create-loan-response.dto';
import { LoanPaymentRequestDto } from './dto/loan-payment-request.dto';
import { LoanPaymentResponseDto } from './dto/loan-payment-response.dto';
import { AvailableCreditResponseDto } from './dto/available-credit-response.dto';
import { LoanListQueryDto, LoanListStatusFilter } from './dto/loan-list-query.dto';
import {
  LoanListItemDto,
  LoanListVendorDto,
  LoanListResponseDto,
} from './dto/loan-list-response.dto';
import { ReputationTier } from '../reputation/dto/reputation-response.dto';

const GUARANTEE_PERCENT = 0.2;
const LOAN_PERCENT = 0.8;
const MIN_LOAN_REPUTATION_SCORE = 60;

interface ValidVendor {
  id: string;
  name: string;
  verified: boolean;
}

interface CreateLoanRecord {
  loan_id: string;
  user_wallet: string;
  vendor_id: string;
  amount: number;
  loan_amount: number;
  guarantee: number;
  interest_rate: number;
  total_repayment: number;
  remaining_balance: number;
  term: number;
  status: 'pending';
  next_payment_due: string | null;
}

interface LoanPaymentRow {
  amount: number | string | null;
}

interface LoanVendorRow {
  id: string | null;
  name: string | null;
}

interface LoanListRow {
  id: string;
  loan_id: string;
  vendor_id: string | null;
  amount: number | string;
  loan_amount: number | string;
  guarantee: number | string;
  interest_rate: number | string;
  total_repayment: number | string;
  remaining_balance: number | string;
  term: number;
  status: LoanListStatusFilter | 'pending';
  next_payment_due: string | null;
  created_at: string;
  completed_at: string | null;
  defaulted_at: string | null;
  vendors?: LoanVendorRow | LoanVendorRow[] | null;
  loan_payments?: LoanPaymentRow[] | null;
}

@Injectable()
export class LoansService {
  private readonly logger = new Logger(LoansService.name);

  constructor(
    private readonly reputationService: ReputationService,
    private readonly supabaseService: SupabaseService,
    private readonly creditLineContractClient: CreditLineContractClient,
    private readonly reputationContractClient: ReputationContractClient,
  ) {}

  async calculateLoanQuote(
    wallet: string,
    dto: LoanQuoteRequestDto,
  ): Promise<LoanQuoteResponseDto> {
    const { terms } = await this.prepareLoanPreview(wallet, dto, false);
    return terms;
  }

  async createLoan(wallet: string, dto: CreateLoanRequestDto): Promise<CreateLoanResponseDto> {
    const { vendor, terms } = await this.prepareLoanPreview(wallet, dto, true);
    const loanId = this.generateProvisionalLoanId();
    const description = `Create BNPL loan for $${dto.amount} at ${vendor.name}`;

    let xdr: string;
    try {
      xdr = await this.creditLineContractClient.buildCreateLoanTransaction(wallet, {
        loanId,
        vendorId: vendor.id,
        amount: dto.amount,
        loanAmount: terms.loanAmount,
        guarantee: terms.guarantee,
        interestRate: terms.interestRate,
        term: terms.term,
      });
    } catch (error) {
      this.logger.error(`Failed to build create_loan XDR for ${loanId}: ${error.message}`);
      throw new InternalServerErrorException({
        code: 'BLOCKCHAIN_CREATE_LOAN_XDR_FAILED',
        message: 'Failed to construct unsigned loan transaction. Please try again.',
      });
    }

    try {
      await this.persistPendingLoan({
        loan_id: loanId,
        user_wallet: wallet,
        vendor_id: vendor.id,
        amount: terms.amount,
        loan_amount: terms.loanAmount,
        guarantee: terms.guarantee,
        interest_rate: terms.interestRate,
        total_repayment: terms.totalRepayment,
        remaining_balance: terms.totalRepayment,
        term: terms.term,
        status: 'pending',
        next_payment_due: terms.schedule[0]?.dueDate ?? null,
      });
    } catch (error) {
      this.logger.error(`Failed to persist pending loan ${loanId}: ${error.message}`);
      throw new InternalServerErrorException({
        code: 'DATABASE_CREATE_LOAN_FAILED',
        message: 'Failed to persist pending loan record. Please try again.',
      });
    }

    return {
      loanId,
      xdr,
      description,
      terms,
    };
  }

  async repayLoan(
    wallet: string,
    loanId: string,
    dto: LoanPaymentRequestDto,
  ): Promise<LoanPaymentResponseDto> {
    const client = this.supabaseService.getServiceRoleClient();
    const { data: loan, error } = await client
      .from('loans')
      .select('id, loan_id, user_wallet, status, remaining_balance')
      .eq('id', loanId)
      .single();

    if (error || !loan) {
      throw new NotFoundException({
        code: 'LOAN_NOT_FOUND',
        message: 'Loan not found. Please provide a valid loan ID.',
      });
    }

    if (loan.user_wallet !== wallet) {
      throw new NotFoundException({
        code: 'LOAN_NOT_FOUND',
        message: 'Loan not found. Please provide a valid loan ID.',
      });
    }

    if (loan.status !== 'active') {
      throw new BadRequestException({
        code: 'LOAN_NOT_ACTIVE',
        message: `Cannot make payments on a loan with status '${loan.status}'. Only active loans can be repaid.`,
      });
    }

    const remainingBalance = Number(loan.remaining_balance);
    if (dto.amount > remainingBalance) {
      throw new BadRequestException({
        code: 'LOAN_PAYMENT_EXCEEDS_BALANCE',
        message: `Payment amount $${dto.amount} exceeds the remaining balance of $${remainingBalance}.`,
      });
    }

    const unsignedXdr = await this.creditLineContractClient.buildRepayLoanTx(
      wallet,
      loan.loan_id,
      dto.amount,
    );

    const newBalance = Math.round((remainingBalance - dto.amount) * 10_000_000) / 10_000_000;
    const willComplete = newBalance === 0;

    return {
      unsignedXdr,
      preview: {
        paymentAmount: dto.amount,
        currentBalance: remainingBalance,
        newBalance,
        willComplete,
      },
    };
  }

  async getMyLoans(wallet: string, query: LoanListQueryDto): Promise<LoanListResponseDto> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const client = this.supabaseService.getServiceRoleClient();

    let loansQuery = client
      .from('loans')
      .select(
        `
          id,
          loan_id,
          vendor_id,
          amount,
          loan_amount,
          guarantee,
          interest_rate,
          total_repayment,
          remaining_balance,
          term,
          status,
          next_payment_due,
          created_at,
          completed_at,
          defaulted_at,
          vendors (
            id,
            name
          ),
          loan_payments (
            amount
          )
        `,
        { count: 'exact' },
      )
      .eq('user_wallet', wallet)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (query.status) {
      loansQuery = loansQuery.eq('status', query.status);
    } else {
      loansQuery = loansQuery.in('status', [
        LoanListStatusFilter.ACTIVE,
        LoanListStatusFilter.COMPLETED,
        LoanListStatusFilter.DEFAULTED,
      ]);
    }

    const { data: loans, error, count } = await loansQuery;

    if (error) {
      this.logger.error(`Failed to fetch loans for ${wallet}: ${error.message}`);
      throw new InternalServerErrorException({
        code: 'USER_LOANS_QUERY_FAILED',
        message: 'Failed to retrieve your loans. Please try again later.',
      });
    }

    return {
      data: (loans ?? []).map((loan) => this.mapLoanListItem(loan as LoanListRow)),
      pagination: {
        limit,
        offset,
        total: count ?? 0,
      },
    };
  }

  async getAvailableCredit(wallet: string): Promise<AvailableCreditResponseDto> {
    let reputationScore: number;

    try {
      reputationScore = (await this.reputationContractClient.getScore(wallet)) ?? 0;
    } catch (error) {
      this.logger.error(`Failed to fetch reputation score for ${wallet}: ${error.message}`);
      throw new ServiceUnavailableException({
        code: 'REPUTATION_CONTRACT_UNAVAILABLE',
        message: 'Unable to read the reputation contract right now. Please try again later.',
      });
    }

    const { maxCredit, tier } = this.mapScoreToCreditTier(reputationScore);

    const client = this.supabaseService.getServiceRoleClient();
    const { data: activeLoans, error } = await client
      .from('loans')
      .select('remaining_balance')
      .eq('user_wallet', wallet)
      .eq('status', 'active');

    if (error) {
      throw new InternalServerErrorException({
        code: 'ACTIVE_LOANS_QUERY_FAILED',
        message: 'Failed to calculate active loan utilization.',
      });
    }

    const creditUsed = Math.round(
      (activeLoans ?? []).reduce((sum, loan) => sum + Number(loan.remaining_balance ?? 0), 0) * 100,
    ) / 100;
    const availableCredit = Math.max(0, Math.round((maxCredit - creditUsed) * 100) / 100);

    return {
      reputationScore,
      reputationTier: tier,
      maxCreditLimit: maxCredit,
      creditUsed,
      availableCredit,
      activeLoans: activeLoans?.length ?? 0,
    };
  }

  private async prepareLoanPreview(
    wallet: string,
    dto: LoanQuoteRequestDto,
    enforceMinimumReputation: boolean,
  ): Promise<{ vendor: ValidVendor; terms: LoanQuoteResponseDto }> {
    const reputation = await this.reputationService.getReputationScore(wallet);
    const vendor = await this.validateVendor(dto.vendor);

    if (enforceMinimumReputation && reputation.score < MIN_LOAN_REPUTATION_SCORE) {
      throw new BadRequestException({
        code: 'LOAN_REPUTATION_TOO_LOW',
        message: `Minimum reputation score to create a loan is ${MIN_LOAN_REPUTATION_SCORE}. Your current score is ${reputation.score}.`,
      });
    }

    if (dto.amount > reputation.maxCredit) {
      throw new BadRequestException({
        code: 'LOAN_AMOUNT_EXCEEDS_CREDIT',
        message: `Requested amount $${dto.amount} exceeds your maximum credit limit of $${reputation.maxCredit}. Improve your reputation score to unlock higher limits.`,
      });
    }

    const guarantee = Math.round(dto.amount * GUARANTEE_PERCENT * 100) / 100;
    const loanAmount = Math.round(dto.amount * LOAN_PERCENT * 100) / 100;
    const interestRate = reputation.interestRate;
    const interest = loanAmount * (interestRate / 100) * (dto.term / 12);
    const totalRepayment = Math.round((loanAmount + interest) * 100) / 100;
    const monthlyPayment = Math.floor((totalRepayment / dto.term) * 100) / 100;
    const schedule = this.generateSchedule(totalRepayment, dto.term);

    return {
      vendor,
      terms: {
        amount: dto.amount,
        guarantee,
        loanAmount,
        interestRate,
        totalRepayment,
        term: dto.term,
        monthlyPayment,
        schedule,
      },
    };
  }

  private async validateVendor(vendorId: string): Promise<ValidVendor> {
    const client = this.supabaseService.getServiceRoleClient();
    const { data: vendor, error } = await client
      .from('vendors')
      .select('id, name, verified')
      .eq('id', vendorId)
      .single();

    if (error || !vendor) {
      throw new NotFoundException({
        code: 'VENDOR_NOT_FOUND',
        message: 'Vendor not found. Please provide a valid vendor ID.',
      });
    }

    if (!vendor.verified) {
      throw new BadRequestException({
        code: 'VENDOR_NOT_VERIFIED',
        message: `Vendor "${vendor.name}" is not currently accepting new loans.`,
      });
    }

    return vendor;
  }

  private generateProvisionalLoanId(): string {
    return `pending-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private async persistPendingLoan(record: CreateLoanRecord): Promise<void> {
    const client = this.supabaseService.getServiceRoleClient();
    const { error } = await client.from('loans').insert(record);

    if (error) {
      throw new Error(error.message ?? 'Supabase insert failed');
    }
  }

  generateSchedule(totalRepayment: number, term: number): SchedulePaymentDto[] {
    return this.generateScheduleFromDate(totalRepayment, term, new Date());
  }

  private generateScheduleFromDate(
    totalRepayment: number,
    term: number,
    startDate: Date,
  ): SchedulePaymentDto[] {
    const monthlyPayment = Math.floor((totalRepayment / term) * 100) / 100;
    const schedule: SchedulePaymentDto[] = [];

    let allocated = 0;

    for (let i = 1; i <= term; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + i);
      dueDate.setHours(0, 0, 0, 0);

      const isLast = i === term;
      const amount = isLast
        ? Math.round((totalRepayment - allocated) * 100) / 100
        : monthlyPayment;

      allocated += amount;

      schedule.push({
        paymentNumber: i,
        amount,
        dueDate: dueDate.toISOString(),
      });
    }

    return schedule;
  }

  private mapLoanListItem(loan: LoanListRow): LoanListItemDto {
    const totalRepayment = Number(loan.total_repayment);
    const remainingBalance = Number(loan.remaining_balance);
    const totalPaid = this.roundCurrency(Math.max(0, totalRepayment - remainingBalance));
    const schedule = this.generateScheduleFromDate(totalRepayment, loan.term, new Date(loan.created_at));
    const paymentIndex = Math.min(loan.loan_payments?.length ?? 0, Math.max(schedule.length - 1, 0));
    const scheduledNextPayment = schedule[paymentIndex];
    const nextPayment =
      loan.status === LoanListStatusFilter.ACTIVE && remainingBalance > 0
        ? {
            dueDate: loan.next_payment_due ?? scheduledNextPayment?.dueDate ?? null,
            amount:
              scheduledNextPayment != null
                ? this.roundCurrency(Math.min(scheduledNextPayment.amount, remainingBalance))
                : this.roundCurrency(remainingBalance),
          }
        : { dueDate: null, amount: null };

    return {
      id: loan.id,
      loanId: loan.loan_id,
      amount: Number(loan.amount),
      loanAmount: Number(loan.loan_amount),
      guarantee: Number(loan.guarantee),
      interestRate: Number(loan.interest_rate),
      totalRepayment,
      totalPaid,
      remainingBalance,
      term: loan.term,
      status: loan.status as LoanListStatusFilter,
      vendor: this.normalizeVendor(loan),
      nextPayment,
      createdAt: loan.created_at,
      completedAt: loan.completed_at,
      defaultedAt: loan.defaulted_at,
    };
  }

  private normalizeVendor(loan: LoanListRow): LoanListVendorDto {
    const vendor = Array.isArray(loan.vendors) ? loan.vendors[0] : loan.vendors;

    return {
      id: vendor?.id ?? loan.vendor_id ?? null,
      name: vendor?.name ?? null,
    };
  }

  private roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private mapScoreToCreditTier(score: number): {
    tier: ReputationTier;
    maxCredit: number;
  } {
    if (score >= 90) {
      return { tier: 'gold', maxCredit: 5000 };
    }

    if (score >= 75) {
      return { tier: 'silver', maxCredit: 3000 };
    }

    if (score >= 60) {
      return { tier: 'bronze', maxCredit: 1500 };
    }

    return { tier: 'poor', maxCredit: 500 };
  }
}
