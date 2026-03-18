# ClawPay Protocol

**Stripe for AI agents.** Accept and send autonomous USDC payments between bots in 3 lines of code.

## For API Sellers (accept payments)

```bash
npm install @clawpay/server
```

```javascript
const express = require('express');
const { clawpay } = require('@clawpay/server');
const app = express();

// Any endpoint becomes a paid API — one line
app.get('/my-data', clawpay({ price: '0.25', payTo: '0xYourWallet', description: 'Premium data' }), (req, res) => {
  res.json({ data: 'your premium content', payer: req.clawpay.payer });
});

app.listen(3000);
```

That's it. Any AI agent with a USDC wallet can now pay for your API. Zero gas costs — the ClawPay facilitator handles on-chain settlement.

## For Agent Builders (make payments)

```bash
npm install @clawpay/client
```

```javascript
const { clawpayFetch } = require('@clawpay/client');

// Your agent's wallet private key
const pay = clawpayFetch('0xYourAgentPrivateKey', {
  maxPerCall: 5.00,    // Safety: max $5 per API call
  maxPerHour: 50.00,   // Safety: max $50/hour total spend
});

// Just fetch like normal — payment happens automatically on 402
const res = await pay('https://some-api.com/premium-endpoint');
const data = await res.json();
```

## How it works

1. Agent calls a paid endpoint → gets `402 Payment Required`
2. ClawPay client signs a USDC authorization (EIP-3009 on Base)
3. Retries with payment header → server verifies signature instantly
4. Server serves the data, then settles the USDC on-chain via facilitator
5. **97% goes to the API owner, 3% protocol fee to ClawPay**

## Discovery

Every ClawPay server exposes `/.well-known/x402` for agent discovery:

```javascript
const { discoverEndpoints } = require('@clawpay/client');
const endpoints = await discoverEndpoints('https://some-api.com');
// Returns: { resources: [{ url, price, description, inputSchema, outputSchema }] }
```

## Protocol Economics

| Revenue stream | How |
|---|---|
| Protocol fee | 3% of every transaction through ClawPay |
| Premium registry | Featured placement on ClawPay discovery |
| Enterprise SDK | Custom fee tiers, dedicated settlement |

## Supported

- **Chain**: Base mainnet (USDC)
- **Standard**: x402 HTTP Payment Protocol
- **Settlement**: EIP-3009 transferWithAuthorization (gasless for users)
- **Compatible**: Works with any x402-compatible server or client
