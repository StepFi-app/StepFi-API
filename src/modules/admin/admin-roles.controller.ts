import {
  Controller,
  Post,
  Param,
  Body,
  NotFoundException,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AuditInterceptor } from '../../common/interceptors/audit.interceptor';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { UsersRepository } from '../../database/repositories/users.repository';
import { UserStatusService } from '../auth/user-status.service';
import { AdminResetRoleDto } from './dto/admin-reset-role.dto';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
@UseInterceptors(AuditInterceptor)
export class AdminRolesController {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly userStatusService: UserStatusService,
  ) {}

  @Post('users/:wallet/role/reset')
  @HttpCode(HttpStatus.OK)
  @AuditAction('admin_users', 'RESET_USER_ROLE')
  @ApiOperation({
    summary: 'Reset or override user role (Admin only)',
    description:
      'Allows admins to reset a user\'s permanent role back to null or override it with a specific role. ' +
      'Immediately invalidates the user\'s server-side status cache and logs an audit event.',
  })
  @ApiParam({ name: 'wallet', description: 'Target user wallet address' })
  @ApiResponse({ status: 200, description: 'Role reset/updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized — missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Forbidden — wallet is not in ADMIN_WALLETS' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async resetUserRole(
    @Param('wallet') wallet: string,
    @Body() dto?: AdminResetRoleDto,
  ) {
    const targetRole = dto?.role ?? null;
    const updated = await this.usersRepository.forceSetRole(wallet, targetRole);

    if (!updated) {
      throw new NotFoundException({
        code: 'USERS_NOT_FOUND',
        message: 'User not found.',
      });
    }

    this.userStatusService.invalidate(wallet);

    return {
      success: true,
      data: {
        wallet: updated.wallet_address,
        role: updated.role,
      },
      message: 'User role updated successfully.',
    };
  }
}
