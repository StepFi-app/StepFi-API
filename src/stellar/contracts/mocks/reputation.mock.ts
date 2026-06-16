import { Injectable } from '@nestjs/common';

@Injectable()
export class MockReputationContractClient {
  getScore = jest.fn(
    async (_wallet: string): Promise<number | null> => 75,
  );
}
