import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VendorsService } from './vendors.service';
import { VendorResponseDto, VendorType } from './dto/vendor.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ApiKeyResponseDto, ApiKeyCreatedResponseDto } from './dto/api-key-response.dto';
import { VendorListQueryDto } from './dto/vendor-list-query.dto';
import { VendorListResponseDto } from './dto/vendor-list-response.dto';

@ApiTags('vendors')
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all vendors, optionally filtered by type with pagination' })
  @ApiQuery({ name: 'type', enum: VendorType, required: false })
  @ApiQuery({ name: 'page', type: Number, required: false, description: 'Page number (default 1)' })
  @ApiQuery({ name: 'limit', type: Number, required: false, description: 'Page size (default 20, max 100)' })
  @ApiResponse({ status: 200, description: 'List of vendors with pagination', type: VendorListResponseDto })
  async list(@Query() query: VendorListQueryDto): Promise<VendorListResponseDto> {
    return this.vendorsService.getAll(query.page, query.limit, query.type);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single vendor by id' })
  @ApiParam({ name: 'id', description: 'Vendor UUID' })
  @ApiResponse({ status: 200, description: 'Vendor', type: VendorResponseDto })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  async getById(@Param('id') id: string): Promise<VendorResponseDto> {
    return this.vendorsService.getById(id);
  }

  @Post('api-keys')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new API key for the authenticated vendor' })
  @ApiResponse({ status: 201, description: 'API key created', type: ApiKeyCreatedResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  async createApiKey(
    @CurrentUser() user: { wallet: string },
    @Body() dto: CreateApiKeyDto,
  ): Promise<ApiKeyCreatedResponseDto> {
    return this.vendorsService.createApiKey(user.wallet, dto);
  }

  @Get('api-keys')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all API keys for the authenticated vendor' })
  @ApiResponse({ status: 200, description: 'List of API keys', type: [ApiKeyResponseDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  async listApiKeys(
    @CurrentUser() user: { wallet: string },
  ): Promise<ApiKeyResponseDto[]> {
    return this.vendorsService.listApiKeys(user.wallet);
  }

  @Delete('api-keys/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiParam({ name: 'id', description: 'API key UUID' })
  @ApiResponse({ status: 204, description: 'API key revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'API key not found' })
  async revokeApiKey(
    @CurrentUser() user: { wallet: string },
    @Param('id', ParseUUIDPipe) keyId: string,
  ): Promise<void> {
    return this.vendorsService.revokeApiKey(user.wallet, keyId);
  }
}
