import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.client';
import { UpdateLearnerProfileDto } from './dto/learner-profile.dto';
import { LearnerResponseDto } from './dto/learner-response.dto';

@Injectable()
export class LearnersService {
  private readonly logger = new Logger(LearnersService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async getProfile(wallet: string): Promise<LearnerResponseDto> {
    const client = this.supabaseService.getClient();

    const { data, error } = await client
      .from('learner_profiles')
      .select('*')
      .eq('wallet_address', wallet)
      .single();

    if (error || !data) {
      throw new NotFoundException({
        code: 'LEARNER_PROFILE_NOT_FOUND',
        message: 'Learner profile not found.',
      });
    }

    return this.mapToDto(data);
  }

  async getCompletionStatus(wallet: string): Promise<{ complete: boolean; missingFields: string[] }> {
    let profile;
    try {
      profile = await this.getProfile(wallet);
    } catch (err) {
      return { complete: false, missingFields: ['fullName', 'country', 'financeGoals'] };
    }

    const requiredFields = ['fullName', 'country', 'financeGoals'];
    const missingFields = requiredFields.filter(field => {
      const val = profile[field as keyof LearnerResponseDto];
      if (Array.isArray(val)) return val.length === 0;
      return !val;
    });

    return {
      complete: missingFields.length === 0,
      missingFields,
    };
  }

  async upsertProfile(
    wallet: string,
    dto: UpdateLearnerProfileDto,
  ): Promise<LearnerResponseDto> {
    const client = this.supabaseService.getServiceRoleClient();

    const { data: existing } = await client
      .from('learner_profiles')
      .select('*')
      .eq('wallet_address', wallet)
      .single();

    const fullName = dto.full_name !== undefined ? dto.full_name : existing?.full_name;
    const country = dto.country !== undefined ? dto.country : existing?.country;
    const financeGoals = dto.finance_goals !== undefined ? dto.finance_goals : existing?.finance_goals;
    
    const isComplete = !!(
      fullName &&
      country &&
      Array.isArray(financeGoals) && financeGoals.length > 0
    );

    const wasComplete = existing?.profile_complete === true;
    const isNewlyComplete = isComplete && !wasComplete;

    const onboardingCompletedAt = isNewlyComplete ? new Date().toISOString() : existing?.onboarding_completed_at;

    const updatePayload: any = {
      wallet_address: wallet,
      profile_complete: isComplete,
      onboarding_completed_at: onboardingCompletedAt,
      updated_at: new Date().toISOString(),
    };

    if (dto.full_name !== undefined) updatePayload.full_name = dto.full_name;
    if (dto.bio !== undefined) updatePayload.bio = dto.bio;
    if (dto.country !== undefined) updatePayload.country = dto.country;
    if (dto.city !== undefined) updatePayload.city = dto.city;
    if (dto.current_role !== undefined) updatePayload.current_role = dto.current_role;
    if (dto.institution !== undefined) updatePayload.institution = dto.institution;
    if (dto.program !== undefined) updatePayload.program = dto.program;
    if (dto.graduation_year !== undefined) updatePayload.graduation_year = dto.graduation_year;
    if (dto.skills !== undefined) updatePayload.skills = dto.skills;
    if (dto.finance_goals !== undefined) updatePayload.finance_goals = dto.finance_goals;
    if (dto.monthly_income_range !== undefined) updatePayload.monthly_income_range = dto.monthly_income_range;
    if (dto.github_url !== undefined) updatePayload.github_url = dto.github_url;
    if (dto.linkedin_url !== undefined) updatePayload.linkedin_url = dto.linkedin_url;

    const { data, error } = await client
      .from('learner_profiles')
      .upsert(updatePayload, { onConflict: 'wallet_address' })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Failed to upsert learner profile for ${wallet}: ${error?.message}`);
      throw new Error('Failed to update learner profile.');
    }

    this.logger.log(`Learner profile updated for ${wallet}`);
    return this.mapToDto(data);
  }

  private mapToDto(data: any): LearnerResponseDto {
    return {
      id: data.id,
      walletAddress: data.wallet_address,
      fullName: data.full_name,
      bio: data.bio,
      country: data.country,
      city: data.city,
      currentRole: data.current_role,
      institution: data.institution,
      program: data.program,
      graduationYear: data.graduation_year,
      skills: data.skills,
      financeGoals: data.finance_goals,
      monthlyIncomeRange: data.monthly_income_range,
      githubUrl: data.github_url,
      linkedinUrl: data.linkedin_url,
      profileComplete: data.profile_complete,
      onboardingCompletedAt: data.onboarding_completed_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}
