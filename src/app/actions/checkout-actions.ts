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

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set.');
  return new Stripe(key, { apiVersion: '2026-02-25.clover' });
}

// Stripe metadata values are capped at 500 chars
function trim500(val: string): string {
  return val.slice(0, 500);
}

export async function createCheckoutSession(
  quote: CheckoutQuoteData,
  shipping: ShippingInfo
): Promise<{ url: string | null; error?: string }> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return {
      url: null,
      error: 'Payment system is not configured. Please contact support.',
    };
  }

  try {
    const stripe = getStripe();

    // Stripe minimum charge is $0.50 — enforce $1.00 floor
    const rawCents = Math.round(quote.totalCost * 100);
    const amountCents = Math.max(rawCents, 100);

    const baseUrl = (
      process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:9002'
    ).replace(/\/$/, '');

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `3D Print: ${quote.material} – ${quote.jobScale}`,
              description: trim500(
                `${quote.mode} · Lead time: ${quote.leadTimeMin}–${quote.leadTimeMax} business days`
              ),
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: shipping.email,
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'GB', 'AU'],
      },
      metadata: {
        fullName:       trim500(shipping.fullName),
        phone:          trim500(shipping.phone),
        company:        trim500(shipping.company || ''),
        address1:       trim500(shipping.address1),
        address2:       trim500(shipping.address2 || ''),
        city:           trim500(shipping.city),
        state:          trim500(shipping.state),
        zip:            trim500(shipping.zip),
        country:        trim500(shipping.country),
        material:       trim500(quote.material),
        jobScale:       trim500(quote.jobScale),
        leadTimeMin:    String(quote.leadTimeMin),
        leadTimeMax:    String(quote.leadTimeMax),
        estimatedHours: String(quote.estimatedHours),
        fileName:       trim500(quote.fileName),
      },
      success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${baseUrl}/quote`,
    });

    return { url: session.url };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to create checkout session.';
    console.error('[Stripe] createCheckoutSession error:', msg);
    return { url: null, error: msg };
  }
}

export async function verifyAndFulfillOrder(
  sessionId: string
): Promise<OrderFulfillmentResult> {
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
      email:    session.customer_email || '',
      phone:    meta.phone || '',
      company:  meta.company || undefined,
      address1: meta.address1 || '',
      address2: meta.address2 || undefined,
      city:     meta.city || '',
      state:    meta.state || '',
      zip:      meta.zip || '',
      country:  meta.country || 'US',
    };

    const orderNumber = `KL-${Date.now().toString(36).toUpperCase()}`;

    let trackingNumber: string | undefined;
    let trackingUrl:    string | undefined;
    let carrier:        string | undefined;
    let shippoOrderId:  string | undefined;

    if (process.env.SHIPPO_API_KEY) {
      try {
        const result = await createShippoShipment(
          process.env.SHIPPO_API_KEY,
          shipping,
          { orderNumber, estimatedHours: parseFloat(meta.estimatedHours || '1') }
        );
        trackingNumber = result.trackingNumber;
        trackingUrl    = result.trackingUrl;
        carrier        = result.carrier;
        shippoOrderId  = result.shipmentId;
      } catch (shippoErr) {
        // Non-blocking — order succeeds even if label creation fails
        console.error('[Shippo] non-blocking error:', shippoErr);
      }
    }

    return {
      success:       true,
      paymentAmount: (session.amount_total ?? 0) / 100,
      shipping,
      material:    meta.material,
      jobScale:    meta.jobScale,
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
    console.error('[Checkout] verifyAndFulfillOrder error:', msg);
    return { success: false, error: msg };
  }
}

// ── Shippo REST API ───────────────────────────────────────────────────────────

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
  const headers = {
    Authorization: `ShippoToken ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // Weight: 0.5 kg per print-hour + 0.5 kg packaging, min 0.5 kg
  const hours = meta.estimatedHours;
  const weightKg = Math.max(0.5, hours * 0.5 + 0.5).toFixed(2);

  // Parcel dimensions scale with estimated print hours (proxy for part volume)
  // Small  < 3 h  → 20×15×10 cm
  // Medium 3–10 h → 35×30×25 cm
  // Large  10–25h → 55×45×35 cm
  // XL     25+ h  → 75×60×50 cm
  const parcel =
    hours < 3  ? { length: '20', width: '15', height: '10' } :
    hours < 10 ? { length: '35', width: '30', height: '25' } :
    hours < 25 ? { length: '55', width: '45', height: '35' } :
                 { length: '75', width: '60', height: '50' };

  // Build address_to — only include optional fields when non-empty.
  // Passing empty strings to Shippo triggers address-validation failures.
  const addressTo: Record<string, string> = {
    name:    shipping.fullName,
    street1: shipping.address1,
    city:    shipping.city,
    state:   shipping.state,
    zip:     shipping.zip,
    country: shipping.country || 'US',
    phone:   shipping.phone,
    email:   shipping.email,
  };
  if (shipping.company)  addressTo.company = shipping.company;
  if (shipping.address2) addressTo.street2  = shipping.address2;

  const addressFrom: Record<string, string> = {
    name:    'Karasawa Labs',
    company: 'Karasawa Labs',
    street1: process.env.SHIPPO_FROM_STREET || '123 Manufacturing Dr',
    city:    process.env.SHIPPO_FROM_CITY   || 'Austin',
    state:   process.env.SHIPPO_FROM_STATE  || 'TX',
    zip:     process.env.SHIPPO_FROM_ZIP    || '78701',
    country: 'US',
    phone:   process.env.SHIPPO_FROM_PHONE  || '+15121234567',
    email:   process.env.SHIPPO_FROM_EMAIL  || 'shipping@karasawalabs.com',
  };

  const shipmentRes = await fetch('https://api.goshippo.com/shipments/', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      address_from: addressFrom,
      address_to:   addressTo,
      parcels: [
        {
          length:        parcel.length,
          width:         parcel.width,
          height:        parcel.height,
          distance_unit: 'cm',
          weight:        weightKg,
          mass_unit:     'kg',
        },
      ],
      async: false,
    }),
  });

  if (!shipmentRes.ok) {
    const body = await shipmentRes.text().catch(() => '');
    throw new Error(`Shippo shipment failed (${shipmentRes.status}): ${body}`);
  }

  const shipment = await shipmentRes.json();
  const shipmentId: string = shipment.object_id;

  // Bail if destination address failed Shippo's own validation
  if (shipment.address_to?.validation_results?.is_valid === false) {
    console.warn('[Shippo] Destination address failed validation:', shipping.city, shipping.state);
    return { shipmentId };
  }

  const rates: { object_id: string; amount: string; provider: string }[] =
    shipment.rates ?? [];

  if (rates.length === 0) {
    console.warn('[Shippo] No rates returned for shipment', shipmentId);
    return { shipmentId };
  }

  // Enforce $25 minimum for shipping & handling.
  // Prefer the cheapest rate at or above $25; fall back to cheapest overall.
  const SHIPPING_MIN = 25;
  const qualifiedRates = rates.filter(r => parseFloat(r.amount) >= SHIPPING_MIN);
  const pool = qualifiedRates.length > 0 ? qualifiedRates : rates;
  const cheapest = pool.reduce((best, r) =>
    parseFloat(r.amount) < parseFloat(best.amount) ? r : best
  );

  // Purchase the label
  const txRes = await fetch('https://api.goshippo.com/transactions/', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      rate:            cheapest.object_id,
      label_file_type: 'PDF',
      async:           false,
    }),
  });

  if (!txRes.ok) {
    const body = await txRes.text().catch(() => '');
    console.warn('[Shippo] Label purchase failed:', body);
    return { shipmentId };
  }

  const tx = await txRes.json();

  if (tx.status !== 'SUCCESS') {
    console.warn('[Shippo] Transaction not SUCCESS:', tx.status, tx.messages);
    return { shipmentId };
  }

  return {
    shipmentId,
    trackingNumber: tx.tracking_number,
    trackingUrl:    tx.tracking_url_provider,
    carrier:        cheapest.provider,
  };
}
