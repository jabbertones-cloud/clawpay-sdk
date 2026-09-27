'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clawpayFetch, discoverEndpoints } = require('../index');

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, async json() { return body; } };
}

test('non-402 responses pass through without loading payment dependencies', async () => {
  const oldFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => { calls.push({ url, init }); return response(200, { ok: true }); };
  try {
    const pay = clawpayFetch('0xdeadbeef');
    const res = await pay('https://api.example.test/free');
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'GET');
  } finally { global.fetch = oldFetch; }
});

test('402 without payment options fails closed', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => response(402, { accepts: [] });
  try {
    const pay = clawpayFetch('0xdeadbeef');
    await assert.rejects(() => pay('https://api.example.test/paid'), /no payment options/);
  } finally { global.fetch = oldFetch; }
});

test('malformed payment amount fails closed before signing', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => response(402, { accepts: [{ maxAmountRequired: 'not-a-number' }] });
  try {
    const pay = clawpayFetch('0xdeadbeef');
    await assert.rejects(() => pay('https://api.example.test/paid'), /Invalid payment amount/);
  } finally { global.fetch = oldFetch; }
});

test('per-call limit blocks payment before signing', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => response(402, { accepts: [{ maxAmountRequired: '2500000' }] });
  try {
    const pay = clawpayFetch('0xdeadbeef', { maxPerCall: 1 });
    await assert.rejects(() => pay('https://api.example.test/paid'), /exceeds maxPerCall/);
  } finally { global.fetch = oldFetch; }
});

test('manual approval mode blocks automatic payment before signing', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => response(402, { accepts: [{ maxAmountRequired: '250000' }] });
  try {
    const pay = clawpayFetch('0xdeadbeef', { autoApprove: false });
    await assert.rejects(() => pay('https://api.example.test/paid'), /requires manual approval/);
  } finally { global.fetch = oldFetch; }
});

test('discovery returns the server document', async () => {
  const oldFetch = global.fetch;
  global.fetch = async (url) => {
    assert.equal(url, 'https://api.example.test/.well-known/x402');
    return response(200, { x402Version: 1, resources: [] });
  };
  try {
    assert.deepEqual(await discoverEndpoints('https://api.example.test'), { x402Version: 1, resources: [] });
  } finally { global.fetch = oldFetch; }
});

test('discovery surfaces HTTP failures', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => response(503, {});
  try {
    await assert.rejects(() => discoverEndpoints('https://api.example.test'), /Discovery failed: 503/);
  } finally { global.fetch = oldFetch; }
});
