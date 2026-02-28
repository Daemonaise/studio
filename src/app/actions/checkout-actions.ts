'use server';

import Stripe from 'stripe';

export interface ShippingInfo {
  fullName: string;
  email: string;
  phone: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface CheckoutQuoteData {
  totalCost: number;
  material: string;
  jobScale: string;
  mode: string;
  leadTimeMin: number;
  leadTimeMax: number;
  estimatedHours: number;
  selectedPrinterKey: string;
  fileName: string;
}

// Exported so checkout-success-client can import the type without re-declaring it
export interface OrderFulfillmentResult {
  success: boolean;
  error?: string;
  paymentAmount?: number;
  shipping?: ShippingInfo;
  material?: string;
  jobScale?: string;
  leadTimeMin?: number;
  leadTimeMax?: number;
  trackingNumber?: string;
  trackingUrl?: string;
  carrier?: string;
  shippoOrderId?: string;
  orderNumber?: string;
}

// Stripe client singleton factory (avoids re-instantiating per call)
function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set.');
  // No apiVersion specified — SDK uses its own pinned version
  return new Stripe(key);
}

// Create a Stripe Checkout Session for quote payment
export async function createCheckoutSession(
  quote: CheckoutQuoteData,
  shipping: ShippingInfo
): Promise<{ url: string | null; error?: string }> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      url: null,
      error: 'Payment system is not configured. Please contact support to complete your order.',
    };
  }

  try {
    const stripe = getStripe();
    const amountCents = Math.round(quote.totalCost * 100);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `3D Print: ${quote.material} – ${quote.jobScale}`,
              description: `${quote.mode} · Est. lead time: ${quote.leadTimeMin}–${quote.leadTimeMax} business days`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: shipping.email,
      metadata: {
        fullName: shipping.fullName,
        phone: shipping.phone,
        company: shipping.company || '',
        address1: shipping.address1,
        address2: shipping.address2 || '',
        city: shipping.city,
        state: shipping.state,
        zip: shipping.zip,
        country: shipping.country,
        material: quote.material,
        jobScale: quote.jobScale,
        leadTimeMin: String(quote.leadTimeMin),
        leadTimeMax: String(quote.leadTimeMax),
        estimatedHours: String(quote.estimatedHours),
        fileName: quote.fileName,
      },
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:9002'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:9002'}/quote`,
    });

    return { url: session.url };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to create checkout session.';
    console.error('Stripe error:', msg);
    return { url: null, error: msg };
  }
}

// Verify Stripe session and create Shippo shipment
export async function verifyAndFulfillOrder(
  sessionId: string
): Promise<OrderFulfillmentResult> {
  // Validate session ID format before making the API call
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return { success: false, error: 'Invalid or missing session ID.' };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return { success: false, error: 'Payment system not configured.' };
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session || session.payment_status !== 'paid') {
      return { success: false, error: 'Payment not completed.' };
    }

    const meta = session.metadata ?? {};
    const shipping: ShippingInfo = {
      fullName: meta.fullName || '',
      email: session.customer_email || '',
      phone: meta.phone || '',
      company: meta.company || undefined,
      address1: meta.address1 || '',
      address2: meta.address2 || undefined,
      city: meta.city || '',
      state: meta.state || '',
      zip: meta.zip || '',
      country: meta.country || 'US',
    };

    const orderNumber = `KL-${Date.now().toString(36).toUpperCase()}`;

    // Attempt Shippo label creation — non-blocking; order succeeds even if this fails
    let trackingNumber: string | undefined;
    let trackingUrl: string | undefined;
    let carrier: string | undefined;
    let shippoOrderId: string | undefined;

    if (process.env.SHIPPO_API_KEY) {
      try {
        const result = await createShippoShipment(process.env.SHIPPO_API_KEY, shipping, {
          orderNumber,
          estimatedHours: parseFloat(meta.estimatedHours || '1'),
        });
        trackingNumber = result.trackingNumber;
        trackingUrl = result.trackingUrl;
        carrier = result.carrier;
        shippoOrderId = result.shipmentId;
      } catch (shippoErr) {
        console.error('Shippo error (non-blocking):', shippoErr);
      }
    }

    return {
      success: true,
      paymentAmount: (session.amount_total ?? 0) / 100,
      shipping,
      material: meta.material,
      jobScale: meta.jobScale,
      leadTimeMin: parseInt(meta.leadTimeMin || '3', 10),
      leadTimeMax: parseInt(meta.leadTimeMax || '7', 10),
      trackingNumber,
      trackingUrl,
      carrier,
      shippoOrderId,
      orderNumber,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to verify order.';
    console.error('Order fulfillment error:', msg);
    return { success: false, error: msg };
  }
}

// ── Shippo REST API helper ────────────────────────────────────────────────────

interface ShippoResult {
  shipmentId?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  carrier?: string;
}

async function createShippoShipment(
  apiKey: string,
  shipping: ShippingInfo,
  meta: { orderNumber: string; estimatedHours: number }
): Promise<ShippoResult> {
  // Rough weight estimate: 0.3 kg per print-hour + 0.5 kg packaging, min 0.5 kg
  const weightKg = Math.max(0.5, meta.estimatedHours * 0.3 + 0.5).toFixed(2);

  const shipmentRes = await fetch('https://api.goshippo.com/shipments/', {
    method: 'POST',
    headers: {
      Authorization: `ShippoToken ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      address_from: {
        name: 'Karasawa Labs',
        company: 'Karasawa Labs',
        street1: process.env.SHIPPO_FROM_STREET || '123 Manufacturing Dr',
        city: process.env.SHIPPO_FROM_CITY || 'Austin',
        state: process.env.SHIPPO_FROM_STATE || 'TX',
        zip: process.env.SHIPPO_FROM_ZIP || '78701',
        country: 'US',
        phone: process.env.SHIPPO_FROM_PHONE || '+15121234567',
        email: process.env.SHIPPO_FROM_EMAIL || 'shipping@karasawalabs.com',
      },
      address_to: {
        name: shipping.fullName,
        company: shipping.company || '',
        street1: shipping.address1,
        street2: shipping.address2 || '',
        city: shipping.city,
        state: shipping.state,
        zip: shipping.zip,
        country: shipping.country,
        phone: shipping.phone,
        email: shipping.email,
      },
      parcels: [
        {
          length: '30',
          width: '25',
          height: '20',
          distance_unit: 'cm',
          weight: weightKg,
          mass_unit: 'kg',
        },
      ],
      async: false,
    }),
  });

  if (!shipmentRes.ok) {
    throw new Error(`Shippo shipment error: ${shipmentRes.status}`);
  }

  const shipment = await shipmentRes.json();
  const shipmentId: string = shipment.object_id;

  // Pick the cheapest available rate
  const rates: { object_id: string; amount: string; provider: string }[] =
    shipment.rates ?? [];

  if (rates.length === 0) {
    return { shipmentId };
  }

  const cheapest = rates.reduce((best, r) =>
    parseFloat(r.amount) < parseFloat(best.amount) ? r : best
  );

  // Purchase label
  const txRes = await fetch('https://api.goshippo.com/transactions/', {
    method: 'POST',
    headers: {
      Authorization: `ShippoToken ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      rate: cheapest.object_id,
      label_file_type: 'PDF',
      async: false,
    }),
  });

  if (!txRes.ok) {
    // Return partial result — shipment created but no label
    return { shipmentId };
  }

  const tx = await txRes.json();
  return {
    shipmentId,
    trackingNumber: tx.tracking_number,
    trackingUrl: tx.tracking_url_provider,
    carrier: cheapest.provider,
  };
}
