"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Package,
  Truck,
  MapPin,
  ExternalLink,
  ArrowRight,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrderFulfillmentResult } from "@/app/actions/checkout-actions";

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

export function CheckoutSuccessClient({ order }: { order: OrderFulfillmentResult }) {
  // Persist order to localStorage for the portal.
  // Depend only on the stable identifiers — not the full object — to avoid
  // re-running on every parent re-render.
  const { success, orderNumber } = order;
  useEffect(() => {
    if (!success || !orderNumber) return;

    try {
      const stored: any[] = JSON.parse(localStorage.getItem("kl_orders") || "[]");
      if (stored.some((o) => o.orderNumber === orderNumber)) return;

      stored.unshift({
        orderNumber,
        date: new Date().toISOString(),
        material: order.material ?? "Unknown",
        jobScale: order.jobScale ?? "Part",
        amount: order.paymentAmount ?? 0,
        status: order.trackingNumber ? "Shipped" : "Processing",
        trackingNumber: order.trackingNumber ?? null,
        trackingUrl: order.trackingUrl ?? null,
        carrier: order.carrier ?? null,
        leadTimeMin: order.leadTimeMin ?? 3,
        leadTimeMax: order.leadTimeMax ?? 7,
        shipping: order.shipping,
      });
      localStorage.setItem("kl_orders", JSON.stringify(stored.slice(0, 50)));
    } catch {
      // localStorage unavailable (e.g. private browsing with storage blocked)
    }
  }, [success, orderNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order.success) {
    return (
      <div className="container py-20 flex flex-col items-center text-center gap-6">
        <div className="rounded-full bg-destructive/10 p-5">
          <XCircle className="h-12 w-12 text-destructive" />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Order Not Found</h1>
          <p className="text-muted-foreground max-w-md">
            {order.error ??
              "We couldn't verify your payment. Please contact support if you were charged."}
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild variant="outline">
            <Link href="/quote">Try Again</Link>
          </Button>
          <Button asChild>
            <Link href="/contact">Contact Support</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-accent/8 via-accent/3 to-transparent pointer-events-none" />

      <div className="container py-14 md:py-20 max-w-2xl">
        {/* Success header */}
        <div className="text-center space-y-4 mb-10">
          <div className="inline-flex items-center justify-center rounded-full bg-accent/10 border border-accent/30 p-5 mb-2">
            <CheckCircle2 className="h-12 w-12 text-accent" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Order Confirmed!</h1>
          <p className="text-muted-foreground text-lg">
            Your payment was received. We&apos;re getting your parts ready.
          </p>
          {order.orderNumber && (
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent font-mono">
              {order.orderNumber}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {/* Payment summary */}
          <Card className="teal-frame">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4 text-accent" />
                Order Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Material</span>
                <span className="font-medium">{order.material}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Job Scale</span>
                <span className="font-medium">{order.jobScale}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Lead Time</span>
                <span className="font-medium">
                  {order.leadTimeMin}–{order.leadTimeMax} business days
                </span>
              </div>
              <div className="flex justify-between border-t pt-2 mt-1">
                <span className="font-semibold">Amount Paid</span>
                <span className="font-bold text-accent text-base">
                  {order.paymentAmount != null ? formatCurrency(order.paymentAmount) : "—"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Tracking */}
          <Card className="teal-frame">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Truck className="h-4 w-4 text-accent" />
                Shipping & Tracking
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {order.trackingNumber ? (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Status</span>
                    <Badge className="bg-accent/10 text-accent border-accent/30">
                      Label Created
                    </Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Carrier</span>
                    <span className="font-medium">{order.carrier}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Tracking #</span>
                    <span className="font-mono font-medium">{order.trackingNumber}</span>
                  </div>
                  {order.trackingUrl && (
                    <Button asChild variant="outline" size="sm" className="w-full mt-1">
                      <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-2 h-3.5 w-3.5" />
                        Track Your Package
                      </a>
                    </Button>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Status</span>
                    <Badge variant="outline">Processing</Badge>
                  </div>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    A shipping label will be created when your print is complete. You&apos;ll
                    receive an email with tracking details.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Shipping address */}
          {order.shipping && (
            <Card className="teal-frame">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="h-4 w-4 text-accent" />
                  Delivering To
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground leading-relaxed">
                <p className="font-medium text-foreground">
                  {order.shipping.fullName}
                  {order.shipping.company ? ` · ${order.shipping.company}` : ""}
                </p>
                <p>{order.shipping.address1}</p>
                {order.shipping.address2 && <p>{order.shipping.address2}</p>}
                <p>
                  {order.shipping.city}, {order.shipping.state} {order.shipping.zip}
                </p>
                <p>{order.shipping.country}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 mt-8">
          <Button asChild variant="outline" className="flex-1">
            <Link href="/quote">Get Another Quote</Link>
          </Button>
          <Button
            asChild
            className="flex-1"
            style={{
              backgroundColor: "hsl(var(--accent))",
              color: "hsl(var(--accent-foreground))",
            }}
          >
            <Link href="/portal">
              View My Orders
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
