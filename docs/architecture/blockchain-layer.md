# Blockchain Layer

## Purpose

The `src/blockchain/` folder contains **clients and utilities** to interact with Stellar and Soroban. **Does NOT contain smart contracts** (those are on-chain).

## Structure

### `stellar/`
**Stellar Client** - Interaction with Stellar network:
- Account management
- Fee estimation
- Transaction queries
- Balance reading
- Basic Stellar operations

**Typical files:**
- `stellar.client.ts`: Main client
- `account.service.ts`: Account operations
- `fee.service.ts`: Fee estimation

### `soroban/`
**Soroban Client** - Interaction with Soroban (smart contracts):
- Transaction simulation
- Invocation building
- Contract state reading
- Soroban transaction sending

**Typical files:**
- `soroban.client.ts`: Main client
- `simulation.service.ts`: Transaction simulation
- `invocation.builder.ts`: Invocation building

### `contracts/`
**Contract Clients** - Wrappers/abstractions to interact with specific contracts:

These are **TypeScript clients** that encapsulate the logic to interact with each on-chain smart contract.

**Clients to create:**
- `reputation-contract.client.ts`: Client for ReputationContract
- `credit-line-contract.client.ts`: Client for CreditLineContract
- `merchant-registry-contract.client.ts`: Client for MerchantRegistryContract
- `liquidity-contract.client.ts`: Client for LiquidityContract

**Example structure:**
```typescript
// contracts/reputation-contract.client.ts
export class ReputationContractClient {
  async getScore(wallet: string): Promise<number> {
    // Logic to read score from contract
  }
  
  async buildUpdateScoreTx(wallet: string, score: number): Promise<string> {
    // Builds unsigned XDR to update score
  }
}
```

## Principles

- **IO only**: This layer only does I/O with blockchain, no business logic
- **Unsigned XDR**: Clients build unsigned XDR transactions
- **App signs**: Mobile app signs transactions
- **API sends**: API sends signed transactions

## Typical Flow

1. Service calls `ContractClient.buildTx()`
2. Client builds unsigned XDR using Soroban SDK
3. API returns XDR to mobile
4. Mobile signs the transaction
5. Mobile sends signed XDR back
6. API sends transaction to network using `soroban.client.ts`

## Server-signed submissions

Server-initiated transactions (default detection, admin ops, future
loan-funding paths) use `SequenceManagerService` in
`src/blockchain/sequence-manager/`. Submissions go through a managed
source account whose sequence number is:

- Refreshed from Horizon on first use and on every `tx_bad_seq`
  rejection, so a stale local counter can never wedge the protocol.
- Serialized per-account through an in-memory promise chain so two
  concurrent callers cannot double-spend the same sequence.
- Optionally fan out across a `STELLAR_CHANNEL_ACCOUNTS` pool for true
  parallel in-flight transactions; each channel has its own counter.

`BlockchainService.submitServerTransaction(spec)` is the public
entrypoint. `spec.build` receives an `Account` already pre-populated
with the source-account id and the next sequence number; the manager
signs and submits, exposing Prometheus counters
(`blockchain_source_submissions_in_flight`,
`blockchain_source_bad_seq_retries_total`,
`blockchain_source_submissions_total`,
`blockchain_source_next_sequence`).
