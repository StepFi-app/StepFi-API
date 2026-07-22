import { Injectable } from '@nestjs/common';
import * as StellarSdk from 'stellar-sdk';
import {
  HorizonClientService,
  EndpointStatus,
  HorizonRoot,
} from './horizon-client.service';

@Injectable()
export class StellarService {
  constructor(
    private readonly horizonClientService: HorizonClientService,
  ) {}

  getNetworkPassphrase(): string {
    return this.horizonClientService.getNetworkPassphrase();
  }

  getEndpointStatuses(): EndpointStatus[] {
    return this.horizonClientService.getEndpointStatuses();
  }

  async getHorizonRoot(): Promise<HorizonRoot> {
    return this.horizonClientService.getRoot();
  }

  async submitTransaction(
    transaction: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction,
  ): Promise<Record<string, unknown>> {
    return this.horizonClientService.submitTransaction(transaction);
  }

  async getTransaction(hash: string): Promise<Record<string, unknown>> {
    return this.horizonClientService.getTransaction(hash);
  }
}
