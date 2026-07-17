import { Controller, Get, Logger, Header } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  CREDIT_LINE_CONTRACT_ID_KEY,
  REPUTATION_CONTRACT_ID_KEY,
  LIQUIDITY_POOL_CONTRACT_ID_KEY,
  VENDOR_REGISTRY_CONTRACT_ID_KEY,
} from '../../stellar/contracts/interfaces';

@ApiTags('stellar')
@Controller()
export class StellarTomlController {
  private readonly logger = new Logger(StellarTomlController.name);
  private cachedToml: string | null = null;
  private cacheExpiry = 0;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000;

  constructor(private readonly configService: ConfigService) {}

  @Get('.well-known/stellar.toml')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Access-Control-Allow-Origin', '*')
  @ApiOperation({ summary: 'Stellar ecosystem metadata file' })
  @ApiResponse({
    status: 200,
    description: 'Stellar.toml metadata returned',
    content: { 'text/plain': { schema: { type: 'string' } } },
  })
  getStellarToml(): string {
    const now = Date.now();
    if (this.cachedToml && now < this.cacheExpiry) {
      return this.cachedToml;
    }

    const orgName =
      this.configService.get<string>('ORG_NAME') || 'StepFi';
    const website =
      this.configService.get<string>('ORG_URL') || 'https://stepfi.com';
    const github =
      this.configService.get<string>('ORG_GITHUB') || 'https://github.com/StepFi';

    const creditLineId =
      this.configService.get<string>(CREDIT_LINE_CONTRACT_ID_KEY) || '';
    const liquidityPoolId =
      this.configService.get<string>(LIQUIDITY_POOL_CONTRACT_ID_KEY) || '';
    const reputationId =
      this.configService.get<string>(REPUTATION_CONTRACT_ID_KEY) || '';
    const vendorRegistryId =
      this.configService.get<string>(VENDOR_REGISTRY_CONTRACT_ID_KEY) || '';

    const toml = [
      '# StepFi',
      'ORG_NAME="' + orgName + '"',
      'ORG_URL="' + website + '"',
      'ORG_GITHUB="' + github + '"',
      '',
      '[[CONTRACTS]]',
      'id = "' + creditLineId + '"',
      'name = "Credit Line"',
      '',
      '[[CONTRACTS]]',
      'id = "' + liquidityPoolId + '"',
      'name = "Liquidity Pool"',
      '',
      '[[CONTRACTS]]',
      'id = "' + reputationId + '"',
      'name = "Reputation"',
      '',
      '[[CONTRACTS]]',
      'id = "' + vendorRegistryId + '"',
      'name = "Vendor Registry"',
      '',
    ].join('\n');

    this.cachedToml = toml;
    this.cacheExpiry = now + this.CACHE_TTL_MS;
    this.logger.log('Stellar.toml cache refreshed');

    return toml;
  }
}
