/**
 * @clawpay/server — Accept autonomous USDC payments from AI agents in 3 lines
 *
 * Usage:
 *   const { clawpay } = require('@clawpay/server');
 *   app.get('/my-api', clawpay({ price: '0.25', description: 'My paid endpoint' }), handler);
 *
 * Every payment goes through ClawPay Protocol:
 *   - 97% to the API owner (payTo wallet)
 *   - 3% protocol fee to ClawPay (funds protocol development + infrastructure)
 *
 * Settlement is handled by ClawPay's facilitator — zero gas cost to you.
 */
'use strict';

const { recoverTypedDataAddress, getAddress } = require('viem');

const CLAWPAY_PROTOCOL_FEE_BPS = 300; // 3% (300 basis points)
const CLAWPAY_FEE_WALLET = '0x589d9F16d7213f99dBc43a9882c39ea2FacAad81'; // ClawPay treasury
const CLAWPAY_API_URL = 'https://autopayagent.com/api/clawpay';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const DEFAULT_NETWORK = 'eip155:8453';

const TRANSFER_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ]
};

/**
 * Create a ClawPay payment gate middleware for Express
 *
 * @param {Object} opts
 * @param {string} opts.price       — Price in USDC (e.g. '0.25')
 * @param {string} opts.payTo       — Your wallet address to receive USDC
 * @param {string} opts.description — Human-readable description of the endpoint
 * @param {string} [opts.network]   — Chain (default: 'eip155:8453' = Base mainnet)
 * @param {string} [opts.asset]     — USDC contract (default: Base USDC)
 * @returns Express middleware
 */
function clawpay(opts = {}) {
  const {
    price,
    payTo,
    description = 'ClawPay-protected endpoint',
    network = DEFAULT_NETWORK,
    asset = USDC_BASE,
  } = opts;

  if (!price || !payTo) throw new Error('clawpay: price and payTo are required');

  const parsedPrice = Number(price);
  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    throw new Error('clawpay: price must be a positive finite USDC amount');
  }
  if (network !== DEFAULT_NETWORK) {
    throw new Error(`clawpay: unsupported network ${network}; this SDK currently verifies Base mainnet only`);
  }

  const normalizedPayTo = getAddress(payTo);
  const normalizedAsset = getAddress(asset);
  const requiredMicro = BigInt(Math.round(parsedPrice * 1e6));
  const activeNonces = new Set();

  return async function clawpayMiddleware(req, res, next) {
    // Check for payment header
    const paymentHeader = req.headers['x-payment'] || req.headers['payment-signature'] || req.headers['x-payment-signature'];

    if (!paymentHeader) {
      // Return 402 with payment requirements
      return res.status(402).json({
        x402Version: 1,
        error: 'Payment Required',
        accepts: [{
          scheme: 'exact',
          network,
          maxAmountRequired: requiredMicro.toString(),
          resource: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
          description,
          mimeType: 'application/json',
          payTo: normalizedPayTo,
          maxTimeoutSeconds: 300,
          asset: normalizedAsset,
          extra: { name: 'USDC', version: '2' },
        }],
        clawpay: {
          protocol: 'clawpay/1.0',
          fee_bps: CLAWPAY_PROTOCOL_FEE_BPS,
          docs: 'https://autopayagent.com/docs/clawpay',
        },
      });
    }

    // Parse payment
    let paymentPayload;
    try {
      paymentPayload = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
    } catch {
      try { paymentPayload = JSON.parse(paymentHeader); } catch {
        return res.status(402).json({ error: 'Invalid payment header' });
      }
    }

    // Local EIP-712 verification
    try {
      const auth = paymentPayload?.payload?.authorization || paymentPayload?.authorization;
      const signature = paymentPayload?.payload?.signature || paymentPayload?.signature;

      if (!auth || !signature) throw new Error('Missing authorization or signature');

      const now = Math.floor(Date.now() / 1000);
      const validAfter = Number(auth.validAfter);
      const validBefore = Number(auth.validBefore);
      if (!Number.isFinite(validAfter) || !Number.isFinite(validBefore)) throw new Error('Invalid authorization window');
      if (validAfter > now) throw new Error('Payment not yet valid');
      if (validBefore <= now) throw new Error('Payment expired');
      if (validBefore <= validAfter) throw new Error('Invalid authorization window');
      const authorizedValue = BigInt(auth.value);
      if (authorizedValue < requiredMicro) throw new Error('Insufficient amount');
      if (getAddress(auth.to) !== normalizedPayTo) throw new Error('Wrong recipient');
      if (typeof auth.nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) throw new Error('Invalid nonce');
      if (activeNonces.has(auth.nonce)) throw new Error('Authorization replayed');

      const recovered = await recoverTypedDataAddress({
        domain: { name: 'USDC', version: '2', chainId: 8453, verifyingContract: normalizedAsset },
        types: TRANSFER_AUTH_TYPES,
        primaryType: 'TransferWithAuthorization',
        message: {
          from: getAddress(auth.from),
          to: getAddress(auth.to),
          value: authorizedValue,
          validAfter: BigInt(auth.validAfter),
          validBefore: BigInt(auth.validBefore),
          nonce: auth.nonce,
        },
        signature,
      });

      if (getAddress(recovered) !== getAddress(auth.from)) {
        throw new Error('Signature mismatch');
      }

      // Payment verified. Reserve the nonce before the protected handler runs so
      // concurrent retries cannot execute the resource twice in this process.
      // Failed resource responses release the reservation; successful responses
      // keep it consumed while ClawPay settlement/analytics is reported.
      activeNonces.add(auth.nonce);
      const amountUsdc = Number(authorizedValue) / 1e6;
      req.clawpay = {
        verified: true,
        payer: auth.from,
        amountUsdc,
        protocolFee: amountUsdc * (CLAWPAY_PROTOCOL_FEE_BPS / 10000),
      };

      res.on('finish', () => {
        if (res.statusCode >= 400) {
          activeNonces.delete(auth.nonce);
          return;
        }
        reportToClawPay({
          paymentPayload,
          payTo: normalizedPayTo,
          price: parsedPrice.toString(),
          endpoint: req.originalUrl,
          payer: auth.from,
          network,
        }).catch(() => {});
      });

      next();

    } catch (e) {
      return res.status(402).json({ error: 'Payment verification failed', detail: e.message });
    }
  };
}

/**
 * Report payment to ClawPay protocol for settlement + fee collection
 */
async function reportToClawPay(data) {
  try {
    await fetch(`${CLAWPAY_API_URL}/report-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {
    // Silent fail — settlement still happens via x402.org facilitator
  }
}

/**
 * Generate .well-known/x402 discovery document
 */
function clawpayDiscovery(routes, baseUrl) {
  return {
    x402Version: 1,
    protocol: 'clawpay/1.0',
    resources: routes.map(r => ({
      url: `${baseUrl}${r.path}`,
      method: r.method || 'GET',
      price: `$${r.price} USDC`,
      description: r.description,
      inputSchema: r.inputSchema || { type: 'http', method: r.method || 'GET', path: r.path },
      outputSchema: r.outputSchema || { type: 'object' },
    })),
  };
}

module.exports = { clawpay, clawpayDiscovery, CLAWPAY_PROTOCOL_FEE_BPS };
