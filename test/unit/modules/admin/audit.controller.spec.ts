import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from '../../../../src/modules/admin/audit.controller';
import { AuditService } from '../../../../src/modules/admin/audit.service';
import { AuditLogQueryDto } from '../../../../src/modules/admin/dto/audit-log-query.dto';

describe('AuditController', () => {
  let controller: AuditController;
  let auditService: jest.Mocked<AuditService>;

  const mockAuditService = {
    findMany: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    controller = module.get<AuditController>(AuditController);
    auditService = module.get<AuditService>(AuditService) as jest.Mocked<AuditService>;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate getAuditLogs to auditService.findMany', async () => {
    const query: AuditLogQueryDto = { limit: 10, offset: 0 };
    const expectedResponse = {
      success: true,
      data: [],
      pagination: { limit: 10, offset: 0, total: 0 },
      message: 'Audit logs retrieved successfully',
    };

    mockAuditService.findMany.mockResolvedValue(expectedResponse);

    const result = await controller.getAuditLogs(query);

    expect(mockAuditService.findMany).toHaveBeenCalledWith(query);
    expect(result).toEqual(expectedResponse);
  });
});
