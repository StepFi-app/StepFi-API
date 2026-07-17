import { Test, TestingModule } from '@nestjs/testing';
import { LearnersService } from '../../../../src/modules/learners/learners.service';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { NotFoundException } from '@nestjs/common';
import { UpdateLearnerProfileDto, FinanceGoal } from '../../../../src/modules/learners/dto/learner-profile.dto';

describe('LearnersService', () => {
  let service: LearnersService;
  let supabaseService: SupabaseService;

  const mockWallet = '0x123';
  const mockExistingProfile = {
    wallet_address: mockWallet,
    full_name: 'Test',
    country: 'US',
    finance_goals: [],
    profile_complete: false,
    onboarding_completed_at: null,
  };

  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(),
    upsert: jest.fn().mockReturnThis(),
  };

  const mockSupabaseClient = {
    from: jest.fn().mockReturnValue(mockQueryBuilder),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LearnersService,
        {
          provide: SupabaseService,
          useValue: {
            getClient: jest.fn().mockReturnValue(mockSupabaseClient),
            getServiceRoleClient: jest.fn().mockReturnValue(mockSupabaseClient),
          },
        },
      ],
    }).compile();

    service = module.get<LearnersService>(LearnersService);
    supabaseService = module.get<SupabaseService>(SupabaseService);

    jest.clearAllMocks();
  });

  describe('getProfile', () => {
    it('should return profile if found', async () => {
      mockQueryBuilder.single.mockResolvedValueOnce({ data: mockExistingProfile, error: null });
      const result = await service.getProfile(mockWallet);
      expect(result.walletAddress).toBe(mockWallet);
      expect(result.fullName).toBe('Test');
    });

    it('should throw NotFoundException if profile not found', async () => {
      mockQueryBuilder.single.mockResolvedValueOnce({ data: null, error: { message: 'Not found' } });
      await expect(service.getProfile(mockWallet)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getCompletionStatus', () => {
    it('should return missing fields if incomplete', async () => {
      mockQueryBuilder.single.mockResolvedValueOnce({ data: mockExistingProfile, error: null });
      const result = await service.getCompletionStatus(mockWallet);
      expect(result.complete).toBe(false);
      expect(result.missingFields).toContain('financeGoals');
    });

    it('should handle missing profile by returning all required fields missing', async () => {
      mockQueryBuilder.single.mockResolvedValueOnce({ data: null, error: { message: 'Not found' } });
      const result = await service.getCompletionStatus(mockWallet);
      expect(result.complete).toBe(false);
      expect(result.missingFields).toEqual(['fullName', 'country', 'financeGoals']);
    });
  });

  describe('upsertProfile', () => {
    it('should set profile_complete to true when all required fields are provided', async () => {
      mockQueryBuilder.single.mockResolvedValueOnce({ data: mockExistingProfile, error: null });
      mockQueryBuilder.single.mockResolvedValueOnce({
        data: { ...mockExistingProfile, profile_complete: true, onboarding_completed_at: new Date().toISOString() },
        error: null,
      });

      const dto: UpdateLearnerProfileDto = { finance_goals: [FinanceGoal.LAPTOP] };
      const result = await service.upsertProfile(mockWallet, dto);
      
      expect(mockQueryBuilder.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ profile_complete: true, onboarding_completed_at: expect.any(String) }),
        expect.any(Object)
      );
      expect(result.profileComplete).toBe(true);
    });
  });
});
