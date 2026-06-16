import {
    Controller,
    Get,
    Param,
    Request,
    UseGuards,
    BadRequestException,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiBearerAuth,
    ApiParam,
} from '@nestjs/swagger';
import { ReputationService } from './reputation.service';
import { ReputationResponseDto } from './dto/reputation-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('reputation')
@Controller('reputation')
export class ReputationController {
    constructor(private readonly reputationService: ReputationService) { }

    @Get(':wallet')
    @ApiOperation({ summary: 'Get reputation score for a specific wallet address' })
    @ApiParam({
        name: 'wallet',
        description: 'Stellar wallet address starting with G (56 characters)',
        example: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
    })
    @ApiResponse({
        status: 200,
        description: 'Reputation data retrieved successfully',
        type: ReputationResponseDto,
    })
    @ApiResponse({ status: 400, description: 'Invalid Stellar wallet address format' })
    async getScore(@Param('wallet') wallet: string) {
        const stellarWalletRegex = /^G[A-Z2-7]{55}$/;
        if (!stellarWalletRegex.test(wallet)) {
            throw new BadRequestException({
                success: false,
                message: 'Invalid Stellar wallet address format',
            });
        }

        const data = await this.reputationService.getReputationScore(wallet);

        return {
            success: true,
            data,
            message: 'Reputation data retrieved successfully',
        };
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get reputation score for the authenticated user' })
    @ApiResponse({
        status: 200,
        description: 'Reputation data retrieved successfully',
        type: ReputationResponseDto,
    })
    @ApiResponse({ status: 401, description: 'Unauthorized — missing or invalid JWT' })
    async getMyScore(@Request() req: any) {
        const wallet = req.user?.wallet;
        const data = await this.reputationService.getReputationScore(wallet);

        return {
            success: true,
            data,
            message: 'Your reputation data retrieved successfully',
        };
    }
}
