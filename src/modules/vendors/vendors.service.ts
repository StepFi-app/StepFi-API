import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { SupabaseService } from '../../database/supabase.client';
import { VendorsRepository, VendorDetailRecord } from '../../database/repositories/vendors.repository';
import { VendorRegistryContractClient } from '../../stellar/contracts/clients/vendor-registry.client';
import {
  VendorResponseDto,
  VendorType,
  VendorStatus,
  VendorActionResponseDto,
} from './dto/vendor.dto';
import { RegisterVendorDto } from './dto/register-vendor.dto';
import { VendorDashboardDto } from './dto/vendor-dashboard.dto';
import { VendorLoanDto, VendorLoansPageDto } from './dto/vendor-loan.dto';
import { VendorPaymentDto, VendorPaymentsPageDto } from './dto/vendor-payment.dto';
import {
  CreateVendorProductDto,
  UpdateVendorProductDto,
  VendorProductDto,
} from './dto/vendor-product.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ApiKeyResponseDto, ApiKeyCreatedResponseDto } from './dto/api-key-response.dto';

const ACTIVE_LOAN_STATUS = 'active';
const DEFAULTED_LOAN_STATUS = 'defaulted';
const LOAN_SORT_COLUMNS = new Set(['created_at', 'amount', 'status']);
const toNumber = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

interface VendorLoanRow {
  id: string;
  loan_id: string;
  user_wallet: string;
  amount: number | string;
  loan_amount: number | string;
  remaining_balance: number | string;
  status: string;
  next_payment_due: string | null;
  created_at: string;
}

interface PaymentRow {
  id: string;
  loan_id: string;
  amount: number | string;
  tx_hash: string;
  paid_at: string;
}

interface VendorProductRow {
  id: string;
  vendor_id: string;
  name: string;
  price: number | string;
  category: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

const API_KEY_PREFIX = 'sfi_';

interface VendorRow {
  id: string;
  wallet_address: string;
  name: string;
  type: VendorType;
  status: VendorStatus;
  verified: boolean;
  website: string | null;
  country: string | null;
  city: string | null;
  description: string | null;
  created_at: string;
}

interface ApiKeyRow {
  id: string;
  vendor_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  permissions: string[];
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly vendorsRepository: VendorsRepository,
    private readonly vendorRegistryClient: VendorRegistryContractClient,
  ) {}

  async getAll(type?: VendorType): Promise<VendorResponseDto[]> {
    const client = this.supabaseService.getClient();
    let query = client.from('vendors').select('*');

    if (type) {
      query = query.eq('type', type);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to list vendors: ${error.message}`);
      throw new Error('Failed to list vendors.');
    }

    const rows: VendorRow[] = (data ?? []) as VendorRow[];
    return rows.map((row) => this.mapToDto(row));
  }

  async getById(id: string): Promise<VendorResponseDto> {
    const data = await this.getRawById(id);
    return this.mapToDto(data);
  }

  async approveVendor(adminWallet: string, id: string): Promise<VendorActionResponseDto> {
    const vendor = await this.getRawById(id);

    if (vendor.status !== VendorStatus.PENDING) {
      throw new ConflictException({
        code: 'VENDOR_NOT_PENDING',
        message: `Cannot approve vendor in '${vendor.status}' status. Vendor must be in pending status.`,
      });
    }

    const unsignedXdr = await this.vendorRegistryClient.buildApproveVendorXdr(adminWallet, vendor.id);

    return {
      unsignedXdr,
      description: `Approve vendor '${vendor.name}' on-chain`,
      vendorId: vendor.id,
      status: vendor.status,
    };
  }

  async suspendVendor(adminWallet: string, id: string): Promise<VendorActionResponseDto> {
    const vendor = await this.getRawById(id);

    if (vendor.status !== VendorStatus.APPROVED) {
      throw new ConflictException({
        code: 'VENDOR_NOT_APPROVED',
        message: `Cannot suspend vendor in '${vendor.status}' status. Vendor must be in approved status.`,
      });
    }

    const unsignedXdr = await this.vendorRegistryClient.buildSuspendVendorXdr(adminWallet, vendor.id);

    return {
      unsignedXdr,
      description: `Suspend vendor '${vendor.name}' on-chain`,
      vendorId: vendor.id,
      status: vendor.status,
    };
  }

  private async getRawById(id: string): Promise<VendorRow> {
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('vendors')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException({
        code: 'VENDOR_NOT_FOUND',
        message: 'Vendor not found.',
      });
    }

    return data as VendorRow;
  }

  /**
   * Registers the authenticated wallet as a vendor. Exactly one vendor profile
   * is permitted per wallet; a second attempt returns 409. `category` is stored
   * in the `type` column.
   */
  async registerVendor(wallet: string, dto: RegisterVendorDto): Promise<VendorResponseDto> {
    const existing = await this.vendorsRepository.findByWallet(wallet);
    if (existing) {
      throw new ConflictException({
        code: 'VENDOR_ALREADY_REGISTERED',
        message: 'This wallet is already registered as a vendor.',
      });
    }

    const client = this.supabaseService.getServiceRoleClient();
    const { data, error } = await client
      .from('vendors')
      .insert({
        wallet_address: wallet,
        name: dto.name,
        type: dto.category,
        verified: false,
        country: dto.country,
        city: dto.city ?? null,
        website: dto.website ?? null,
        description: dto.description ?? null,
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`Failed to register vendor for ${wallet}: ${error?.message}`);
      throw new InternalServerErrorException({
        code: 'DATABASE_VENDOR_CREATE_FAILED',
        message: 'Failed to register vendor.',
      });
    }

    return this.mapToDto(data as VendorRow);
  }

  /**
   * Returns an aggregate summary of the authenticated vendor's own activity,
   * scoped to loans tied to this vendor via `loans.vendor_id`.
   */
  async getDashboard(wallet: string): Promise<VendorDashboardDto> {
    const vendor = await this.requireVendor(wallet);
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('loans')
      .select('loan_id, user_wallet, status')
      .eq('vendor_id', vendor.id);

    if (error) {
      this.logger.error(`Failed to load vendor dashboard for ${wallet}: ${error.message}`);
      throw new InternalServerErrorException({
        code: 'DATABASE_QUERY_ERROR',
        message: 'Failed to load vendor dashboard.',
      });
    }

    const loans = (data ?? []) as Array<Pick<VendorLoanRow, 'loan_id' | 'user_wallet' | 'status'>>;
    const totalLoansFunded = loans.length;
    const defaultedCount = loans.filter((l) => l.status === DEFAULTED_LOAN_STATUS).length;
    const activeBorrowers = new Set(
      loans.filter((l) => l.status === ACTIVE_LOAN_STATUS).map((l) => l.user_wallet),
    ).size;
    const defaultRate =
      totalLoansFunded === 0
        ? 0
        : Math.round((defaultedCount / totalLoansFunded) * 10000) / 100;

    const loanIds = loans.map((l) => l.loan_id);
    const totalReceived = await this.sumPaymentsForLoans(loanIds);

    return { totalLoansFunded, totalReceived, activeBorrowers, defaultRate };
  }

  /**
   * Paginated list of loans tied to the authenticated vendor's record.
   */
  async getLoans(
    wallet: string,
    page: number,
    limit: number,
    sort?: string,
    order?: string,
  ): Promise<VendorLoansPageDto> {
    const vendor = await this.requireVendor(wallet);
    const client = this.supabaseService.getClient();

    const sortColumn = sort && LOAN_SORT_COLUMNS.has(sort) ? sort : 'created_at';
    const ascending = order === 'asc';
    const offset = (page - 1) * limit;

    const { data, error, count } = await client
      .from('loans')
      .select('*', { count: 'exact' })
      .eq('vendor_id', vendor.id)
      .order(sortColumn, { ascending })
      .range(offset, offset + limit - 1);

    if (error) {
      this.logger.error(`Failed to list vendor loans for ${wallet}: ${error.message}`);
      throw new InternalServerErrorException({
        code: 'DATABASE_QUERY_ERROR',
        message: 'Failed to list vendor loans.',
      });
    }

    const items = ((data ?? []) as VendorLoanRow[]).map((row) => this.mapLoanToDto(row));
    const total = count ?? 0;
    return { items, total, page, limit, totalPages: limit > 0 ? Math.ceil(total / limit) : 0 };
  }

  /**
   * Paginated payment history (repayment records) for the authenticated
   * vendor's loans, derived from the `payment_index` table.
   */
  async getPayments(wallet: string, page: number, limit: number): Promise<VendorPaymentsPageDto> {
    const vendor = await this.requireVendor(wallet);
    const client = this.supabaseService.getClient();

    const { data: loanRows, error: loanError } = await client
      .from('loans')
      .select('loan_id')
      .eq('vendor_id', vendor.id);

    if (loanError) {
      this.logger.error(`Failed to resolve vendor loans for ${wallet}: ${loanError.message}`);
      throw new InternalServerErrorException({
        code: 'DATABASE_QUERY_ERROR',
        message: 'Failed to load vendor payments.',
      });
    }

    const loanIds = ((loanRows ?? []) as Array<{ loan_id: string }>).map((r) => r.loan_id);
    if (loanIds.length === 0) {
      return { items: [], total: 0, page, limit, totalPages: 0 };
    }

    const offset = (page - 1) * limit;
    const { data, error, count } = await client
      .from('payment_index')
      .select('*', { count: 'exact' })
      .in('loan_id', loanIds)
      .order('paid_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      this.logger.error(`Failed to list vendor payments for ${wallet}: ${error.message}`);
      throw new InternalServerErrorException({
        code: 'DATABASE_QUERY_ERROR',
        message: 'Failed to load vendor payments.',
      });
    }

    const items = ((data ?? []) as PaymentRow[]).map((row) => this.mapPaymentToDto(row));
    const total = count ?? 0;
    return { items, total, page, limit, totalPages: limit > 0 ? Math.ceil(total / limit) : 0 };
  }

  async getProducts(wallet: string): Promise<VendorProductDto[]> {
    const vendor = await this.requireVendor(wallet);
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('vendor_products')
      .select('*')
      .eq('vendor_id', vendor.id)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to list products for ${wallet}: ${error.message}`);
      throw new InternalServerErrorException({
        code: 'DATABASE_QUERY_ERROR',
        message: 'Failed to list products.',
      });
    }

    return ((data ?? []) as VendorProductRow[]).map((row) => this.mapProductToDto(row));
  }

  async createProduct(wallet: string, dto: CreateVendorProductDto): Promise<VendorProductDto> {
    const vendor = await this.requireVendor(wallet);
    const client = this.supabaseService.getServiceRoleClient();

    const { data, error } = await client
      .from('vendor_products')
      .insert({
        vendor_id: vendor.id,
        name: dto.name,
        price: dto.price,
        category: dto.category ?? null,
        description: dto.description ?? null,
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`Failed to create product for ${wallet}: ${error?.message}`);
      throw new InternalServerErrorException({
        code: 'DATABASE_PRODUCT_CREATE_FAILED',
        message: 'Failed to create product.',
      });
    }

    return this.mapProductToDto(data as VendorProductRow);
  }

  async updateProduct(
    wallet: string,
    productId: string,
    dto: UpdateVendorProductDto,
  ): Promise<VendorProductDto> {
    const vendor = await this.requireVendor(wallet);
    await this.requireOwnedProduct(vendor.id, productId);

    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updatePayload.name = dto.name;
    if (dto.price !== undefined) updatePayload.price = dto.price;
    if (dto.category !== undefined) updatePayload.category = dto.category;
    if (dto.description !== undefined) updatePayload.description = dto.description;

    const client = this.supabaseService.getServiceRoleClient();
    const { data, error } = await client
      .from('vendor_products')
      .update(updatePayload)
      .eq('id', productId)
      .eq('vendor_id', vendor.id)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`Failed to update product ${productId} for ${wallet}: ${error?.message}`);
      throw new InternalServerErrorException({
        code: 'DATABASE_PRODUCT_UPDATE_FAILED',
        message: 'Failed to update product.',
      });
    }

    return this.mapProductToDto(data as VendorProductRow);
  }

  async deleteProduct(wallet: string, productId: string): Promise<void> {
    const vendor = await this.requireVendor(wallet);
    await this.requireOwnedProduct(vendor.id, productId);

    const client = this.supabaseService.getServiceRoleClient();
    const { error } = await client
      .from('vendor_products')
      .delete()
      .eq('id', productId)
      .eq('vendor_id', vendor.id);

    if (error) {
      this.logger.error(`Failed to delete product ${productId} for ${wallet}: ${error.message}`);
      throw new InternalServerErrorException({
        code: 'DATABASE_PRODUCT_DELETE_FAILED',
        message: 'Failed to delete product.',
      });
    }
  }

  private async requireVendor(wallet: string): Promise<VendorDetailRecord> {
    const vendor = await this.vendorsRepository.findByWallet(wallet);
    if (!vendor) {
      throw new NotFoundException({
        code: 'VENDOR_NOT_FOUND',
        message: 'No vendor found for this wallet address.',
      });
    }
    return vendor;
  }

  private async requireOwnedProduct(vendorId: string, productId: string): Promise<void> {
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('vendor_products')
      .select('vendor_id')
      .eq('id', productId)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to load product ${productId}: ${error.message}`);
      throw new InternalServerErrorException({
        code: 'DATABASE_QUERY_ERROR',
        message: 'Failed to load product.',
      });
    }

    if (!data) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Product not found.',
      });
    }

    if ((data as { vendor_id: string }).vendor_id !== vendorId) {
      throw new ForbiddenException({
        code: 'PRODUCT_FORBIDDEN',
        message: 'This product does not belong to your vendor account.',
      });
    }
  }

  private async sumPaymentsForLoans(loanIds: string[]): Promise<number> {
    if (loanIds.length === 0) {
      return 0;
    }

    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('payment_index')
      .select('amount')
      .in('loan_id', loanIds);

    if (error) {
      this.logger.error(`Failed to sum payments: ${error.message}`);
      throw new InternalServerErrorException({
        code: 'DATABASE_QUERY_ERROR',
        message: 'Failed to load vendor payments total.',
      });
    }

    return ((data ?? []) as Array<{ amount: number | string }>).reduce(
      (sum, row) => sum + toNumber(row.amount),
      0,
    );
  }

  private mapLoanToDto(row: VendorLoanRow): VendorLoanDto {
    return {
      id: row.id,
      loanId: row.loan_id,
      borrowerWallet: row.user_wallet,
      amount: toNumber(row.amount),
      loanAmount: toNumber(row.loan_amount),
      remainingBalance: toNumber(row.remaining_balance),
      status: row.status,
      nextPaymentDue: row.next_payment_due ?? null,
      createdAt: row.created_at,
    };
  }

  private mapPaymentToDto(row: PaymentRow): VendorPaymentDto {
    return {
      id: row.id,
      loanId: row.loan_id,
      amount: toNumber(row.amount),
      txHash: row.tx_hash,
      paidAt: row.paid_at,
    };
  }

  private mapProductToDto(row: VendorProductRow): VendorProductDto {
    return {
      id: row.id,
      vendorId: row.vendor_id,
      name: row.name,
      price: toNumber(row.price),
      category: row.category ?? null,
      description: row.description ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async createApiKey(wallet: string, dto: CreateApiKeyDto): Promise<ApiKeyCreatedResponseDto> {
    const vendor = await this.vendorsRepository.findByWallet(wallet);
    if (!vendor) {
      throw new NotFoundException({
        code: 'VENDOR_NOT_FOUND',
        message: 'No vendor found for this wallet address.',
      });
    }

    const rawKey = API_KEY_PREFIX + randomBytes(32).toString('hex');
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const client = this.supabaseService.getServiceRoleClient();
    const { data, error } = await client
      .from('api_keys')
      .insert({
        vendor_id: vendor.id,
        name: dto.name,
        key_prefix: rawKey.substring(0, 8),
        key_hash: keyHash,
        permissions: dto.permissions,
        expires_at: dto.expiresAt || null,
      })
      .select('*')
      .single();

    if (error) {
      this.logger.error(`Failed to create API key: ${error.message}`);
      throw new InternalServerErrorException({
        code: 'DATABASE_API_KEY_CREATE_FAILED',
        message: 'Failed to create API key.',
      });
    }

    const keyData = data as unknown as ApiKeyRow;

    return {
      ...this.mapApiKeyToDto(keyData),
      fullKey: rawKey,
    };
  }

  async listApiKeys(wallet: string): Promise<ApiKeyResponseDto[]> {
    const vendor = await this.vendorsRepository.findByWallet(wallet);
    if (!vendor) {
      throw new NotFoundException({
        code: 'VENDOR_NOT_FOUND',
        message: 'No vendor found for this wallet address.',
      });
    }

    const client = this.supabaseService.getServiceRoleClient();
    const { data, error } = await client
      .from('api_keys')
      .select('*')
      .eq('vendor_id', vendor.id)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to list API keys: ${error.message}`);
      throw new InternalServerErrorException({
        code: 'DATABASE_QUERY_ERROR',
        message: 'Failed to list API keys.',
      });
    }

    const rows: ApiKeyRow[] = (data ?? []) as ApiKeyRow[];
    return rows.map((row) => this.mapApiKeyToDto(row));
  }

  async revokeApiKey(wallet: string, keyId: string): Promise<void> {
    const vendor = await this.vendorsRepository.findByWallet(wallet);
    if (!vendor) {
      throw new NotFoundException({
        code: 'VENDOR_NOT_FOUND',
        message: 'No vendor found for this wallet address.',
      });
    }

    const client = this.supabaseService.getServiceRoleClient();
    const { data: existing, error: fetchError } = await client
      .from('api_keys')
      .select('id')
      .eq('id', keyId)
      .eq('vendor_id', vendor.id)
      .single();

    if (fetchError || !existing) {
      throw new NotFoundException({
        code: 'API_KEY_NOT_FOUND',
        message: 'API key not found or does not belong to this vendor.',
      });
    }

    const { error: updateError } = await client
      .from('api_keys')
      .update({ is_active: false })
      .eq('id', keyId);

    if (updateError) {
      this.logger.error(`Failed to revoke API key: ${updateError.message}`);
      throw new InternalServerErrorException({
        code: 'DATABASE_API_KEY_REVOKE_FAILED',
        message: 'Failed to revoke API key.',
      });
    }
  }

  private mapToDto(data: VendorRow): VendorResponseDto {
    return {
      id: data.id,
      walletAddress: data.wallet_address,
      name: data.name,
      type: data.type,
      status: data.status ?? VendorStatus.PENDING,
      verified: data.verified,
      website: data.website ?? undefined,
      country: data.country ?? undefined,
      city: data.city ?? undefined,
      description: data.description ?? undefined,
      createdAt: data.created_at,
    };
  }

  private mapApiKeyToDto(data: ApiKeyRow): ApiKeyResponseDto {
    return {
      id: data.id,
      vendorId: data.vendor_id,
      name: data.name,
      keyPrefix: data.key_prefix,
      permissions: data.permissions,
      isActive: data.is_active,
      lastUsedAt: data.last_used_at ?? undefined,
      expiresAt: data.expires_at ?? undefined,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}

