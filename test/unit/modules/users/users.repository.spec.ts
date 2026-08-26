import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import { UsersRepository } from '../../../../src/database/repositories/users.repository';
import { SupabaseService } from '../../../../src/database/supabase.client';

describe('UsersRepository', () => {
  let repository: UsersRepository;

  const mockInsert = jest.fn();
  const mockSelect = jest.fn();
  const mockSingle = jest.fn();
  const mockDelete = jest.fn();
  const mockEq = jest.fn();

  const mockStorageFrom = jest.fn();
  const mockUpload = jest.fn();
  const mockRemove = jest.fn();
  const mockGetPublicUrl = jest.fn();

  const mockSupabaseClient = {
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'users') {
        return {
          insert: mockInsert.mockReturnValue({
            select: mockSelect.mockReturnValue({
              single: mockSingle,
            }),
          }),
          delete: mockDelete.mockReturnValue({
            eq: mockEq,
          }),
        };
      }
      return {};
    }),
    storage: {
      from: mockStorageFrom.mockReturnValue({
        upload: mockUpload,
        remove: mockRemove,
        getPublicUrl: mockGetPublicUrl,
      }),
    },
  };

  const mockSupabaseService = {
    getServiceRoleClient: jest.fn(() => mockSupabaseClient),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersRepository,
        { provide: SupabaseService, useValue: mockSupabaseService },
      ],
    }).compile();

    repository = module.get<UsersRepository>(UsersRepository);
    jest.clearAllMocks();
  });

  describe('createProfile', () => {
    const profileData = {
      wallet: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
      username: 'testuser',
      displayName: 'Test User',
      avatarUrl: null,
    };

    it('should insert user and return created profile record', async () => {
      const mockCreatedUser = {
        id: 'user-123',
        wallet_address: profileData.wallet,
        username: profileData.username,
        display_name: profileData.displayName,
        avatar_url: null,
        status: 'active',
        role: null,
        created_at: new Date().toISOString(),
      };

      mockSingle.mockResolvedValue({ data: mockCreatedUser, error: null });

      const result = await repository.createProfile(profileData);

      expect(result.id).toBe('user-123');
      expect(result.wallet_address).toBe(profileData.wallet);
    });

    it('should throw ConflictException (AUTH_WALLET_EXISTS) on wallet address unique constraint violation (code 23505)', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "users_wallet_address_key"',
          details: 'Key (wallet_address)=(G123...) already exists.',
        },
      });

      await expect(repository.createProfile(profileData)).rejects.toMatchObject({
        response: {
          code: 'AUTH_WALLET_EXISTS',
          message: 'Wallet address is already registered.',
        },
      });
    });

    it('should throw ConflictException (AUTH_USERNAME_TAKEN) on username unique constraint violation (code 23505)', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "users_username_key"',
          details: 'Key (username)=(testuser) already exists.',
        },
      });

      await expect(repository.createProfile(profileData)).rejects.toMatchObject({
        response: {
          code: 'AUTH_USERNAME_TAKEN',
          message: 'Username is already taken.',
        },
      });
    });

    it('should throw InternalServerErrorException on non-unique DB insert error', async () => {
      mockSingle.mockResolvedValue({
        data: null,
        error: {
          code: '42P01',
          message: 'relation "users" does not exist',
        },
      });

      await expect(repository.createProfile(profileData)).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('deleteAvatar', () => {
    it('should remove file from avatars bucket', async () => {
      mockRemove.mockResolvedValue({ error: null });
      await repository.deleteAvatar('https://example.com/storage/v1/object/public/avatars/G123-12345.png');

      expect(mockStorageFrom).toHaveBeenCalledWith('avatars');
      expect(mockRemove).toHaveBeenCalledWith(['G123-12345.png']);
    });
  });

  describe('deleteUserById', () => {
    it('should delete user from users table by id', async () => {
      mockEq.mockResolvedValue({ error: null });
      await repository.deleteUserById('user-123');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('users');
      expect(mockDelete).toHaveBeenCalled();
      expect(mockEq).toHaveBeenCalledWith('id', 'user-123');
    });
  });
});
