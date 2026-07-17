import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from '../../../src/modules/auth/auth.module';
import { LearnersModule } from '../../../src/modules/learners/learners.module';
import { LoansModule } from '../../../src/modules/loans/loans.module';
import { VendorsModule } from '../../../src/modules/vendors/vendors.module';
import { ReputationModule } from '../../../src/modules/reputation/reputation.module';
import { UsersModule } from '../../../src/modules/users/users.module';
import { CreditScoringModule } from '../../../src/modules/credit-scoring/credit-scoring.module';
import { SupabaseService } from '../../../src/database/supabase.client';
import { SorobanService } from '../../../src/blockchain/soroban/soroban.service';
import { CreditLineContractClient } from '../../../src/stellar/contracts/clients/creditline.client';
import { ReputationContractClient } from '../../../src/stellar/contracts/clients/reputation.client';
import { LiquidityPoolContractClient } from '../../../src/stellar/contracts/clients/liquidity-pool.client';
import { VendorRegistryContractClient } from '../../../src/stellar/contracts/clients/vendor-registry.client';
import { ParametersContractClient } from '../../../src/stellar/contracts/clients/parameters.client';
import { randomUUID } from 'crypto';
import { createTestKeypair } from './test-wallet';

type Row = Record<string, any>;

export class InMemoryStore {
  private tables = new Map<string, Row[]>();

  getRows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  seed(table: string, rows: Row | Row[]): void {
    const arr = Array.isArray(rows) ? rows : [rows];
    this.getRows(table).push(...arr);
  }

  clear(): void {
    this.tables.clear();
  }

  dump(table: string): Row[] {
    return [...this.getRows(table)];
  }
}

class MockQueryBuilder {
  private filters: Array<
    | { type: 'eq'; col: string; val: any }
    | { type: 'is'; col: string; val: any }
    | { type: 'in'; col: string; vals: any[] }
  > = [];
  private sortCol: string | null = null;
  private sortAsc = true;
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private limitCount: number | null = null;
  private countExact = false;
  private operation:
    | { kind: 'select' }
    | { kind: 'insert'; data: any }
    | { kind: 'update'; data: any }
    | { kind: 'upsert'; data: any; onConflict?: string }
    | { kind: 'delete' }
    | null = null;

  constructor(
    private store: InMemoryStore,
    private table: string,
  ) {
    this.operation = { kind: 'select' };
  }

  select(_columns?: string, opts?: { count?: 'exact' | 'planned' | 'estimated' }): this {
    if (!this.operation) {
      this.operation = { kind: 'select' };
    }
    this.countExact = opts?.count === 'exact';
    return this;
  }

  insert(data: any): this {
    this.operation = { kind: 'insert', data };
    return this;
  }

  update(data: any): this {
    this.operation = { kind: 'update', data };
    return this;
  }

  upsert(data: any, opts?: { onConflict?: string }): this {
    this.operation = { kind: 'upsert', data, onConflict: opts?.onConflict };
    return this;
  }

  delete(): this {
    this.operation = { kind: 'delete' };
    return this;
  }

  eq(col: string, val: any): this {
    this.filters.push({ type: 'eq', col, val } as any);
    return this;
  }

  is(col: string, val: any): this {
    this.filters.push({ type: 'is', col, val } as any);
    return this;
  }

  in(col: string, vals: any[]): this {
    this.filters.push({ type: 'in', col, vals } as any);
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.sortCol = col;
    this.sortAsc = opts?.ascending ?? true;
    return this;
  }

  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  limit(n: number): this {
    this.limitCount = n;
    return this;
  }

  single(): Promise<{ data: Row | null; error: { message: string } | null; count?: number }> {
    if (this.operation && this.operation.kind !== 'select') {
      return this.executeQuery().then((r) => ({
        data: r.data ?? null,
        error: r.error ?? null,
        count: r.count,
      }));
    }
    const results = this.apply();
    if (results.length === 0) {
      return Promise.resolve({ data: null, error: { message: 'No rows found' } });
    }
    if (results.length > 1) {
      return Promise.resolve({ data: null, error: { message: 'Query returned multiple rows when single was expected' } });
    }
    return Promise.resolve({ data: results[0], error: null, count: this.countExact ? 1 : undefined });
  }

  maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null; count?: number }> {
    if (this.operation && this.operation.kind !== 'select') {
      return this.executeQuery().then((r) => ({
        data: r.data ?? null,
        error: r.error ?? null,
        count: r.count,
      }));
    }
    const results = this.apply();
    return Promise.resolve({ data: results[0] ?? null, error: null, count: this.countExact ? results.length : undefined });
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.executeQuery().then(onfulfilled, onrejected);
  }

  private apply(): Row[] {
    let rows = this.store.getRows(this.table);

    for (const f of this.filters) {
      if (f.type === 'eq') {
        rows = rows.filter((r) => r[f.col] === f.val || (r[f.col] == null && f.val == null));
      } else if (f.type === 'is') {
        rows = rows.filter((r) => r[f.col] === f.val || (f.val === null && r[f.col] == null));
      } else if (f.type === 'in') {
        rows = rows.filter((r) => f.vals.includes(r[f.col]));
      }
    }

    if (this.sortCol) {
      rows = [...rows].sort((a, b) => {
        const av = a[this.sortCol] ?? '';
        const bv = b[this.sortCol] ?? '';
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return this.sortAsc ? cmp : -cmp;
      });
    }

    if (this.rangeFrom != null) {
      rows = rows.slice(this.rangeFrom, (this.rangeTo ?? rows.length) + 1);
    }
    if (this.limitCount != null) {
      rows = rows.slice(0, this.limitCount);
    }

    return rows;
  }

  private executeQuery(): Promise<any> {
    const op = this.operation;
    if (!op) {
      return Promise.resolve({ data: null, error: null });
    }

    if (op.kind === 'select') {
      const results = this.apply();
      return Promise.resolve({
        data: results,
        error: null,
        count: this.countExact ? results.length : undefined,
      });
    }

    if (op.kind === 'insert') {
      const rows = this.store.getRows(this.table);
      const entry = { ...op.data, id: op.data.id ?? randomUUID() };
      rows.push(entry);
      return Promise.resolve({ data: entry, error: null });
    }

    if (op.kind === 'upsert') {
      const rows = this.store.getRows(this.table);
      const conflictCol = op.onConflict ?? 'id';
      const existingIdx = rows.findIndex((r) => r[conflictCol] === op.data[conflictCol]);
      const entry = { ...op.data, id: op.data.id ?? randomUUID() };

      if (existingIdx >= 0) {
        rows[existingIdx] = { ...rows[existingIdx], ...op.data };
      } else {
        rows.push(entry);
      }

      const result = existingIdx >= 0 ? rows[existingIdx] : entry;
      return Promise.resolve({ data: result, error: null });
    }

    if (op.kind === 'update') {
      const targets = this.apply();
      const store = this.store.getRows(this.table);
      for (const target of targets) {
        const idx = store.indexOf(target);
        if (idx >= 0) {
          store[idx] = { ...store[idx], ...op.data };
        }
      }
      return Promise.resolve({
        data: targets.map((t) => ({ ...t, ...op.data })),
        error: null,
      });
    }

    if (op.kind === 'delete') {
      const targets = this.apply();
      const store = this.store.getRows(this.table);
      for (const target of targets) {
        const idx = store.indexOf(target);
        if (idx >= 0) store.splice(idx, 1);
      }
      return Promise.resolve({ data: targets, error: null });
    }

    return Promise.resolve({ data: null, error: null });
  }
}

export async function buildTestApp(): Promise<{
  app: INestApplication;
  mockDb: InMemoryStore;
}> {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-e2e-min32chars';
  process.env.JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET || 'test-jwt-refresh-secret-for-e2e';
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
  process.env.CREDIT_LINE_CONTRACT_ID = 'C_CREDIT_LINE_E2E';
  process.env.REPUTATION_CONTRACT_ID = 'C_REPUTATION_E2E';
  process.env.LIQUIDITY_POOL_CONTRACT_ID = 'C_LIQUIDITY_POOL_E2E';
  process.env.VENDOR_REGISTRY_CONTRACT_ID = 'C_VENDOR_REGISTRY_E2E';
  process.env.PARAMETERS_CONTRACT_ID = 'C_PARAMETERS_E2E';
  process.env.STELLAR_SOROBAN_URL = 'https://testnet.stellar.org';
  process.env.REDIS_URL = '';

  const store = new InMemoryStore();

  const builder = (table: string) => new MockQueryBuilder(store, table);

  const makeClient = () => ({
    from: jest.fn((table: string) => builder(table)),
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn().mockResolvedValue({ error: null }),
        getPublicUrl: jest.fn(() => ({ data: { publicUrl: 'https://example.com/avatar.png' } })),
      })),
    },
  });

  const mockSupabaseService = {
    getClient: jest.fn(makeClient),
    getServiceRoleClient: jest.fn(makeClient),
  };

  const mockSorobanService = {
    getServer: jest.fn().mockReturnValue({
      getAccount: jest.fn().mockResolvedValue({}),
      prepareTransaction: jest.fn().mockResolvedValue({ toXDR: () => 'AAAAAgAAAQAAAAAAAAAAiZ3TgwAAAAAyMZyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==' }),
      simulateTransaction: jest.fn().mockResolvedValue({ result: { retval: {} } }),
    }),
    getNetworkPassphrase: jest.fn().mockReturnValue('Test SDF Network ; September 2015'),
    simulateContractCall: jest.fn().mockResolvedValue({}),
  };

  const mockContractClient = {
    buildCreateLoanTransaction: jest
      .fn()
      .mockResolvedValue('AAAAAgAAAQAAAAAAAAAAiZ3TgwAAAAAyMZyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='),
    buildRepayLoanTx: jest
      .fn()
      .mockResolvedValue('AAAAAgAAAQAAAAAAAAAAiZ3TgwAAAAAyMZyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='),
    getScore: jest.fn().mockResolvedValue(75),
    getPoolStats: jest.fn().mockResolvedValue(null),
    getVendor: jest.fn().mockResolvedValue(null),
    getParameters: jest.fn().mockResolvedValue(null),
  };

  const mockCacheManager = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }]),
      AuthModule,
      LearnersModule,
      LoansModule,
      VendorsModule,
      ReputationModule,
      UsersModule,
      CreditScoringModule,
    ],
  })
    .overrideProvider(SupabaseService)
    .useValue(mockSupabaseService)
    .overrideProvider(SorobanService)
    .useValue(mockSorobanService)
    .overrideProvider(CreditLineContractClient)
    .useValue(mockContractClient)
    .overrideProvider(ReputationContractClient)
    .useValue(mockContractClient)
    .overrideProvider(LiquidityPoolContractClient)
    .useValue(mockContractClient)
    .overrideProvider(VendorRegistryContractClient)
    .useValue(mockContractClient)
    .overrideProvider(ParametersContractClient)
    .useValue(mockContractClient)
    .overrideProvider('CACHE_MANAGER')
    .useValue(mockCacheManager)
    .compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  return { app, mockDb: store };
}

export async function seedVendor(
  mockDb: InMemoryStore,
  overrides?: Partial<{
    id: string;
    name: string;
    type: string;
    verified: boolean;
  }>,
): Promise<Row> {
  const vendor = {
    id: overrides?.id ?? randomUUID(),
    wallet_address: createTestKeypair().publicKey(),
    name: overrides?.name ?? 'Test Vendor',
    type: overrides?.type ?? 'electronics',
    verified: overrides?.verified ?? true,
    website: 'https://testvendor.com',
    country: 'Nigeria',
    city: 'Lagos',
    created_at: new Date().toISOString(),
  };
  mockDb.seed('vendors', vendor);
  return vendor;
}

export async function closeTestApp(app: INestApplication): Promise<void> {
  await app.close();
}
