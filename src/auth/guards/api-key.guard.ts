import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { SupabaseService } from '../../database/supabase.client';
import { API_KEY_PERMISSIONS_KEY } from './api-key-permissions.decorator';

interface ApiKeyRecord {
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
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      apiKey?: ApiKeyRecord;
    }>();

    const apiKeyHeader = request.headers['x-api-key'];

    if (!apiKeyHeader || typeof apiKeyHeader !== 'string') {
      throw new UnauthorizedException({
        code: 'API_KEY_MISSING',
        message: 'X-API-Key header is required.',
      });
    }

    const keyHash = createHash('sha256').update(apiKeyHeader).digest('hex');

    const client = this.supabaseService.getServiceRoleClient();
    const { data, error } = await client
      .from('api_keys')
      .select('*')
      .eq('key_hash', keyHash)
      .single();

    if (error || !data) {
      throw new UnauthorizedException({
        code: 'API_KEY_INVALID',
        message: 'Invalid API key.',
      });
    }

    const keyRecord = data as unknown as ApiKeyRecord;

    if (!keyRecord.is_active) {
      throw new UnauthorizedException({
        code: 'API_KEY_INACTIVE',
        message: 'API key has been revoked.',
      });
    }

    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      throw new UnauthorizedException({
        code: 'API_KEY_EXPIRED',
        message: 'API key has expired.',
      });
    }

    const requiredPermissions = this.reflector.get<string[]>(
      API_KEY_PERMISSIONS_KEY,
      context.getHandler(),
    );

    if (requiredPermissions && requiredPermissions.length > 0) {
      const keyPermissions: string[] = keyRecord.permissions ?? [];
      const hasPermission = requiredPermissions.some((p) => keyPermissions.includes(p));
      if (!hasPermission) {
        throw new ForbiddenException({
          code: 'API_KEY_INSUFFICIENT_PERMISSIONS',
          message: 'API key does not have the required permissions for this resource.',
        });
      }
    }

    this.updateLastUsed(keyRecord.id);

    request.apiKey = keyRecord;
    return true;
  }

  private async updateLastUsed(keyId: string): Promise<void> {
    try {
      const client = this.supabaseService.getServiceRoleClient();
      await client
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', keyId);
    } catch {
      // Fire-and-forget — failure to update last_used_at should not block the request
    }
  }
}
