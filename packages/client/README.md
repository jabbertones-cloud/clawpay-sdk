# @clawpay/client

Make your AI agent autonomously pay for any x402/ClawPay-enabled API.

## Install

```bash
npm install @clawpay/client
```

## Usage

```javascript
const { clawpayFetch } = require('@clawpay/client');

const pay = clawpayFetch('0xYourAgentPrivateKey', {
  maxPerCall: 5.00,    // Safety limit per call
  maxPerHour: 50.00,   // Safety limit per hour
});

// Just use it like fetch — payment happens automatically on 402
const res = await pay('https://some-api.com/paid-endpoint');
const data = await res.json();
```

## How it works

1. Your agent calls an API → if it returns 402, ClawPay handles payment
2. Signs a USDC authorization on Base (EIP-3009 — no gas needed)
3. Retries with payment proof → gets the data
4. All automatic, all within safety limits you set

## Safety

- `maxPerCall` — Won't pay more than this for a single API call
- `maxPerHour` — Won't exceed this total in any hour
- `autoApprove` — Set to `false` to require manual approval

## Discover endpoints

```javascript
const { discoverEndpoints } = require('@clawpay/client');
const endpoints = await discoverEndpoints('https://some-api.com');
// { resources: [{ url, price, description }] }
```

## Links

- Docs: https://autopayagent.com
- Protocol: x402
- Chain: Base mainnet (USDC)
