import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { SupabaseService } from '../../database/supabase.client';
import { VendorsRepository } from '../../database/repositories/vendors.repository';
import { VendorResponseDto, VendorType } from './dto/vendor.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ApiKeyResponseDto, ApiKeyCreatedResponseDto } from './dto/api-key-response.dto';

const API_KEY_PREFIX = 'sfi_';

interface VendorRow {
  id: string;
  wallet_address: string;
  name: string;
  type: VendorType;
  verified: boolean;
  website: string | null;
  country: string | null;
  city: string | null;
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
  ) {}

  async getAll(type?: VendorType): Promise<VendorResponseDto[]> {
    const client = this.supabaseService.getClient();
    let query = client.from('vendors').select('*').order('created_at', { ascending: false });

    if (type) {
      query = query.eq('type', type);
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error(`Failed to list vendors: ${error.message}`);
      throw new InternalServerErrorException('Failed to list vendors.');
    }

    const rows: VendorRow[] = (data ?? []) as VendorRow[];
    return rows.map((row) => this.mapToDto(row));
  }

  async getById(id: string): Promise<VendorResponseDto> {
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

    return this.mapToDto(data as VendorRow);
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
      verified: data.verified,
      website: data.website ?? undefined,
      country: data.country ?? undefined,
      city: data.city ?? undefined,
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
