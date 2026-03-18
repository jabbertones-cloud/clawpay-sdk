/**
 * @clawpay/client — Make your AI agent pay for any ClawPay-enabled API
 *
 * Usage:
 *   const { clawpayFetch } = require('@clawpay/client');
 *   const pay = clawpayFetch('0xYourPrivateKey');
 *   const res = await pay('https://some-api.com/paid-endpoint');
 *   // Automatically handles 402 → sign → pay → get data
 *
 * Works with ANY x402-compatible endpoint, not just ClawPay servers.
 */
'use strict';

/**
 * Create an autonomous payment-enabled fetch function
 *
 * @param {string} privateKey — EVM private key (0x...)
 * @param {Object} [opts]
 * @param {number} [opts.maxPerCall]  — Max USDC per single call (default: 10.00)
 * @param {number} [opts.maxPerHour]  — Max USDC per hour (default: 100.00)
 * @param {boolean} [opts.autoApprove] — Auto-approve all payments (default: true)
 * @returns {Function} fetch-compatible function that handles x402 payments
 */
function clawpayFetch(privateKey, opts = {}) {
  const {
    maxPerCall = 10.00,
    maxPerHour = 100.00,
    autoApprove = true,
  } = opts;

  let hourlySpend = 0;
  let hourlyReset = Date.now() + 3600000;

  // Lazy-load x402 dependencies
  let payFetchFn = null;

  async function getPayFetch() {
    if (payFetchFn) return payFetchFn;

    const { wrapFetchWithPayment, x402Client } = require('@x402/fetch');
    const { ExactEvmScheme } = require('@x402/evm');
    const { ExactEvmSchemeV1 } = require('@x402/evm/v1');
    const { privateKeyToAccount } = await import('viem/accounts');

    const account = privateKeyToAccount(privateKey);

    // Build client with v1 + v2 support
    const v1Signer = { address: account.address, signTypedData: (msg) => account.signTypedData(msg) };
    const v1Scheme = new ExactEvmSchemeV1(v1Signer);
    const v1Patched = {
      scheme: 'exact',
      createPaymentPayload: async (version, req) => {
        const translated = { ...req, network: req.network === 'eip155:8453' ? 'base' : req.network };
        return v1Scheme.createPaymentPayload(version, translated);
      }
    };

    const client = new x402Client();
    client.registerV1('eip155:8453', v1Patched);
    client.register('eip155:8453', new ExactEvmScheme(account));

    payFetchFn = wrapFetchWithPayment(fetch, client);
    return payFetchFn;
  }

  return async function clawpayFetchWrapper(url, init = {}) {
    // Reset hourly counter
    if (Date.now() > hourlyReset) {
      hourlySpend = 0;
      hourlyReset = Date.now() + 3600000;
    }

    // First request — check if it needs payment
    const firstRes = await fetch(url, { ...init, method: init.method || 'GET' });

    if (firstRes.status !== 402) {
      return firstRes; // No payment needed
    }

    // Parse payment requirements to check amount
    let body;
    try { body = await firstRes.json(); } catch { body = {}; }

    const accepts = body.accepts || [];
    if (accepts.length === 0) {
      throw new Error('ClawPay: 402 response has no payment options');
    }

    const amount = parseInt(accepts[0].maxAmountRequired || '0') / 1e6;

    // Safety checks
    if (amount > maxPerCall) {
      throw new Error(`ClawPay: Payment $${amount} exceeds maxPerCall $${maxPerCall}`);
    }
    if (hourlySpend + amount > maxPerHour) {
      throw new Error(`ClawPay: Hourly spend limit reached ($${hourlySpend}/$${maxPerHour})`);
    }

    if (!autoApprove) {
      throw new Error(`ClawPay: Payment of $${amount} requires manual approval (autoApprove=false)`);
    }

    // Make payment
    const payFetch = await getPayFetch();
    const payRes = await payFetch(url, init);

    if (payRes.status === 200 || payRes.status === 201) {
      hourlySpend += amount;
    }

    return payRes;
  };
}

/**
 * Discover ClawPay endpoints on a server
 *
 * @param {string} baseUrl — e.g. 'https://some-api.com'
 * @returns {Object} Discovery document with available paid endpoints
 */
async function discoverEndpoints(baseUrl) {
  const res = await fetch(`${baseUrl}/.well-known/x402`);
  if (!res.ok) throw new Error(`Discovery failed: ${res.status}`);
  return res.json();
}

module.exports = { clawpayFetch, discoverEndpoints };
