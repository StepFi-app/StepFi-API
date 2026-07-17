import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.client';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditLogItemDto, AuditLogListResponseDto } from './dto/audit-log-response.dto';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async log(entry: CreateAuditLogDto): Promise<void> {
    const client = this.supabaseService.getServiceRoleClient();

    const { error } = await client.from('audit_logs').insert({
      actor_wallet: entry.actor_wallet,
      action: entry.action,
      resource: entry.resource,
      resource_id: entry.resource_id,
      before_state: entry.before_state,
      after_state: entry.after_state,
      ip_address: entry.ip_address,
      user_agent: entry.user_agent,
      metadata: entry.metadata,
    });

    if (error) {
      this.logger.error(`Failed to write audit log: ${error.message}`, { entry });
      throw error;
    }
  }

  async logWithBeforeAfter(params: {
    actorWallet: string;
    action: string;
    resource: string;
    resourceId: string | null;
    beforeState: Record<string, unknown> | null;
    afterState: Record<string, unknown> | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.log({
      actor_wallet: params.actorWallet,
      action: params.action,
      resource: params.resource,
      resource_id: params.resourceId,
      before_state: params.beforeState,
      after_state: params.afterState,
      ip_address: params.ipAddress ?? null,
      user_agent: params.userAgent ?? null,
      metadata: params.metadata ?? null,
    });
  }

  async findMany(query: AuditLogQueryDto): Promise<AuditLogListResponseDto> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const client = this.supabaseService.getServiceRoleClient();

    let dbQuery = client
      .from('audit_logs')
      .select('*', { count: 'exact' });

    if (query.actorWallet) {
      dbQuery = dbQuery.eq('actor_wallet', query.actorWallet);
    }

    if (query.action) {
      dbQuery = dbQuery.eq('action', query.action);
    }

    if (query.resource) {
      dbQuery = dbQuery.eq('resource', query.resource);
    }

    if (query.resourceId) {
      dbQuery = dbQuery.eq('resource_id', query.resourceId);
    }

    if (query.search) {
      const term = `%${query.search}%`;
      dbQuery = dbQuery.or(
        `actor_wallet.ilike.${term},action.ilike.${term},resource.ilike.${term},resource_id.ilike.${term}`,
      );
    }

    dbQuery = dbQuery
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: logs, error, count } = await dbQuery;

    if (error) {
      this.logger.error(`Failed to fetch audit logs: ${error.message}`);
      throw error;
    }

    const data: AuditLogItemDto[] = (logs ?? []).map((log) => ({
      id: log.id,
      actorWallet: log.actor_wallet,
      action: log.action,
      resource: log.resource,
      resourceId: log.resource_id ?? null,
      beforeState: log.before_state as Record<string, unknown> | null,
      afterState: log.after_state as Record<string, unknown> | null,
      ipAddress: log.ip_address ?? null,
      createdAt: log.created_at,
    }));

    return {
      success: true,
      data,
      pagination: {
        limit,
        offset,
        total: count ?? 0,
      },
      message: 'Audit logs retrieved successfully',
    };
  }
}
