import {
  Controller,
  Get,
  Post,
<<<<<<< Updated upstream
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  UseGuards,
  HttpCode,
  HttpStatus,
=======
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
>>>>>>> Stashed changes
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
<<<<<<< Updated upstream
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VendorsService } from './vendors.service';
import { VendorResponseDto, VendorType } from './dto/vendor.dto';
import { RegisterVendorDto } from './dto/register-vendor.dto';
import { VendorDashboardDto } from './dto/vendor-dashboard.dto';
import { VendorLoansPageDto } from './dto/vendor-loan.dto';
import { VendorPaymentsPageDto } from './dto/vendor-payment.dto';
import {
  CreateVendorProductDto,
  UpdateVendorProductDto,
  VendorProductDto,
} from './dto/vendor-product.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ApiKeyResponseDto, ApiKeyCreatedResponseDto } from './dto/api-key-response.dto';

/** Standard response envelope: { success, data, message }. */
interface Envelope<T> {
  success: boolean;
  data: T;
  message: string;
}
=======
import { VendorsService } from './vendors.service';
import { VendorResponseDto, VendorType, VendorActionResponseDto } from './dto/vendor.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AuditAction } from '../../common/decorators/audit-action.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
>>>>>>> Stashed changes

@ApiTags('vendors')
@Controller('vendors')
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all vendors, optionally filtered by type' })
  @ApiQuery({ name: 'type', enum: VendorType, required: false })
  @ApiResponse({ status: 200, description: 'List of vendors', type: [VendorResponseDto] })
  async list(@Query('type') type?: VendorType): Promise<VendorResponseDto[]> {
    return this.vendorsService.getAll(type);
  }

  // --- Authenticated vendor self-service routes ---
  // Declared before ':id' so their static paths are not captured by the wildcard.

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register the authenticated wallet as a vendor (one per wallet)' })
  @ApiResponse({ status: 201, description: 'Vendor registered', type: VendorResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Requires the vendor role' })
  @ApiResponse({ status: 409, description: 'Wallet already registered as a vendor' })
  async register(
    @CurrentUser() user: { wallet: string },
    @Body() dto: RegisterVendorDto,
  ): Promise<Envelope<VendorResponseDto>> {
    const data = await this.vendorsService.registerVendor(user.wallet, dto);
    return { success: true, data, message: 'Vendor registered successfully' };
  }

  @Get('dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get the authenticated vendor's dashboard summary" })
  @ApiResponse({ status: 200, description: 'Vendor dashboard summary', type: VendorDashboardDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  async getDashboard(
    @CurrentUser() user: { wallet: string },
  ): Promise<Envelope<VendorDashboardDto>> {
    const data = await this.vendorsService.getDashboard(user.wallet);
    return { success: true, data, message: 'Vendor dashboard retrieved successfully' };
  }

  @Get('loans')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Paginated list of loans tied to the authenticated vendor' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'sort', required: false, enum: ['created_at', 'amount', 'status'] })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiResponse({ status: 200, description: 'Vendor loans page', type: VendorLoansPageDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  async getLoans(
    @CurrentUser() user: { wallet: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
  ): Promise<Envelope<VendorLoansPageDto>> {
    const data = await this.vendorsService.getLoans(user.wallet, page, limit, sort, order);
    return { success: true, data, message: 'Vendor loans retrieved successfully' };
  }

  @Get('payments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Paginated payment history received by the authenticated vendor' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({ status: 200, description: 'Vendor payments page', type: VendorPaymentsPageDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  async getPayments(
    @CurrentUser() user: { wallet: string },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ): Promise<Envelope<VendorPaymentsPageDto>> {
    const data = await this.vendorsService.getPayments(user.wallet, page, limit);
    return { success: true, data, message: 'Vendor payments retrieved successfully' };
  }

  @Get('products')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the authenticated vendor's products" })
  @ApiResponse({ status: 200, description: 'Vendor products', type: [VendorProductDto] })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  async getProducts(
    @CurrentUser() user: { wallet: string },
  ): Promise<Envelope<VendorProductDto[]>> {
    const data = await this.vendorsService.getProducts(user.wallet);
    return { success: true, data, message: 'Vendor products retrieved successfully' };
  }

  @Post('products')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a product for the authenticated vendor' })
  @ApiResponse({ status: 201, description: 'Product created', type: VendorProductDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  async createProduct(
    @CurrentUser() user: { wallet: string },
    @Body() dto: CreateVendorProductDto,
  ): Promise<Envelope<VendorProductDto>> {
    const data = await this.vendorsService.createProduct(user.wallet, dto);
    return { success: true, data, message: 'Product created successfully' };
  }

  @Patch('products/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update one of the authenticated vendor's products" })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product updated', type: VendorProductDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Product does not belong to this vendor' })
  @ApiResponse({ status: 404, description: 'Vendor or product not found' })
  async updateProduct(
    @CurrentUser() user: { wallet: string },
    @Param('id', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateVendorProductDto,
  ): Promise<Envelope<VendorProductDto>> {
    const data = await this.vendorsService.updateProduct(user.wallet, productId, dto);
    return { success: true, data, message: 'Product updated successfully' };
  }

  @Delete('products/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete one of the authenticated vendor's products" })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 204, description: 'Product deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Product does not belong to this vendor' })
  @ApiResponse({ status: 404, description: 'Vendor or product not found' })
  async deleteProduct(
    @CurrentUser() user: { wallet: string },
    @Param('id', ParseUUIDPipe) productId: string,
  ): Promise<void> {
    return this.vendorsService.deleteProduct(user.wallet, productId);
  }

  // --- API key management (static path, declared before ':id') ---

  @Post('api-keys')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
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

  // --- Public single-vendor lookup (wildcard, declared LAST) ---

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get a single vendor by id' })
  @ApiParam({ name: 'id', description: 'Vendor UUID' })
  @ApiResponse({ status: 200, description: 'Vendor', type: VendorResponseDto })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  async getById(@Param('id') id: string): Promise<VendorResponseDto> {
    return this.vendorsService.getById(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @AuditAction('vendor.approve')
  @ApiOperation({
    summary: 'Approve a vendor',
    description:
      'Constructs an unsigned Soroban approve_vendor() XDR transaction for an allowlisted admin wallet to sign and submit. Vendor must currently be in pending status.',
  })
  @ApiParam({ name: 'id', description: 'Vendor UUID' })
  @ApiResponse({
    status: 200,
    description: 'Unsigned transaction XDR generated successfully',
    type: VendorActionResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Forbidden - wallet is not an allowlisted admin' })
  @ApiResponse({ status: 409, description: 'Conflict - vendor is not in pending status' })
  async approveVendor(
    @CurrentUser() user: { wallet: string },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: boolean; data: VendorActionResponseDto; message: string }> {
    const data = await this.vendorsService.approveVendor(user.wallet, id);
    return {
      success: true,
      data,
      message: 'Vendor approval transaction constructed successfully',
    };
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @AuditAction('vendor.suspend')
  @ApiOperation({
    summary: 'Suspend a vendor',
    description:
      'Constructs an unsigned Soroban suspend_vendor() XDR transaction for an allowlisted admin wallet to sign and submit. Vendor must currently be in approved status.',
  })
  @ApiParam({ name: 'id', description: 'Vendor UUID' })
  @ApiResponse({
    status: 200,
    description: 'Unsigned transaction XDR generated successfully',
    type: VendorActionResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Forbidden - wallet is not an allowlisted admin' })
  @ApiResponse({ status: 409, description: 'Conflict - vendor is not in approved status' })
  async suspendVendor(
    @CurrentUser() user: { wallet: string },
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: boolean; data: VendorActionResponseDto; message: string }> {
    const data = await this.vendorsService.suspendVendor(user.wallet, id);
    return {
      success: true,
      data,
      message: 'Vendor suspension transaction constructed successfully',
    };
  }
}

