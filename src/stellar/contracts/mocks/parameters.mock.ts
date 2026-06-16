import { Injectable } from '@nestjs/common';
import type { ProtocolParameters } from '../interfaces/parameters.interface';

@Injectable()
export class MockParametersContractClient {
  getInterestRateBps = jest.fn(
    async (): Promise<number> => 800,
  );

  getGracePeriod = jest.fn(
    async (): Promise<number> => 7,
  );

  getMinReputation = jest.fn(
    async (): Promise<number> => 60,
  );

  getAllParameters = jest.fn(
    async (): Promise<ProtocolParameters> => ({
      interestRateBps: 800,
      gracePeriod: 7,
      minReputation: 60,
    }),
  );
}
