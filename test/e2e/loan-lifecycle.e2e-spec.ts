import * as request from 'supertest';
import {
  buildTestApp,
  closeTestApp,
  seedVendor,
  InMemoryStore,
} from './helpers/test-setup';
import { createTestKeypair, signMessage } from './helpers/test-wallet';

describe('Loan Lifecycle (e2e)', () => {
  let app: any;
  let mockDb: InMemoryStore;
  let authToken: string;
  let wallet: string;
  let vendorId: string;
  let loanUuid: string;
  let totalRepayment: number;
  let monthlyPayment: number;

  beforeAll(async () => {
    const ctx = await buildTestApp();
    app = ctx.app;
    mockDb = ctx.mockDb;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('1. Auth Flow', () => {
    it('should generate nonce and verify signature to receive JWT', async () => {
      const keypair = createTestKeypair();
      wallet = keypair.publicKey();

      const nonceRes = await request(app.getHttpServer())
        .post('/auth/nonce')
        .send({ wallet })
        .expect(201);

      expect(nonceRes.body).toHaveProperty('nonce');
      expect(nonceRes.body).toHaveProperty('expiresAt');
      expect(nonceRes.body.nonce).toHaveLength(64);

      const signature = signMessage(keypair, nonceRes.body.nonce);

      const verifyRes = await request(app.getHttpServer())
        .post('/auth/verify')
        .send({ wallet, nonce: nonceRes.body.nonce, signature })
        .expect(200);

      expect(verifyRes.body).toHaveProperty('accessToken');
      expect(verifyRes.body).toHaveProperty('refreshToken');
      expect(verifyRes.body.tokenType).toBe('Bearer');
      expect(verifyRes.body.expiresIn).toBe(900);

      authToken = verifyRes.body.accessToken;
    });

    it('should reject verify with invalid signature format', async () => {
      await request(app.getHttpServer())
        .post('/auth/verify')
        .send({ wallet, nonce: 'a'.repeat(64), signature: 'AAAA' })
        .expect(401);
    });
  });

  describe('2. Learner Profile', () => {
    it('should upsert and retrieve learner profile', async () => {
      const profileData = {
        school: 'University of Lagos',
        program: 'Computer Science',
        programType: 'university',
        incomeType: 'student',
        monthlyIncome: 500,
        country: 'Nigeria',
        city: 'Lagos',
      };

      const patchRes = await request(app.getHttpServer())
        .patch('/learners/me')
        .set('Authorization', `Bearer ${authToken}`)
        .send(profileData)
        .expect(200);

      expect(patchRes.body.walletAddress).toBe(wallet);
      expect(patchRes.body.school).toBe('University of Lagos');

      const getRes = await request(app.getHttpServer())
        .get('/learners/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(getRes.body.walletAddress).toBe(wallet);
      expect(getRes.body.school).toBe('University of Lagos');
    });

    it('should return 401 without auth token', async () => {
      await request(app.getHttpServer())
        .get('/learners/me')
        .expect(401);
    });
  });

  describe('3. Vendor Setup', () => {
    it('should list available vendors', async () => {
      const vendor = await seedVendor(mockDb);
      vendorId = vendor.id;

      const res = await request(app.getHttpServer())
        .get('/vendors')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find((v: any) => v.id === vendorId);
      expect(found).toBeDefined();
      expect(found.name).toBe('Test Vendor');
      expect(found.verified).toBe(true);
    });
  });

  describe('4. Loan Application', () => {
    it('should get a loan quote', async () => {
      const res = await request(app.getHttpServer())
        .post('/loans/quote')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ amount: 500, vendor: vendorId, term: 4 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.amount).toBe(500);
      expect(res.body.data.guarantee).toBe(100);
      expect(res.body.data.loanAmount).toBe(400);
      expect(res.body.data.term).toBe(4);
      expect(res.body.data.schedule).toHaveLength(4);

      totalRepayment = res.body.data.totalRepayment;
      monthlyPayment = res.body.data.monthlyPayment;
    });

    it('should create a pending loan', async () => {
      const res = await request(app.getHttpServer())
        .post('/loans/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ amount: 500, vendor: vendorId, term: 4 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('loanId');
      expect(res.body.data).toHaveProperty('xdr');
      expect(res.body.data.assessment.decision).toBe('approved');
      expect(res.body.data.terms.amount).toBe(500);

      const provisionalLoanId = res.body.data.loanId;
      expect(provisionalLoanId).toMatch(/^pending-/);

      const loans = mockDb.dump('loans');
      const created = loans.find((l: any) => l.loan_id === provisionalLoanId);
      expect(created).toBeDefined();
      expect(created.status).toBe('pending');
      expect(created.user_wallet).toBe(wallet);

      loanUuid = created.id;
    });
  });

  describe('5. Loan Approval', () => {
    it('should assess and approve the pending loan', async () => {
      const res = await request(app.getHttpServer())
        .post(`/loans/${loanUuid}/assess`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.assessment.decision).toBe('approved');
      expect(res.body.data.previousStatus).toBe('pending');
      expect(res.body.data.currentStatus).toBe('pending');
    });
  });

  describe('6. Installment Repayment', () => {
    it('should reject repayment on a pending loan', async () => {
      await request(app.getHttpServer())
        .post(`/loans/${loanUuid}/pay`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ amount: monthlyPayment })
        .expect(400);
    });

    it('should process a partial repayment after loan is active', async () => {
      const loans = mockDb.dump('loans');
      const loan = loans.find((l: any) => l.id === loanUuid);
      loan.status = 'active';
      loan.updated_at = new Date().toISOString();

      const res = await request(app.getHttpServer())
        .post(`/loans/${loanUuid}/pay`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ amount: monthlyPayment })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('unsignedXdr');
      expect(res.body.data.preview.paymentAmount).toBe(monthlyPayment);
      expect(res.body.data.preview.currentBalance).toBe(totalRepayment);
      expect(res.body.data.preview.newBalance).toBeGreaterThan(0);
      expect(res.body.data.preview.willComplete).toBe(false);

      // Simulate blockchain indexer updating remaining_balance after payment
      loan.remaining_balance = res.body.data.preview.newBalance;
    });
  });

  describe('7. Reputation Check', () => {
    it('should return reputation for the authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .get('/reputation/me')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.wallet).toBe(wallet);
      expect(res.body.data.score).toBe(75);
      expect(res.body.data.tier).toBe('silver');
      expect(res.body.data.maxCredit).toBe(3000);
    });

    it('should return reputation for a wallet address', async () => {
      const res = await request(app.getHttpServer())
        .get(`/reputation/${wallet}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.wallet).toBe(wallet);
    });
  });

  describe('8. Full Repayment', () => {
    it('should process full repayment to complete the loan', async () => {
      const remainingBalance = totalRepayment - monthlyPayment;
      const roundedRemaining = Math.round(remainingBalance * 100) / 100;

      const res = await request(app.getHttpServer())
        .post(`/loans/${loanUuid}/pay`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ amount: roundedRemaining })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.preview.paymentAmount).toBe(roundedRemaining);
      expect(res.body.data.preview.newBalance).toBe(0);
      expect(res.body.data.preview.willComplete).toBe(true);
    });
  });
});
