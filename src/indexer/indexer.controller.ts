import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IndexerStatusService } from './indexer-status.service';

@ApiTags('indexer')
@Controller('indexer')
export class IndexerController {
  constructor(private readonly indexerStatusService: IndexerStatusService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get indexer status and latest processed ledger' })
  @ApiResponse({ status: 200, description: 'Indexer status retrieved successfully' })
  async getStatus() {
    return this.indexerStatusService.getStatus();
  }
}
