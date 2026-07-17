import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export const USER_ROLES = ['sponsor', 'vendor', 'mentor'] as const;
export type UserRoleValue = (typeof USER_ROLES)[number];

/**
 * Body for PATCH /users/me/role — one-time role selection.
 */
export class SetRoleDto {
    @ApiProperty({
        enum: USER_ROLES,
        example: 'sponsor',
        description: 'Permanent role for this wallet. Can only be set once.',
    })
    @IsIn(USER_ROLES, { message: `role must be one of: ${USER_ROLES.join(', ')}` })
    role: UserRoleValue;
}

/**
 * The data payload returned by PATCH /users/me/role.
 */
export class SetRoleResponseDto {
    @ApiProperty({ example: 'GABC...XYZ', description: 'Stellar wallet address' })
    wallet: string;

    @ApiProperty({ enum: USER_ROLES, example: 'sponsor', description: 'The role that was just set' })
    role: UserRoleValue;
}
