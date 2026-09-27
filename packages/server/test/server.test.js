'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { privateKeyToAccount } = require('viem/accounts');
const { clawpay, clawpayDiscovery, CLAWPAY_PROTOCOL_FEE_BPS } = require('../index');

const PAY_TO = '0x589d9F16d7213f99dBc43a9882c39ea2FacAad81';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PRIVATE_KEY = '0x59c6995e998f97a5a0044976f0945389dc9e86dae88c7a8412f4603b6b78690d';
const account = privateKeyToAccount(PRIVATE_KEY);

function response() {
  const listeners = new Map();
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    on(event, fn) { listeners.set(event, fn); return this; },
    finish() { listeners.get('finish')?.(); },
  };
}

function request(paymentHeader) {
  return {
    headers: paymentHeader ? { 'payment-signature': paymentHeader } : {},
    protocol: 'https',
    originalUrl: '/paid',
    get(name) { return name === 'host' ? 'api.example.test' : undefined; },
  };
}

async function signedPayment({ value = '250000', validAfter, validBefore, nonce = `0x${'11'.repeat(32)}` } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address,
    to: PAY_TO,
    value,
    validAfter: String(validAfter ?? now - 10),
    validBefore: String(validBefore ?? now + 300),
    nonce,
  };
  const signature = await account.signTypedData({
    domain: { name: 'USDC', version: '2', chainId: 8453, verifyingContract: USDC },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      ...authorization,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
    },
  });
  return JSON.stringify({ payload: { authorization, signature } });
}

test('configuration fails closed on invalid price or unsupported network', () => {
  assert.throws(() => clawpay({ price: 'nope', payTo: PAY_TO }), /positive finite/);
  assert.throws(() => clawpay({ price: '-1', payTo: PAY_TO }), /positive finite/);
  assert.throws(() => clawpay({ price: '0.01', payTo: PAY_TO, network: 'eip155:1' }), /unsupported network/);
});

test('missing payment returns a canonical 402 requirement', async () => {
  const middleware = clawpay({ price: '0.25', payTo: PAY_TO, description: 'Paid test' });
  const req = request();
  const res = response();
  await middleware(req, res, () => assert.fail('next must not run without payment'));
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.accepts[0].maxAmountRequired, '250000');
  assert.equal(res.body.accepts[0].network, 'eip155:8453');
  assert.equal(res.body.clawpay.fee_bps, CLAWPAY_PROTOCOL_FEE_BPS);
});

test('future authorization is rejected before protected work executes', async () => {
  const now = Math.floor(Date.now() / 1000);
  const middleware = clawpay({ price: '0.25', payTo: PAY_TO });
  const res = response();
  await middleware(request(await signedPayment({ validAfter: now + 60, validBefore: now + 300 })), res, () => assert.fail('next must not run'));
  assert.equal(res.statusCode, 402);
  assert.match(res.body.detail, /not yet valid/);
});

test('valid signed payment reaches the handler with verified payment context', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => ({ ok: true });
  try {
    const middleware = clawpay({ price: '0.25', payTo: PAY_TO });
    const req = request(await signedPayment({ nonce: `0x${'22'.repeat(32)}` }));
    const res = response();
    let calls = 0;
    await middleware(req, res, () => { calls += 1; });
    assert.equal(calls, 1);
    assert.equal(req.clawpay.verified, true);
    assert.equal(req.clawpay.amountUsdc, 0.25);
    assert.equal(req.clawpay.protocolFee, 0.0075);
    res.finish();
  } finally {
    global.fetch = oldFetch;
  }
});

test('same authorization cannot execute protected work twice after success', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => ({ ok: true });
  try {
    const middleware = clawpay({ price: '0.25', payTo: PAY_TO });
    const header = await signedPayment({ nonce: `0x${'33'.repeat(32)}` });
    const firstRes = response();
    let calls = 0;
    await middleware(request(header), firstRes, () => { calls += 1; });
    firstRes.finish();
    const replayRes = response();
    await middleware(request(header), replayRes, () => { calls += 1; });
    assert.equal(calls, 1);
    assert.equal(replayRes.statusCode, 402);
    assert.match(replayRes.body.detail, /replayed/);
  } finally {
    global.fetch = oldFetch;
  }
});

test('failed protected work releases nonce for a legitimate retry', async () => {
  const middleware = clawpay({ price: '0.25', payTo: PAY_TO });
  const header = await signedPayment({ nonce: `0x${'44'.repeat(32)}` });
  const firstRes = response();
  let calls = 0;
  await middleware(request(header), firstRes, () => { calls += 1; firstRes.statusCode = 500; });
  firstRes.finish();
  const retryRes = response();
  await middleware(request(header), retryRes, () => { calls += 1; retryRes.statusCode = 500; });
  assert.equal(calls, 2);
});

test('discovery is deterministic and preserves route contracts', () => {
  const doc = clawpayDiscovery([{ path: '/paid', price: '0.25', description: 'Paid test' }], 'https://api.example.test');
  assert.equal(doc.x402Version, 1);
  assert.equal(doc.resources[0].url, 'https://api.example.test/paid');
  assert.equal(doc.resources[0].price, '$0.25 USDC');
});
