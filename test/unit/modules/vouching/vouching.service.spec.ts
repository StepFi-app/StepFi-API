import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { VouchingService } from '../../../../src/modules/vouching/vouching.service';
import { SupabaseService } from '../../../../src/database/supabase.client';
import { VouchStatus } from '../../../../src/modules/vouching/dto/vouch.dto';

/**
 * Chainable + thenable Supabase query-builder mock: every method returns the
 * same object, and awaiting any terminal call resolves to `result`.
 */
function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'maybeSingle', 'single']) {
    c[m] = jest.fn().mockReturnValue(c);
  }
  (c as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(result);
  return c;
}

describe('VouchingService', () => {
  let service: VouchingService;

  const mentorWallet = 'GMENTOR456789ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJK';
  const otherMentor = 'GOTHER6789ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMN';
  const vouchId = '11111111-1111-1111-1111-111111111111';

  const vouchRow = {
    id: vouchId,
    mentor_wallet: mentorWallet,
    learner_wallet: 'GLEARNER89ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLM',
    message: 'ok',
    status: VouchStatus.APPROVED,
    created_at: '2026-07-01T00:00:00.000Z',
    expires_at: '2026-10-01T00:00:00.000Z',
  };

  const mockSupabaseClient = { from: jest.fn() };
  const mockSupabaseService = {
    getClient: jest.fn(),
    getServiceRoleClient: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VouchingService,
        { provide: SupabaseService, useValue: mockSupabaseService },
      ],
    }).compile();

    service = module.get<VouchingService>(VouchingService);
    jest.clearAllMocks();
    mockSupabaseService.getClient.mockReturnValue(mockSupabaseClient);
    mockSupabaseService.getServiceRoleClient.mockReturnValue(mockSupabaseClient);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('revokeVouch', () => {
    it('soft-revokes a vouch owned by the mentor', async () => {
      mockSupabaseClient.from
        .mockReturnValueOnce(chain({ data: vouchRow, error: null })) // ownership lookup
        .mockReturnValueOnce(chain({ data: { ...vouchRow, status: VouchStatus.REVOKED }, error: null }));

      const result = await service.revokeVouch(mentorWallet, vouchId);

      expect(result.status).toBe(VouchStatus.REVOKED);
      expect(result.id).toBe(vouchId);
    });

    it('throws NotFoundException when the vouch does not exist', async () => {
      mockSupabaseClient.from.mockReturnValueOnce(chain({ data: null, error: null }));

      await expect(service.revokeVouch(mentorWallet, vouchId)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when another mentor owns the vouch', async () => {
      mockSupabaseClient.from.mockReturnValueOnce(chain({ data: vouchRow, error: null }));

      await expect(service.revokeVouch(otherMentor, vouchId)).rejects.toThrow(ForbiddenException);
    });
  });
});
