# Karasawa Labs

Precision 3D printing and automotive manufacturing platform — from rapid prototyping to full-scale production. Customers upload 3D models, get an AI-powered instant quote, and checkout directly through Stripe.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15.5 (App Router) |
| UI | React 19, Tailwind CSS v3, shadcn/ui |
| AI | Google Genkit + Gemini 2.5 Flash |
| Payments | Stripe Checkout |
| Shipping | Shippo REST API |
| Hosting | Firebase App Hosting |

## Key Features

- **AI Quote Wizard** — Upload STL/OBJ/3MF, pick a material and nozzle size, receive an AI-generated cost breakdown and lead time estimate
- **Stripe Checkout** — Full payment flow with shipping info collected pre-checkout; metadata forwarded to fulfilment
- **Shippo Integration** — Automatic shipment creation and label purchase on order success; tracking info surfaced in the customer portal
- **Customer Portal** — Order history, status badges, and shipment tracking stored client-side (localStorage)
- **AI Engineering Assistant** — Chat interface powered by Gemini for material and design advice
- **Splash Screen and Page Transitions** — Futuristic animated loading screen on every visit; teal sweep transition between routes

## Project Structure

```
src/
├── ai/
│   ├── flows/
│   │   ├── ai-engineering-assistant-flow.ts
│   │   └── quote-generator-flow.ts
│   └── genkit.ts
├── app/
│   ├── (auth)/               # Login and register routes
│   ├── (main)/               # All public-facing pages
│   │   ├── assistant/
│   │   ├── automotive/
│   │   ├── checkout/success/
│   │   ├── contact/
│   │   ├── faq/
│   │   ├── materials/
│   │   ├── portal/           # Customer order portal
│   │   └── quote/
│   ├── actions/
│   │   ├── checkout-actions.ts   # Stripe + Shippo server actions
│   │   ├── quote-actions.ts
│   │   └── assistant-actions.ts
│   ├── data/
│   │   ├── materials.ts
│   │   └── pricing-matrix.json
│   ├── globals.css
│   ├── icon.svg              # Favicon (auto-detected by Next.js)
│   ├── layout.tsx
│   └── opengraph-image.tsx   # Dynamic OG image 1200x630
├── components/
│   ├── assistant/            # Floating chat bubble and interface
│   ├── layout/               # Header, footer, splash screen, page transition
│   ├── quote/                # AutomotiveQuoteWizard
│   └── ui/                   # shadcn/ui primitives
├── hooks/
└── lib/

public/
├── images/
│   └── logo.svg              # Full Karasawa Labs wordmark SVG
└── index.html                # Firebase Hosting static fallback
```

## Required Environment Variables

```bash
# AI
GEMINI_API_KEY=

# Stripe (test keys: sk_test_ / pk_test_)
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Shippo
SHIPPO_API_KEY=                    # shippo_test_... or shippo_live_...

# Shippo from-address for labels
SHIPPO_FROM_STREET=
SHIPPO_FROM_CITY=
SHIPPO_FROM_STATE=
SHIPPO_FROM_ZIP=
SHIPPO_FROM_PHONE=                 # E.164 format e.g. +15551234567
SHIPPO_FROM_EMAIL=

# App
NEXT_PUBLIC_BASE_URL=https://your-domain.com
```

## Development

```bash
npm install
npm run dev        # starts on http://localhost:9002
```

## Checkout Flow

1. User uploads model and AI generates a quote
2. User clicks **Proceed to Checkout** and fills in shipping details
3. `createCheckoutSession` builds a Stripe Checkout Session with full order metadata
4. Stripe redirects to `/checkout/success?session_id=cs_...`
5. `verifyAndFulfillOrder` confirms payment, then creates a Shippo shipment and purchases a shipping label
6. Order saved to `localStorage` key `kl_orders` for the customer portal
7. Customer profile (name, email) saved to `localStorage` key `kl_customer`

## Deployment

Deployed via Firebase App Hosting (`apphosting.yaml`). The `public/` directory is the Firebase Hosting static fallback — the live Next.js app is served by the App Hosting backend.
