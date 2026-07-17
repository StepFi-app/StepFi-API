import { Controller, Get, Patch, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { LearnersService } from './learners.service';
import { UpdateLearnerProfileDto } from './dto/learner-profile.dto';
import { LearnerResponseDto } from './dto/learner-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('learners')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('learners')
export class LearnersController {
  constructor(private readonly learnersService: LearnersService) {}

  @Get('profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get learner profile' })
  @ApiResponse({ status: 200, description: 'Learner profile', type: LearnerResponseDto })
  @ApiResponse({ status: 404, description: 'Profile not found' })
  async getProfile(@CurrentUser() user: { wallet: string }): Promise<LearnerResponseDto> {
    return this.learnersService.getProfile(user.wallet);
  }

  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update learner profile' })
  @ApiBody({ type: UpdateLearnerProfileDto })
  @ApiResponse({ status: 200, description: 'Profile updated', type: LearnerResponseDto })
  async updateProfile(
    @CurrentUser() user: { wallet: string },
    @Body() dto: UpdateLearnerProfileDto,
  ): Promise<LearnerResponseDto> {
    return this.learnersService.upsertProfile(user.wallet, dto);
  }

  @Get('profile/completion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get learner profile completion status' })
  @ApiResponse({ status: 200, description: 'Completion status and missing fields' })
  async getCompletionStatus(@CurrentUser() user: { wallet: string }): Promise<{ complete: boolean; missingFields: string[] }> {
    return this.learnersService.getCompletionStatus(user.wallet);
  }
}
