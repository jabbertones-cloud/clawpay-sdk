# @clawpay/server

Accept autonomous USDC payments from AI agents in 3 lines of code.

## Install

```bash
npm install @clawpay/server
```

## Usage

```javascript
const { clawpay } = require('@clawpay/server');

app.get('/my-endpoint',
  clawpay({ price: '0.25', payTo: '0xYourWalletAddress', description: 'What your API does' }),
  (req, res) => {
    res.json({ data: yourLogic(), payer: req.clawpay.payer });
  }
);
```

That's it. Your endpoint now accepts USDC payments from any AI agent.

## What happens

1. Bot calls your endpoint → gets 402 with payment requirements
2. Bot signs a USDC authorization → retries with payment proof
3. Your server verifies the signature instantly (local EIP-712)
4. Data is served, USDC settles to your wallet on Base
5. Zero gas fees — the protocol handles settlement

## Options

```javascript
clawpay({
  price: '0.25',                    // Price in USDC
  payTo: '0xYourWallet',            // Your Base wallet address
  description: 'What it does',      // Shown to bots in discovery
  network: 'eip155:8453',           // Base mainnet (default)
  asset: '0x833589f...',            // USDC contract (default)
})
```

## Discovery

Your server automatically publishes `/.well-known/x402` so bots can find your paid endpoints.

## Economics

- 97% of each payment goes to you
- 3% protocol fee
- Zero gas costs
- Cash out USDC on Coinbase anytime

## Links

- Docs: https://autopayagent.com
- Protocol: x402 (HTTP 402 Payment Required)
- Chain: Base mainnet
- Token: USDC
