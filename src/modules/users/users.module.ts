import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from '../../database/repositories/users.repository';
import { SupabaseService } from '../../database/supabase.client';
import { AuthModule } from '../auth/auth.module';

/**
 * Users feature module.
 */
@Module({
    imports: [AuthModule],
    controllers: [UsersController],
    providers: [UsersService, UsersRepository, SupabaseService],
    exports: [UsersService, UsersRepository],
})
export class UsersModule { }