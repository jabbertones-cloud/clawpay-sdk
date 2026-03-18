# Your bot can make money while you sleep

If you built a bot that does something useful — answers questions, fetches data, runs analysis, generates content — other bots will pay to use it. Real USDC, real money, straight to your wallet.

## How it works

1. You have a bot/API that does something useful
2. You add 3 lines of code
3. Any AI agent with a crypto wallet can now pay you to use it
4. Money goes to your wallet automatically
5. You can send it to Coinbase and cash out anytime

## Setup (2 minutes)

```bash
npm install @clawpay/server
```

In your Express app:

```javascript
const { clawpay } = require('@clawpay/server');

// Pick your price. This endpoint now costs $0.25 per call.
app.get('/my-endpoint',
  clawpay({ price: '0.25', payTo: '0xYOUR_WALLET_ADDRESS', description: 'What your bot does' }),
  (req, res) => {
    // Your existing code — nothing changes
    res.json({ data: yourBotLogic() });
  }
);
```

That's it. Three lines. Your bot now accepts USDC payments on Base.

## Where does the money go?

Straight to your wallet address on Base. You can:
- Send it to Coinbase and cash out to your bank
- Send it to any exchange
- Use it to pay other bots
- Hold it as USDC

## How do bots find me?

Your server automatically publishes a discovery document at `/.well-known/x402` that tells other bots what you offer and what it costs. Bots crawling for paid APIs will find you. The more useful your endpoint, the more traffic you get.

## What does it cost me?

- **Zero setup cost**
- **Zero gas fees** (the protocol handles that)
- **3% of each payment** goes to protocol maintenance
- **97% goes to you**

## What bots will pay for

Bots pay for the same things humans pay for — just faster and at higher volume:

- **Data feeds** — crypto prices, weather, news, market data
- **AI generation** — text, images, code, summaries
- **Analysis** — sentiment, risk scoring, classification
- **Verification** — identity, payment, document validation
- **Automation** — scheduling, notifications, workflows
- **Intelligence** — web scraping, lead data, competitive intel

Price it based on value. A bot that saves another bot $10 of compute can easily charge $1 per call.

## Example: Crypto price bot

```javascript
const express = require('express');
const { clawpay } = require('@clawpay/server');
const app = express();

app.get('/prices',
  clawpay({ price: '0.10', payTo: '0xYOUR_WALLET', description: 'Live crypto prices' }),
  async (req, res) => {
    const prices = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd');
    res.json(await prices.json());
  }
);

app.listen(3000);
// Now any bot can pay $0.10 to get live crypto prices from you
```

## Questions

**Do I need crypto experience?** No. You need a wallet address on Base (free — create one on Coinbase).

**Do I need to hold ETH for gas?** No. The protocol handles settlement. Zero gas cost to you.

**Can I change my price?** Anytime. Just change the number.

**What if a bot tries to use my API without paying?** They get a 402 error. No payment, no data.

**Can I see who's paying me?** Yes. Every payment includes the payer's wallet address and is logged.
