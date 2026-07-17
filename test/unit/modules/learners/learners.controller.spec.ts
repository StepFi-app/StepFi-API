import { Test, TestingModule } from '@nestjs/testing';
import { LearnersController } from '../../../../src/modules/learners/learners.controller';
import { LearnersService } from '../../../../src/modules/learners/learners.service';
import { UpdateLearnerProfileDto } from '../../../../src/modules/learners/dto/learner-profile.dto';

describe('LearnersController', () => {
  let controller: LearnersController;
  let service: LearnersService;

  const mockService = {
    getProfile: jest.fn(),
    upsertProfile: jest.fn(),
    getCompletionStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LearnersController],
      providers: [
        {
          provide: LearnersService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<LearnersController>(LearnersController);
    service = module.get<LearnersService>(LearnersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getProfile', () => {
    it('should call service getProfile', async () => {
      const user = { wallet: '0x123' };
      mockService.getProfile.mockResolvedValueOnce({ walletAddress: '0x123' });
      const result = await controller.getProfile(user);
      expect(service.getProfile).toHaveBeenCalledWith('0x123');
      expect(result).toEqual({ walletAddress: '0x123' });
    });
  });

  describe('updateProfile', () => {
    it('should call service upsertProfile', async () => {
      const user = { wallet: '0x123' };
      const dto: UpdateLearnerProfileDto = { full_name: 'Test' };
      mockService.upsertProfile.mockResolvedValueOnce({ fullName: 'Test' });
      const result = await controller.updateProfile(user, dto);
      expect(service.upsertProfile).toHaveBeenCalledWith('0x123', dto);
      expect(result).toEqual({ fullName: 'Test' });
    });
  });

  describe('getCompletionStatus', () => {
    it('should call service getCompletionStatus', async () => {
      const user = { wallet: '0x123' };
      mockService.getCompletionStatus.mockResolvedValueOnce({ complete: true, missingFields: [] });
      const result = await controller.getCompletionStatus(user);
      expect(service.getCompletionStatus).toHaveBeenCalledWith('0x123');
      expect(result).toEqual({ complete: true, missingFields: [] });
    });
  });
});
