import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import { AuditLogListResponseDto } from './dto/audit-log-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { AuditAction } from '../../common/decorators/audit-action.decorator';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('audit-logs')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('audit_logs', 'VIEW_AUDIT_LOGS')
  @ApiOperation({
    summary: 'Search audit logs',
    description:
      'Returns paginated audit logs with optional filtering by actor, action, resource, resource ID, and free-text search. Logs are immutable and ordered by creation date descending.',
  })
  @ApiQuery({ name: 'actorWallet', required: false, description: 'Filter by actor wallet address' })
  @ApiQuery({ name: 'action', required: false, description: 'Filter by action (e.g. UPDATE_USER)' })
  @ApiQuery({ name: 'resource', required: false, description: 'Filter by resource type (e.g. users)' })
  @ApiQuery({ name: 'resourceId', required: false, description: 'Filter by resource ID' })
  @ApiQuery({ name: 'search', required: false, description: 'Free-text search across actor, action, resource, resource_id' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (default 20, max 100)' })
  @ApiQuery({ name: 'offset', required: false, type: Number, description: 'Number of records to skip (default 0)' })
  @ApiResponse({
    status: 200,
    description: 'Audit logs retrieved successfully',
    type: AuditLogListResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing or invalid admin JWT' })
  async getAuditLogs(@Query() query: AuditLogQueryDto) {
    return this.auditService.findMany(query);
  }
}
