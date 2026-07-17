import { Module } from '@nestjs/common';
import { CreditScoringService } from './credit-scoring.service';

@Module({
  providers: [CreditScoringService],
  exports: [CreditScoringService],
})
export class CreditScoringModule {}
