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
}
