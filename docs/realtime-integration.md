# Real-Time Notifications Integration Guide

This document explains how web and mobile clients can subscribe to real-time events from the StepFi API. Two channels are provided for real-time updates:
1. **Supabase Realtime (Database Replication)**: Recommended for simple database table synchronization.
2. **WebSocket Gateway (Standalone Port)**: Best for dedicated real-time event-driven updates.

---

## 1. Supabase Realtime

We have enabled Postgres changes replication on the following tables:
- `loan_index`: Emits changes when a loan is created, updated, or defaulted.
- `payment_index`: Emits insertions when a payment is processed.

### How to Subscribe (JS/TS Example)

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('SUPABASE_URL', 'SUPABASE_ANON_KEY');

// 1. Subscribe to Loan Status changes
const loanChannel = supabase
  .channel('loan-status-changes')
  .on(
    'postgres_changes',
    {
      event: 'UPDATE', // Listen for updates (active -> paid, defaulted, etc)
      schema: 'public',
      table: 'loan_index',
    },
    (payload) => {
      console.log('Loan status updated:', payload.new);
      // payload.new.status contains 'paid' or 'defaulted'
    }
  )
  .subscribe();

// 2. Subscribe to Payment Confirmations
const paymentChannel = supabase
  .channel('payment-confirmations')
  .on(
    'postgres_changes',
    {
      event: 'INSERT', // Listen for insertions of new payments
      schema: 'public',
      table: 'payment_index',
    },
    (payload) => {
      console.log('Payment confirmed:', payload.new);
      // payload.new contains loan_id, tx_hash, amount, paid_at
    }
  )
  .subscribe();
```

---

## 2. WebSocket Gateway

The API exposes a WebSocket Gateway running on a dedicated port (`3005` by default, configurable via `WEBSOCKET_PORT`).

- **Endpoint**: `ws://localhost:3005` (or custom host/port)

### Gateway Events

#### `loan.status_changed`
Emitted immediately after a ledger event updates a loan's status in the index.
- **Payload Schema**:
  ```json
  {
    "loanId": "string",
    "status": "active" | "paid" | "defaulted",
    "userWallet": "string (optional)",
    "principalAmount": "string (optional)",
    "interestAmount": "string (optional)",
    "dueDate": "string (optional)"
  }
  ```

#### `payment.confirmed`
Emitted immediately when a new payment confirmation block is parsed and written to the DB index.
- **Payload Schema**:
  ```json
  {
    "loanId": "string",
    "txHash": "string",
    "amount": "string",
    "paidAt": "string"
  }
  ```

### How to Subscribe (JS Example)

```javascript
const ws = new WebSocket('ws://localhost:3005');

ws.onopen = () => {
  console.log('Connected to StepFi WebSocket Gateway');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`Received event ${data.event}:`, data.payload);

  if (data.event === 'loan.status_changed') {
    handleLoanStatusUpdate(data.payload.loanId, data.payload.status);
  } else if (data.event === 'payment.confirmed') {
    showPaymentToast(data.payload.amount, data.payload.txHash);
  }
};

ws.onclose = () => {
  console.log('Disconnected from WebSocket Gateway');
};
```
