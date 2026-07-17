import { Controller, Get, Patch, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UserResponseDto } from './dto/user-response.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserProfileDto } from './dto/user-profile.dto';
import { SetRoleDto, SetRoleResponseDto } from './dto/set-role.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Handles HTTP requests to the /users resource.
 *
 * All endpoints are protected by JwtAuthGuard (implemented in API-03).
 * The @UseGuards decorator is kept explicit for clarity and works correctly
 * whether the guard is registered globally (APP_GUARD) or not.
 */
@ApiTags('users')
@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    /**
     * GET /users/me
     *
     * Returns the authenticated user's profile.
     * If this is the user's first request, a profile is auto-created.
     *
     * @param user - Injected by @CurrentUser() from req.user set by JwtAuthGuard
     */
    @Get('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: "Get the authenticated user's profile" })
    @ApiResponse({ status: 200, description: 'User profile retrieved', type: UserResponseDto })
    @ApiResponse({ status: 401, description: 'Unauthorized — missing or invalid JWT' })
    async getMe(@CurrentUser() user: { wallet: string }): Promise<UserResponseDto> {
        const data = await this.usersService.getOrCreateProfile(user.wallet);
        return {
            success: true,
            data,
            message: 'User retrieved successfully',
        };
    }

    /**
     * PATCH /users/me
     *
     * Updates the authenticated user's profile. All fields are optional.
     * Inputs are validated and sanitized before being persisted.
     *
     * @param user - Injected by @CurrentUser() from req.user set by JwtAuthGuard
     * @param dto  - Validated update payload
     */
    @Patch('me')
    @HttpCode(HttpStatus.OK)
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({
        summary: "Update the authenticated user's profile",
        description: 'Updates display name, avatar URL, and/or preferences. Only provided fields are modified.',
    })
    @ApiResponse({ status: 200, description: 'Profile updated successfully', type: UpdateUserProfileDto })
    @ApiResponse({ status: 400, description: 'Invalid request body' })
    @ApiResponse({ status: 401, description: 'Unauthorized — missing or invalid JWT' })
    async updateProfile(
        @CurrentUser() user: { wallet: string },
        @Body() dto: UpdateUserDto,
    ): Promise<{ success: boolean; data: UpdateUserProfileDto; message: string }> {
        const data = await this.usersService.updateProfile(user.wallet, dto);
        return { success: true, data, message: 'Profile updated successfully' };
    }

    /**
     * PATCH /users/me/role
     *
     * One-time role selection for the authenticated wallet. Once set, the
     * role is permanent — repeated calls return 409 Conflict.
     */
    @Patch('me/role')
    @HttpCode(HttpStatus.OK)
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Set user role, one-time only',
        description:
            'Permanently binds a role (sponsor | vendor | mentor) to the authenticated wallet. ' +
            'The role can only be set once; subsequent attempts return 409 Conflict. ' +
            'IMPORTANT: the current access token was issued before the role existed, so after ' +
            'a successful call the client MUST call POST /auth/refresh to obtain a new JWT ' +
            'containing the role claim — role-gated endpoints reject tokens without it.',
    })
    @ApiResponse({ status: 200, description: 'Role set successfully', type: SetRoleResponseDto })
    @ApiResponse({ status: 400, description: 'Invalid role value' })
    @ApiResponse({ status: 401, description: 'Unauthorized — missing or invalid JWT' })
    @ApiResponse({ status: 404, description: 'User not found' })
    @ApiResponse({ status: 409, description: 'Role already set for this wallet and cannot be changed' })
    async setRole(
        @CurrentUser() user: { wallet: string },
        @Body() dto: SetRoleDto,
    ): Promise<{ success: boolean; data: SetRoleResponseDto; message: string }> {
        const data = await this.usersService.setRole(user.wallet, dto.role);
        return {
            success: true,
            data,
            message: 'Role set successfully. Refresh your access token to receive the role claim.',
        };
    }
}