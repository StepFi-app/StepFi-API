import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminRolesController } from '../../../../src/modules/admin/admin-roles.controller';
import { UsersRepository } from '../../../../src/database/repositories/users.repository';
import { UserStatusService } from '../../../../src/modules/auth/user-status.service';
import { AuditInterceptor } from '../../../../src/common/interceptors/audit.interceptor';
import { Reflector } from '@nestjs/core';

describe('AdminRolesController', () => {
  let controller: AdminRolesController;
  let usersRepository: UsersRepository;
  let userStatusService: UserStatusService;

  const validWallet = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

  const mockUsersRepository = {
    forceSetRole: jest.fn(),
  };

  const mockUserStatusService = {
    invalidate: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminRolesController],
      providers: [
        Reflector,
        AuditInterceptor,
        { provide: UsersRepository, useValue: mockUsersRepository },
        { provide: UserStatusService, useValue: mockUserStatusService },
      ],
    }).compile();

    controller = module.get<AdminRolesController>(AdminRolesController);
    usersRepository = module.get<UsersRepository>(UsersRepository);
    userStatusService = module.get<UserStatusService>(UserStatusService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should reset user role to null and invalidate cache', async () => {
    mockUsersRepository.forceSetRole.mockResolvedValue({ wallet_address: validWallet, role: null });

    const result = await controller.resetUserRole(validWallet);

    expect(mockUsersRepository.forceSetRole).toHaveBeenCalledWith(validWallet, null);
    expect(mockUserStatusService.invalidate).toHaveBeenCalledWith(validWallet);
    expect(result.success).toBe(true);
    expect(result.data.role).toBeNull();
  });

  it('should update user role to specified role and invalidate cache', async () => {
    mockUsersRepository.forceSetRole.mockResolvedValue({ wallet_address: validWallet, role: 'sponsor' });

    const result = await controller.resetUserRole(validWallet, { role: 'sponsor' });

    expect(mockUsersRepository.forceSetRole).toHaveBeenCalledWith(validWallet, 'sponsor');
    expect(mockUserStatusService.invalidate).toHaveBeenCalledWith(validWallet);
    expect(result.data.role).toBe('sponsor');
  });

  it('should throw NotFoundException (404 USERS_NOT_FOUND) when target user does not exist', async () => {
    mockUsersRepository.forceSetRole.mockResolvedValue(null);

    await expect(controller.resetUserRole(validWallet)).rejects.toMatchObject({
      response: { code: 'USERS_NOT_FOUND' },
    });
  });
});
