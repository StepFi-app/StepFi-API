module.exports = {
  nativeToScVal: jest.fn((val) => val),
  scValToNative: jest.fn((val) => val),
  Address: {
    fromString: jest.fn((addr) => addr),
    toString: jest.fn(() => ''),
  },
  Keypair: {
    fromSecret: jest.fn(() => ({
      publicKey: jest.fn(() => 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW'),
    })),
    fromPublicKey: jest.fn(() => ({
      verify: jest.fn(() => true),
      publicKey: jest.fn(() => 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW'),
    })),
    random: jest.fn(() => ({
      sign: jest.fn(() => Buffer.alloc(64)),
      verify: jest.fn(() => true),
      publicKey: jest.fn(() => 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW'),
      secret: jest.fn(() => 'SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    })),
  },
  Account: jest.fn((publicKey, sequence) => ({
    accountId: () => publicKey,
    sequenceNumber: () => sequence,
  })),
  StrKey: {
    isValidEd25519PublicKey: jest.fn(() => true),
    isValidEd25519SecretSeed: jest.fn(() => true),
  },
  xdr: {
    ScVal: { scvAddress: jest.fn() },
    Address: jest.fn(),
  },
  Contract: jest.fn(),
  SorobanRpc: {
    Server: jest.fn(() => ({
      getAccount: jest.fn(),
      simulateTransaction: jest.fn(),
      prepareTransaction: jest.fn(),
      sendTransaction: jest.fn(),
      getTransaction: jest.fn(),
    })),
  },
  Horizon: {
    Server: jest.fn(() => ({
      loadAccount: jest.fn(),
      submitTransaction: jest.fn(),
      transactions: jest.fn(() => ({
        transaction: jest.fn(() => ({
          call: jest.fn().mockResolvedValue({}),
        })),
      })),
    })),
  },
  BASE_FEE: '100',
  Networks: {
    PUBLIC: 'Public Global Stellar Network ; September 2015',
    TESTNET: 'Test SDF Network ; September 2015',
  },
  TransactionBuilder: jest.fn(),
  Operation: {
    payment: jest.fn(),
    beginSponsoringFutureReserves: jest.fn(),
    endSponsoringFutureReserves: jest.fn(),
    bumpFootprintExpiration: jest.fn(),
    restoreFootprint: jest.fn(),
  },
  Memo: { text: jest.fn() },
  Asset: { native: jest.fn() },
  timeoutInfinite: 0,
};
