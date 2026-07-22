import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SupabaseService } from '../supabase.client';

export type VendorType = 'school' | 'bootcamp' | 'electronics' | 'books' | 'subscriptions';
export type VendorStatus = 'pending' | 'approved' | 'suspended' | 'rejected';

export interface VendorRecord {
    id: string;
    wallet_address: string | null;
    name: string;
    type: VendorType;
    verified: boolean;
    status: VendorStatus;
}

export interface VendorDetailRecord extends VendorRecord {
    website: string | null;
    country: string | null;
    city: string | null;
    created_at: string;
    updated_at: string;
}

export interface FindAllVendorsOptions {
    limit: number;
    offset: number;
    verified?: boolean;
    type?: VendorType;
}

export interface FindAllVendorsResult {
    vendors: VendorRecord[];
    total: number;
}

/**
 * Encapsulates all Supabase queries for the `vendors` table.
 */
@Injectable()
export class VendorsRepository {
    constructor(private readonly supabaseService: SupabaseService) { }

    /**
     * Returns a paginated list of vendors, optionally filtered by verified flag and type.
     */
    async findAll({ limit, offset, verified, type }: FindAllVendorsOptions): Promise<FindAllVendorsResult> {
        let query = this.supabaseService
            .getClient()
            .from('vendors')
            .select('id, wallet_address, name, type, verified', { count: 'exact' });

        if (verified !== undefined) {
            query = query.eq('verified', verified);
        }
        if (type !== undefined) {
            query = query.eq('type', type);
        }

        const { data, error, count } = await query.range(offset, offset + limit - 1);

        if (error) {
            throw new InternalServerErrorException({
                code: 'DATABASE_QUERY_ERROR',
                message: error.message,
            });
        }

        return {
            vendors: (data as VendorRecord[]) ?? [],
            total: count ?? 0,
        };
    }

    /**
     * Finds a vendor by its unique ID.
     */
    async findById(id: string): Promise<VendorDetailRecord | null> {
        const { data, error } = await this.supabaseService
            .getClient()
            .from('vendors')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return null; // Not found
            }
            throw new InternalServerErrorException({
                code: 'DATABASE_QUERY_ERROR',
                message: error.message,
            });
        }

        return data as VendorDetailRecord;
    }

    /**
     * Finds a vendor by its Stellar wallet address.
     */
    async findByWallet(walletAddress: string): Promise<VendorDetailRecord | null> {
        const { data, error } = await this.supabaseService
            .getClient()
            .from('vendors')
            .select('*')
            .eq('wallet_address', walletAddress)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return null; // Not found
            }
            throw new InternalServerErrorException({
                code: 'DATABASE_QUERY_ERROR',
                message: error.message,
            });
        }

        return data as VendorDetailRecord;
    }
}
