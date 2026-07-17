import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from '../../../../src/modules/users/users.service';
import { UsersRepository } from '../../../../src/database/repositories/users.repository';
import { UpdateUserDto } from '../../../../src/modules/users/dto/update-user.dto';

describe('UsersService', () => {
    let service: UsersService;
    let repository: UsersRepository;

    const mockPreferences = {
        notifications_enabled: true,
        language: 'en',
        theme: 'system',
    };

    const mockExistingUser = {
        id: 'uuid-123',
        wallet_address: 'GABC123XYZ456DEF789ABCDEF0123456789ABCDEF0123456789ABCDEFGHIJ',
        display_name: 'Maria Garcia',
        avatar_url: 'https://example.com/avatar.png',
        status: 'active' as const,
        created_at: '2026-02-13T10:00:00.000Z',
        user_preferences: mockPreferences,
    };

    const mockNewUser = {
        id: 'uuid-456',
        wallet_address: 'GNEW123XYZ456DEF789ABCDEF0123456789ABCDEF0123456789ABCDEFGHIJ',
        display_name: null,
        avatar_url: null,
        status: 'active' as const,
        created_at: '2026-02-19T14:00:00.000Z',
        user_preferences: null,
    };

    const mockUsersRepository = {
        findByWallet: jest.fn(),
        create: jest.fn(),
        createDefaultPreferences: jest.fn(),
        update: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                UsersService,
                {
                    provide: UsersRepository,
                    useValue: mockUsersRepository,
                },
            ],
        }).compile();

        service = module.get<UsersService>(UsersService);
        repository = module.get<UsersRepository>(UsersRepository);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    // ---------------------------------------------------------------------------
    // getOrCreateProfile (API-04)
    // ---------------------------------------------------------------------------
    describe('getOrCreateProfile', () => {
        it('Case 1: returns existing user profile with preferences (no writes)', async () => {
            mockUsersRepository.findByWallet.mockResolvedValue(mockExistingUser);

            const result = await service.getOrCreateProfile(mockExistingUser.wallet_address);

            expect(repository.findByWallet).toHaveBeenCalledWith(mockExistingUser.wallet_address);
            expect(repository.create).not.toHaveBeenCalled();
            expect(repository.createDefaultPreferences).not.toHaveBeenCalled();
            expect(result).toEqual({
                wallet: mockExistingUser.wallet_address,
                name: mockExistingUser.display_name,
                avatar: mockExistingUser.avatar_url,
                role: null,
                preferences: {
                    notifications: mockPreferences.notifications_enabled,
                    theme: mockPreferences.theme,
                    language: mockPreferences.language,
                },
                createdAt: mockExistingUser.created_at,
            });
        });

        it('Case 2: creates a new user and default preferences on first login', async () => {
            mockUsersRepository.findByWallet.mockResolvedValue(null);
            mockUsersRepository.create.mockResolvedValue(mockNewUser);
            mockUsersRepository.createDefaultPreferences.mockResolvedValue(mockPreferences);

            const result = await service.getOrCreateProfile(mockNewUser.wallet_address);

            expect(repository.findByWallet).toHaveBeenCalledWith(mockNewUser.wallet_address);
            expect(repository.create).toHaveBeenCalledWith(mockNewUser.wallet_address);
            expect(repository.createDefaultPreferences).toHaveBeenCalledWith(mockNewUser.id);
            expect(result.wallet).toBe(mockNewUser.wallet_address);
            expect(result.name).toBeNull();
            expect(result.preferences.notifications).toBe(true);
        });

        it('Case 3: creates default preferences for a legacy user missing them', async () => {
            const legacyUser = { ...mockExistingUser, user_preferences: null };
            mockUsersRepository.findByWallet.mockResolvedValue(legacyUser);
            mockUsersRepository.createDefaultPreferences.mockResolvedValue(mockPreferences);

            const result = await service.getOrCreateProfile(legacyUser.wallet_address);

            expect(repository.create).not.toHaveBeenCalled();
            expect(repository.createDefaultPreferences).toHaveBeenCalledWith(legacyUser.id);
            expect(result.preferences.theme).toBe('system');
        });

        it('should propagate error if findByWallet fails', async () => {
            mockUsersRepository.findByWallet.mockRejectedValue(new Error('DB connection failed'));

            await expect(service.getOrCreateProfile('GABC...')).rejects.toThrow('DB connection failed');
        });

        it('should propagate error if create fails', async () => {
            mockUsersRepository.findByWallet.mockResolvedValue(null);
            mockUsersRepository.create.mockRejectedValue(new Error('Insertion failed'));

            await expect(service.getOrCreateProfile('GABC...')).rejects.toThrow('Insertion failed');
        });

        it('should propagate error if createDefaultPreferences fails during first login', async () => {
            mockUsersRepository.findByWallet.mockResolvedValue(null);
            mockUsersRepository.create.mockResolvedValue(mockNewUser);
            mockUsersRepository.createDefaultPreferences.mockRejectedValue(new Error('Pref creation failed'));

            await expect(service.getOrCreateProfile('GABC...')).rejects.toThrow('Pref creation failed');
        });
    });

    // ---------------------------------------------------------------------------
    // updateProfile (API-05)
    // ---------------------------------------------------------------------------
    describe('updateProfile', () => {
        const wallet = mockExistingUser.wallet_address;

        const mockUpdatedUser = {
            id: mockExistingUser.id,
            wallet_address: wallet,
            display_name: 'Maria Garcia',
            avatar_url: null,
            updated_at: '2026-02-20T10:00:00.000Z',
        };

        beforeEach(() => {
            mockUsersRepository.update.mockResolvedValue(mockUpdatedUser);
            mockUsersRepository.findByWallet.mockResolvedValue(mockExistingUser);
        });

        it('should update name successfully', async () => {
            const result = await service.updateProfile(wallet, { name: 'Maria Garcia' });

            expect(repository.update).toHaveBeenCalledWith(
                wallet,
                expect.objectContaining({ name: 'Maria Garcia' }),
            );
            expect(result.name).toBe('Maria Garcia');
        });

        it('should update avatar successfully', async () => {
            mockUsersRepository.update.mockResolvedValue({
                ...mockUpdatedUser,
                avatar_url: 'https://example.com/avatar.jpg',
            });

            const result = await service.updateProfile(wallet, {
                avatar: 'https://example.com/avatar.jpg',
            });

            expect(repository.update).toHaveBeenCalledWith(
                wallet,
                expect.objectContaining({ avatar: 'https://example.com/avatar.jpg' }),
            );
            expect(result.avatar).toBe('https://example.com/avatar.jpg');
        });

        it('should update preferences successfully', async () => {
            const userWithUpdatedPrefs = {
                ...mockExistingUser,
                user_preferences: { notifications_enabled: false, language: 'es', theme: 'dark' },
            };
            mockUsersRepository.findByWallet.mockResolvedValue(userWithUpdatedPrefs);

            const result = await service.updateProfile(wallet, {
                preferences: { notifications: false, language: 'es', theme: 'dark' },
            });

            expect(repository.update).toHaveBeenCalledWith(
                wallet,
                expect.objectContaining({
                    preferences: { notifications: false, language: 'es', theme: 'dark' },
                }),
            );
            expect(result.preferences).toEqual({
                notifications: false,
                language: 'es',
                theme: 'dark',
            });
        });

        it('should throw BadRequestException when avatar URL does not use HTTPS', async () => {
            await expect(
                service.updateProfile(wallet, { avatar: 'http://example.com/avatar.jpg' }),
            ).rejects.toMatchObject({
                response: { code: 'USERS_AVATAR_INVALID_SCHEME' },
            });

            expect(repository.update).not.toHaveBeenCalled();
        });

        it('should strip HTML tags from name before saving', async () => {
            await service.updateProfile(wallet, { name: '<script>alert(1)</script>Maria' });

            expect(repository.update).toHaveBeenCalledWith(
                wallet,
                expect.objectContaining({ name: 'Maria' }),
            );
        });

        it('should handle repository.update failure (e.g. database error)', async () => {
            mockUsersRepository.update.mockRejectedValue(new Error('Update failed'));

            await expect(service.updateProfile(wallet, { name: 'Maria' })).rejects.toThrow('Update failed');
        });

        it('should use default preferences if findByWallet returns null after update', async () => {
            mockUsersRepository.update.mockResolvedValue(mockUpdatedUser);
            mockUsersRepository.findByWallet.mockResolvedValue(null); // Edge case

            const result = await service.updateProfile(wallet, { name: 'Maria' });

            expect(result.preferences).toEqual({
                notifications: true,
                language: 'en',
                theme: 'system',
            });
        });

        it('should handle case where user exists but group preferences are missing after update', async () => {
            mockUsersRepository.update.mockResolvedValue(mockUpdatedUser);
            mockUsersRepository.findByWallet.mockResolvedValue({
                ...mockExistingUser,
                user_preferences: null,
            });

            const result = await service.updateProfile(wallet, { name: 'Maria' });

            expect(result.preferences).toEqual({
                notifications: true,
                language: 'en',
                theme: 'system',
            });
        });

        it('should update all fields successfully when multiple are provided', async () => {
            const multiUpdateDto: UpdateUserDto = {
                name: 'Maria G',
                avatar: 'https://example.com/new.jpg',
                preferences: { notifications: false, theme: 'dark', language: 'es' },
            };

            const updatedUserRecord = {
                ...mockUpdatedUser,
                display_name: 'Maria G',
                avatar_url: 'https://example.com/new.jpg',
            };

            const updatedPrefsRecord = {
                notifications_enabled: false,
                theme: 'dark',
                language: 'es',
            };

            mockUsersRepository.update.mockResolvedValue(updatedUserRecord);
            mockUsersRepository.findByWallet.mockResolvedValue({
                ...mockExistingUser,
                display_name: 'Maria G',
                avatar_url: 'https://example.com/new.jpg',
                user_preferences: updatedPrefsRecord,
            });

            const result = await service.updateProfile(wallet, multiUpdateDto);

            expect(repository.update).toHaveBeenCalledWith(wallet, multiUpdateDto);
            expect(result.name).toBe('Maria G');
            expect(result.avatar).toBe('https://example.com/new.jpg');
            expect(result.preferences).toEqual({
                notifications: false,
                theme: 'dark',
                language: 'es',
            });
        });
    });
});
