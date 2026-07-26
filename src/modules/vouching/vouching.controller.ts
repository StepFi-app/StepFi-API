import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { VouchingService } from './vouching.service';
import {
  ApproveVouchDto,
  DeclineVouchDto,
  RequestVouchDto,
  VouchResponseDto,
  VouchRequestItemDto,
} from './dto/vouch.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../auth/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('vouching')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vouching')
export class VouchingController {
  constructor(private readonly vouchingService: VouchingService) {}

  @Post('request')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Learner requests a vouch from a mentor' })
  @ApiResponse({ status: 201, description: 'Vouch request created', type: VouchResponseDto })
  @ApiResponse({ status: 409, description: 'Active vouch already exists for this pair' })
  async requestVouch(
    @CurrentUser() user: { wallet: string },
    @Body() dto: RequestVouchDto,
  ): Promise<VouchResponseDto> {
    return this.vouchingService.requestVouch(user.wallet, dto);
  }

  @Post('approve')
  @UseGuards(RolesGuard)
  @Roles('mentor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mentor approves a pending vouch request' })
  @ApiResponse({ status: 200, description: 'Vouch approved', type: VouchResponseDto })
  @ApiResponse({ status: 404, description: 'No pending vouch found' })
  async approveVouch(
    @CurrentUser() user: { wallet: string },
    @Body() dto: ApproveVouchDto,
  ): Promise<VouchResponseDto> {
    return this.vouchingService.approveVouch(user.wallet, dto);
  }

  @Post('decline')
  @UseGuards(RolesGuard)
  @Roles('mentor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mentor declines a pending vouch request' })
  @ApiResponse({ status: 200, description: 'Vouch declined', type: VouchResponseDto })
  @ApiResponse({ status: 404, description: 'No pending vouch found' })
  async declineVouch(
    @CurrentUser() user: { wallet: string },
    @Body() dto: DeclineVouchDto,
  ): Promise<VouchResponseDto> {
    return this.vouchingService.declineVouch(user.wallet, dto);
  }

  @Get('mine')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Get the current learner's vouches" })
  @ApiResponse({ status: 200, description: 'List of vouches received', type: [VouchResponseDto] })
  async getMine(
    @CurrentUser() user: { wallet: string },
  ): Promise<VouchResponseDto[]> {
    return this.vouchingService.getMyVouches(user.wallet);
  }

  @Get('mentor')
  @UseGuards(RolesGuard)
  @Roles('mentor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get vouches the current mentor has given' })
  @ApiResponse({ status: 200, description: 'List of vouches given', type: [VouchResponseDto] })
  async getMentor(
    @CurrentUser() user: { wallet: string },
  ): Promise<VouchResponseDto[]> {
    return this.vouchingService.getMentorVouches(user.wallet);
  }

  @Get('requests')
  @UseGuards(RolesGuard)
  @Roles('mentor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get incoming vouch requests for the authenticated mentor' })
  @ApiResponse({ status: 200, description: 'List of pending vouch requests', type: [VouchRequestItemDto] })
  async getRequests(
    @CurrentUser() user: { wallet: string },
  ): Promise<VouchRequestItemDto[]> {
    return this.vouchingService.getIncomingRequests(user.wallet);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('mentor')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mentor revokes a vouch they created' })
  @ApiParam({ name: 'id', description: 'Vouch UUID' })
  @ApiResponse({ status: 200, description: 'Vouch revoked', type: VouchResponseDto })
  @ApiResponse({ status: 403, description: 'Not the mentor who created this vouch' })
  @ApiResponse({ status: 404, description: 'Vouch not found' })
  async revokeVouch(
    @CurrentUser() user: { wallet: string },
    @Param('id', ParseUUIDPipe) vouchId: string,
  ): Promise<VouchResponseDto> {
    return this.vouchingService.revokeVouch(user.wallet, vouchId);
  }
}
