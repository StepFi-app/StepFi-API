import { Injectable, InternalServerErrorException, ConflictException } from '@nestjs/common';
import { SupabaseService } from '../supabase.client';
import { UpdateUserDto } from '../../modules/users/dto/update-user.dto';

/** Multipart upload file shape produced by the profile-image interceptor. */
export interface UploadedAvatarFile {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size?: number;
}

export interface UserPreferencesRecord {
    notifications_enabled: boolean;
    language: string;
    theme: string;
}

export type UserRole = 'sponsor' | 'vendor' | 'mentor';

export interface UserRecord {
    id: string;
    wallet_address: string;
    username?: string | null;
    display_name: string | null;
    avatar_url: string | null;
    status: 'active' | 'blocked';
    /** Permanent role chosen once after registration — null until chosen */
    role: UserRole | null;
    created_at: string;
    /** Nested from user_preferences table — null if row does not exist yet */
    user_preferences: UserPreferencesRecord | null;
}

/**
 * Encapsulates all Supabase queries for the `users` table.
 *
 * The service-role client is used for write operations so that
 * Row Level Security does not block the auto-creation on first login.
 */
@Injectable()
export class UsersRepository {
    constructor(private readonly supabaseService: SupabaseService) { }

    /**
     * Returns the user row (with nested preferences) matching the wallet,
     * or null if no matching row exists yet.
     *
     * Note: Supabase nested selects always return the relation as an array,
     * even for 1-to-1 relations. We normalize it to a single record here.
     */
    async findByWallet(wallet: string): Promise<UserRecord | null> {
        const { data, error } = await this.supabaseService
            .getServiceRoleClient()
            .from('users')
            .select(
                'id, wallet_address, username, display_name, avatar_url, status, role, created_at, user_preferences(notifications_enabled, language, theme)',
            )
            .eq('wallet_address', wallet)
            .maybeSingle();

        if (error) {
            throw new InternalServerErrorException({
                code: 'DATABASE_QUERY_ERROR',
                message: error.message,
            });
        }
        if (!data) return null;

        // Normalize: Supabase returns the nested relation as an array
        const raw = data as unknown as Omit<UserRecord, 'user_preferences'> & {
            user_preferences: UserPreferencesRecord[];
        };

        return {
            ...raw,
            user_preferences: raw.user_preferences?.[0] ?? null,
        };
    }

    /**
     * Inserts a new user row with default values for the given wallet address.
     * Called automatically on the user's first authenticated request.
     */
    async create(wallet: string): Promise<UserRecord> {
        const { data, error } = await this.supabaseService
            .getServiceRoleClient()
            .from('users')
            .insert({ wallet_address: wallet })
            .select('id, wallet_address, username, display_name, avatar_url, status, role, created_at')
            .single();

        if (error) {
            throw new InternalServerErrorException({
                code: 'DATABASE_QUERY_ERROR',
                message: error.message,
            });
        }

        return { ...(data as Omit<UserRecord, 'user_preferences'>), user_preferences: null };
    }

    /**
     * Inserts a default user_preferences row for the given user ID.
     * Called when a user exists but has no preferences row yet (first-access or legacy users).
     */
    async createDefaultPreferences(userId: string): Promise<UserPreferencesRecord> {
        const { data, error } = await this.supabaseService
            .getServiceRoleClient()
            .from('user_preferences')
            .insert({ user_id: userId })
            .select('notifications_enabled, language, theme')
            .single();

        if (error) {
            throw new InternalServerErrorException({
                code: 'DATABASE_QUERY_ERROR',
                message: error.message,
            });
        }
        return data as UserPreferencesRecord;
    }

    /**
     * Updates the user's profile fields and/or preferences.
     * Uses upsert so the row is created if it doesn't exist yet.
     * `updated_at` is maintained automatically by the DB trigger.
     *
     * @param wallet - Stellar wallet address (from JWT via JwtAuthGuard)
     * @param data   - Validated and sanitized update payload (API-05)
     */
    async update(
        wallet: string,
        data: UpdateUserDto,
    ): Promise<{ wallet_address: string; display_name: string | null; avatar_url: string | null; updated_at: string; id: string }> {
        const client = this.supabaseService.getServiceRoleClient();

        // Build the users table payload — only include provided fields
        const userPayload: Record<string, unknown> = { wallet_address: wallet };
        if (data.name !== undefined) userPayload.display_name = data.name;
        if (data.avatar !== undefined) userPayload.avatar_url = data.avatar;

        const { data: user, error: userError } = await client
            .from('users')
            .upsert(userPayload, { onConflict: 'wallet_address' })
            .select('id, wallet_address, display_name, avatar_url, updated_at')
            .single();

        if (userError || !user) {
            throw new InternalServerErrorException({
                code: 'DATABASE_USER_UPDATE_FAILED',
                message: 'Failed to update user profile.',
            });
        }

        // Update preferences if provided
        if (data.preferences !== undefined) {
            const prefPayload: Record<string, unknown> = { user_id: user.id };
            if (data.preferences.notifications !== undefined) prefPayload.notifications_enabled = data.preferences.notifications;
            if (data.preferences.theme !== undefined) prefPayload.theme = data.preferences.theme;
            if (data.preferences.language !== undefined) prefPayload.language = data.preferences.language;

            const { error: prefError } = await client
                .from('user_preferences')
                .upsert(prefPayload, { onConflict: 'user_id' });

            if (prefError) {
                throw new InternalServerErrorException({
                    code: 'DATABASE_PREFERENCES_UPDATE_FAILED',
                    message: 'Failed to update user preferences.',
                });
            }
        }

        return user as { wallet_address: string; display_name: string | null; avatar_url: string | null; updated_at: string; id: string };
    }

    /**
     * Returns only the user's current role, or null if the user does not exist
     * or has not chosen a role yet.
     */
    async findRoleByWallet(wallet: string): Promise<UserRole | null> {
        const { data, error } = await this.supabaseService
            .getServiceRoleClient()
            .from('users')
            .select('role')
            .eq('wallet_address', wallet)
            .maybeSingle();

        if (error) {
            throw new InternalServerErrorException({
                code: 'DATABASE_QUERY_ERROR',
                message: error.message,
            });
        }
        return (data?.role as UserRole | undefined) ?? null;
    }

    /**
     * Sets the user's role, but only if no role is set yet.
     *
     * The `.is('role', null)` filter makes the write atomic: two concurrent
     * requests cannot both succeed, because the second one matches zero rows.
     * Returns the updated row, or null when no row was updated (role already
     * set, or user does not exist).
     */
    async setRoleIfUnset(
        wallet: string,
        role: UserRole,
    ): Promise<{ wallet_address: string; role: UserRole } | null> {
        const { data, error } = await this.supabaseService
            .getServiceRoleClient()
            .from('users')
            .update({ role })
            .eq('wallet_address', wallet)
            .is('role', null)
            .select('wallet_address, role')
            .maybeSingle();

        if (error) {
            throw new InternalServerErrorException({
                code: 'DATABASE_ROLE_UPDATE_FAILED',
                message: 'Failed to set user role.',
            });
        }
        return (data as { wallet_address: string; role: UserRole } | null) ?? null;
    }

    /**
     * Admin override: sets or resets the user's role regardless of whether a role was set previously.
     * Returns the updated user row, or null if the user does not exist.
     */
    async forceSetRole(
        wallet: string,
        role: UserRole | null,
    ): Promise<{ wallet_address: string; role: UserRole | null } | null> {
        const { data, error } = await this.supabaseService
            .getServiceRoleClient()
            .from('users')
            .update({ role })
            .eq('wallet_address', wallet)
            .select('wallet_address, role')
            .maybeSingle();

        if (error) {
            throw new InternalServerErrorException({
                code: 'DATABASE_ROLE_UPDATE_FAILED',
                message: 'Failed to update user role.',
            });
        }
        return (data as { wallet_address: string; role: UserRole | null } | null) ?? null;
    }

    // --- REGISTRATION METHODS ---

    async checkUsernameExists(username: string): Promise<boolean> {
        const { data, error } = await this.supabaseService
            .getServiceRoleClient()
            .from('users')
            .select('id')
            .eq('username', username)
            .maybeSingle();

        if (error) {
            throw new InternalServerErrorException({
                code: 'DATABASE_QUERY_ERROR',
                message: error.message,
            });
        }
        return !!data;
    }

    async createProfile(data: { wallet: string; username: string; displayName: string; avatarUrl: string | null }): Promise<UserRecord> {
        const { data: user, error } = await this.supabaseService
            .getServiceRoleClient()
            .from('users')
            .insert({
                wallet_address: data.wallet,
                username: data.username,
                display_name: data.displayName,
                avatar_url: data.avatarUrl,
                status: 'active',
            })
            .select('id, wallet_address, username, display_name, avatar_url, status, role, created_at')
            .single();

        if (error) {
            const combinedErr = `${error.code || ''} ${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
            if (error.code === '23505' || combinedErr.includes('duplicate key') || combinedErr.includes('unique constraint')) {
                if (combinedErr.includes('username')) {
                    throw new ConflictException({
                        code: 'AUTH_USERNAME_TAKEN',
                        message: 'Username is already taken.',
                    });
                }
                throw new ConflictException({
                    code: 'AUTH_WALLET_EXISTS',
                    message: 'Wallet address is already registered.',
                });
            }
            throw new InternalServerErrorException({
                code: 'DATABASE_INSERT_ERROR',
                message: `Failed to create user profile: ${error.message}`,
            });
        }

        return { ...(user as Omit<UserRecord, 'user_preferences'>), user_preferences: null };
    }

    async uploadAvatar(walletAddress: string, file: UploadedAvatarFile): Promise<string> {
        const fileExt = file.originalname.split('.').pop();
        const fileName = `${walletAddress}-${Date.now()}.${fileExt}`;
        const client = this.supabaseService.getServiceRoleClient();

        const { error } = await client
            .storage
            .from('avatars')
            .upload(fileName, file.buffer, {
                contentType: file.mimetype,
                upsert: true,
            });

        if (error) {
            throw new InternalServerErrorException({
                code: 'STORAGE_UPLOAD_FAILED',
                message: `Failed to upload avatar: ${error.message}`,
            });
        }

        const { data } = client.storage.from('avatars').getPublicUrl(fileName);
        return data.publicUrl;
    }

    async deleteAvatar(avatarUrl: string): Promise<void> {
        try {
            const fileName = avatarUrl.substring(avatarUrl.lastIndexOf('/') + 1);
            if (!fileName) return;
            const client = this.supabaseService.getServiceRoleClient();
            await client.storage.from('avatars').remove([fileName]);
        } catch {
            // Ignore cleanup failures
        }
    }

    async deleteUserById(id: string): Promise<void> {
        try {
            const client = this.supabaseService.getServiceRoleClient();
            await client.from('users').delete().eq('id', id);
        } catch {
            // Ignore cleanup failures
        }
    }
}

