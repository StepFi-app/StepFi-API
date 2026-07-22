import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ws from 'ws';

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient;
  private readonly serviceRoleClient: SupabaseClient;

  constructor(private configService: ConfigService) {
    this.client = createClient(
      this.configService.get<string>('SUPABASE_URL'),
      this.configService.get<string>('SUPABASE_ANON_KEY'),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        realtime: {
          // supabase-js expects a browser WebSocket constructor; the `ws`
          // package is API-compatible but not type-compatible in Node.
          transport: ws as unknown as typeof WebSocket,
        },
      },
    );

    this.serviceRoleClient = createClient(
      this.configService.get<string>('SUPABASE_URL'),
      this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        realtime: {
          // supabase-js expects a browser WebSocket constructor; the `ws`
          // package is API-compatible but not type-compatible in Node.
          transport: ws as unknown as typeof WebSocket,
        },
      },
    );
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  getServiceRoleClient(): SupabaseClient {
    return this.serviceRoleClient;
  }

  /**
   * Creates a wallet-scoped client for RLS enforcement.
   * Uses anon key (non-service-role) and sets app.current_wallet session variable.
   * This client respects RLS policies, unlike serviceRoleClient which bypasses them.
   * 
   * Note: The session variable must be set per-request via RPC or raw SQL.
   * Use setWalletSessionVariable() before queries on this client.
   */
  getWalletScopedClient(walletAddress: string): SupabaseClient {
    return createClient(
      this.configService.get<string>('SUPABASE_URL'),
      this.configService.get<string>('SUPABASE_ANON_KEY'),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        realtime: {
          transport: ws as unknown as typeof WebSocket,
        },
      },
    );
  }

  /**
   * Sets the Postgres session variable for RLS enforcement.
   * Must be called before queries on wallet-scoped client.
   */
  async setWalletSessionVariable(client: SupabaseClient, walletAddress: string): Promise<void> {
    await client.rpc('set_app_current_wallet', { wallet: walletAddress });
  }
}
