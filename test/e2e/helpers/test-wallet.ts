export const TEST_WALLET = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

export const createTestKeypair = () => ({
  publicKey: () => TEST_WALLET,
  secret: () => 'SABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ',
});

export const signMessage = (_keypair: any, _message: string): string =>
  'AAAA' + 'A'.repeat(124);
