import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { UsersRepository, UserPreferencesRecord, UserRole } from '../../database/repositories/users.repository';
import { UserStatusService } from '../auth/user-status.service';
import { UserProfileDto, UserPreferencesDto } from './dto/user-response.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserProfileDto } from './dto/user-profile.dto';
import { SetRoleResponseDto } from './dto/set-role.dto';

/**
 * Handles all business logic for the users module.
 * Coordinates with UsersRepository for data access.
 */
@Injectable()
export class UsersService {
    constructor(
        private readonly usersRepository: UsersRepository,
        private readonly userStatusService: UserStatusService,
    ) { }

    /**
     * Retrieves the authenticated user's profile including preferences.
     *
     * Handles three cases:
     * 1. Returning user with preferences → return as-is
     * 2. First login (no user row) → create user + create default preferences
     * 3. Legacy user without preferences row → create default preferences on the fly
     *
     * @param wallet - Stellar wallet address extracted from the JWT by JwtAuthGuard (API-03)
     */
    async getOrCreateProfile(wallet: string): Promise<UserProfileDto> {
        let user = await this.usersRepository.findByWallet(wallet);
        let preferences: UserPreferencesRecord;

        if (!user) {
            // Case 2: First login — create user, then create default preferences
            user = await this.usersRepository.create(wallet);
            preferences = await this.usersRepository.createDefaultPreferences(user.id);
        } else if (!user.user_preferences) {
            // Case 3: Legacy user with no preferences row yet
            preferences = await this.usersRepository.createDefaultPreferences(user.id);
        } else {
            // Case 1: Happy path
            preferences = user.user_preferences;
        }

        return {
            wallet: user.wallet_address,
            name: user.display_name,
            avatar: user.avatar_url,
            role: user.role ?? null,
            preferences: this.mapPreferences(preferences),
            createdAt: user.created_at,
        };
    }

    /**
     * Sets the user's permanent role — allowed exactly once per wallet.
     *
     * The write itself is atomic (`UPDATE ... WHERE role IS NULL` in the
     * repository), so concurrent requests cannot both succeed. The read
     * beforehand only exists to distinguish "role already set" (409) from
     * "user does not exist" (404) in the error response.
     *
     * @param wallet - Stellar wallet address extracted from the JWT
     * @param role   - Validated role value: sponsor | vendor | mentor
     */
    async setRole(wallet: string, role: UserRole): Promise<SetRoleResponseDto> {
        const updated = await this.usersRepository.setRoleIfUnset(wallet, role);

        if (!updated) {
            const existingRole = await this.usersRepository.findRoleByWallet(wallet);
            if (existingRole) {
                throw new ConflictException({
                    code: 'USERS_ROLE_ALREADY_SET',
                    message: 'Role already set for this wallet and cannot be changed.',
                });
            }
            throw new NotFoundException({
                code: 'USERS_NOT_FOUND',
                message: 'User not found.',
            });
        }

        this.userStatusService.invalidate(wallet);

        return { wallet: updated.wallet_address, role: updated.role };
    }

    /**
     * Updates the authenticated user's profile fields and/or preferences.
     * Sanitizes the name field (HTML stripping, XSS prevention) and enforces
     * HTTPS-only avatar URLs as a defense-in-depth layer on top of DTO validation.
     *
     * @param wallet - Stellar wallet address extracted from the JWT by JwtAuthGuard (API-03)
     * @param dto    - Validated update payload (API-05)
     */
    async updateProfile(wallet: string, dto: UpdateUserDto): Promise<UpdateUserProfileDto> {
        // Defense-in-depth: reject non-HTTPS avatar URLs even if DTO validation is bypassed
        if (dto.avatar !== undefined && !dto.avatar.startsWith('https://')) {
            throw new BadRequestException({
                code: 'USERS_AVATAR_INVALID_SCHEME',
                message: 'Avatar URL must use HTTPS.',
            });
        }

        const sanitizedDto: UpdateUserDto = { ...dto };

        // Strip HTML from name to prevent XSS stored in the profile.
        // Step 1: remove script/style blocks including their content.
        // Step 2: remove remaining HTML tags.
        if (dto.name !== undefined) {
            sanitizedDto.name = dto.name
                .replace(/<(script|style)[^>]*>[\s\S]*?<\/(script|style)>/gi, '')
                .replace(/<[^>]*>/g, '')
                .trim();
        }

        const user = await this.usersRepository.update(wallet, sanitizedDto);

        // Fetch the latest preferences to return the full updated profile
        const profile = await this.usersRepository.findByWallet(wallet);
        const preferences = profile?.user_preferences ?? {
            notifications_enabled: true,
            language: 'en',
            theme: 'system',
        };

        return {
            wallet: user.wallet_address,
            name: user.display_name,
            avatar: user.avatar_url,
            preferences: this.mapPreferences(preferences),
            updatedAt: user.updated_at,
        };
    }

    private mapPreferences(prefs: UserPreferencesRecord): UserPreferencesDto {
        return {
            notifications: prefs.notifications_enabled,
            theme: prefs.theme,
            language: prefs.language,
        };
    }
}