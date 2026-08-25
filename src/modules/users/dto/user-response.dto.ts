import { ApiProperty } from '@nestjs/swagger';

/**
 * User preferences nested inside the profile response.
 * Maps directly from the `user_preferences` table columns.
 */
export class UserPreferencesDto {
    @ApiProperty({ example: true, description: 'Whether the user wants in-app notifications' })
    notifications: boolean;

    @ApiProperty({ example: 'dark', description: 'UI theme: light | dark | system' })
    theme: string;

    @ApiProperty({ example: 'en', description: 'UI language as ISO 639-1 two-letter code' })
    language: string;
}

/**
 * The user profile data returned inside the `data` field of the response.
 * Maps DB snake_case columns to camelCase API fields.
 */
export class UserProfileDto {
    @ApiProperty({ example: 'GABC...XYZ', description: 'Stellar wallet address (public key)' })
    wallet: string;

    @ApiProperty({ example: 'Maria Garcia', nullable: true, description: 'Display name, null until set via PATCH /users/me' })
    name: string | null;

    @ApiProperty({ example: 'https://example.com/avatar.png', nullable: true, description: 'Avatar URL (https only), null until set' })
    avatar: string | null;

    @ApiProperty({
        example: 'sponsor',
        nullable: true,
        enum: ['sponsor', 'vendor', 'mentor', 'admin'],
        description: 'Permanent role chosen once via PATCH /users/me/role, null until chosen',
    })
    role: 'sponsor' | 'vendor' | 'mentor' | 'admin' | null;

    @ApiProperty({ type: UserPreferencesDto })
    preferences: UserPreferencesDto;

    @ApiProperty({ example: '2026-02-13T10:00:00.000Z', description: 'ISO 8601 timestamp of account creation' })
    createdAt: string;
}

/**
 * Full HTTP response envelope for GET /users/me.
 * Follows the project response standard: { success, data, message }.
 */
export class UserResponseDto {
    @ApiProperty({ example: true })
    success: boolean;

    @ApiProperty({ type: UserProfileDto })
    data: UserProfileDto;

    @ApiProperty({ example: 'User retrieved successfully' })
    message: string;
}
