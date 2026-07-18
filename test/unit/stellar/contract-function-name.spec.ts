import * as fs from 'fs';
import * as path from 'path';

describe('Repayment function name alignment', () => {
  const creditlinePath = path.join(
    __dirname,
    '../../../src/stellar/contracts/clients/creditline.client.ts',
  );
  const checkerPath = path.join(
    __dirname,
    '../../../src/jobs/transaction-status-checker/transaction-status-checker.service.ts',
  );

  it('XDR builder and transaction checker use the same function name', () => {
    const creditlineSource = fs.readFileSync(creditlinePath, 'utf8');
    const checkerSource = fs.readFileSync(checkerPath, 'utf8');

    const xdrFnNames = creditlineSource.match(/contract\.call\('([^']+)'/g) || [];
    const repayFnName = xdrFnNames
      .map((m) => m.match(/contract\.call\('([^']+)'/)?.[1])
      .find((n) => n !== 'create_loan');
    const checkerFnNames = checkerSource.match(/functionName === '([^']+)'/g) || [];
    const checkerRepayFnName = checkerFnNames
      .map((m) => m.match(/functionName === '([^']+)'/)?.[1])
      .find((n) => n !== 'create_loan');

    expect(repayFnName).toBeDefined();
    expect(checkerRepayFnName).toBeDefined();
    expect(repayFnName).toBe(checkerRepayFnName);
  });

  it('uses the correct contract function name: repay_installment', () => {
    const creditlineSource = fs.readFileSync(creditlinePath, 'utf8');
    const xdrFnNames = creditlineSource.match(/contract\.call\('([^']+)'/g) || [];
    const repayFnName = xdrFnNames
      .map((m) => m.match(/contract\.call\('([^']+)'/)?.[1])
      .find((n) => n !== 'create_loan');
    expect(repayFnName).toBe('repay_installment');
  });
});
