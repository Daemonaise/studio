"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Package,
  Truck,
  CheckCircle2,
  Clock,
  ExternalLink,
  Plus,
  User,
  LayoutDashboard,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Order {
  orderNumber: string;
  date: string;
  material: string;
  jobScale: string;
  amount: number;
  status: "Processing" | "Shipped" | "Delivered";
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  carrier?: string | null;
  leadTimeMin: number;
  leadTimeMax: number;
  shipping?: {
    fullName: string;
    address1: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
}

interface Customer {
  name?: string;
  email?: string;
  company?: string;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const STATUS_CONFIG: Record<
  Order["status"],
  { label: string; icon: React.ElementType; className: string }
> = {
  Processing: {
    label: "Processing",
    icon: Clock,
    className: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  },
  Shipped: {
    label: "Shipped",
    icon: Truck,
    className: "bg-accent/10 text-accent border-accent/30",
  },
  Delivered: {
    label: "Delivered",
    icon: CheckCircle2,
    className: "bg-green-500/10 text-green-500 border-green-500/30",
  },
};

function safeParseJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function OrderCard({ order }: { order: Order }) {
  const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.Processing;
  const StatusIcon = cfg.icon;

  return (
    <div className="group relative rounded-lg">
      <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-primary/40 via-accent/40 to-secondary/40 opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-60" />
      <Card className="relative teal-frame transition-shadow duration-200 group-hover:shadow-lg">
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="space-y-1 flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-semibold text-accent">
                  {order.orderNumber}
                </span>
                <Badge variant="outline" className={cfg.className}>
                  <StatusIcon className="mr-1 h-3 w-3" />
                  {cfg.label}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {order.material} · {order.jobScale} · {formatDate(order.date)}
              </p>
              {order.shipping && (
                <p className="text-xs text-muted-foreground/70 truncate">
                  Shipping to: {order.shipping.city}, {order.shipping.state}{" "}
                  {order.shipping.zip}
                </p>
              )}
            </div>

            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              <span className="text-lg font-bold text-accent">
                {formatCurrency(order.amount)}
              </span>
              <span className="text-xs text-muted-foreground">
                {order.leadTimeMin}–{order.leadTimeMax} day lead time
              </span>
            </div>
          </div>

          {order.trackingNumber && (
            <div className="mt-4 rounded-md bg-muted/40 border px-3 py-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Truck className="h-3.5 w-3.5 text-accent flex-shrink-0" />
                <span className="text-xs text-muted-foreground">{order.carrier}</span>
                <span className="font-mono text-xs font-medium truncate">
                  {order.trackingNumber}
                </span>
              </div>
              {order.trackingUrl && (
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-accent hover:text-accent flex-shrink-0"
                >
                  <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer">
                    Track
                    <ExternalLink className="ml-1 h-3 w-3" />
                  </a>
                </Button>
              )}
            </div>
          )}

          {order.status === "Processing" && !order.trackingNumber && (
            <div className="mt-4 rounded-md bg-muted/30 border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Tracking info will appear here once your order ships.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function PortalPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);

  useEffect(() => {
    setOrders(safeParseJSON<Order[]>("kl_orders", []));
    setCustomer(safeParseJSON<Customer | null>("kl_customer", null));
  }, []);

  const stats = useMemo(
    () => ({
      total: orders.length,
      active: orders.filter((o) => o.status !== "Delivered").length,
      shipped: orders.filter((o) => o.status === "Shipped").length,
      spent: orders.reduce((sum, o) => sum + o.amount, 0),
    }),
    [orders]
  );

  const accentBtn = {
    backgroundColor: "hsl(var(--accent))",
    color: "hsl(var(--accent-foreground))",
  };

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-accent/5 via-accent/[0.02] to-transparent pointer-events-none" />

      <div className="container py-10 md:py-16 space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <LayoutDashboard className="h-5 w-5 text-accent" />
              <h1 className="text-2xl font-bold tracking-tight">Customer Portal</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {customer?.name
                ? `Welcome back, ${customer.name}`
                : "Track your orders and manage shipments"}
            </p>
          </div>
          <Button asChild style={accentBtn}>
            <Link href="/quote">
              <Plus className="mr-2 h-4 w-4" />
              New Quote
            </Link>
          </Button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {(
            [
              { label: "Total Orders", value: stats.total, icon: Package, fmt: String },
              { label: "Active Orders", value: stats.active, icon: Clock, fmt: String },
              { label: "In Transit", value: stats.shipped, icon: Truck, fmt: String },
              { label: "Total Spent", value: stats.spent, icon: CheckCircle2, fmt: formatCurrency },
            ] as const
          ).map(({ label, value, icon: Icon, fmt }) => (
            <div key={label} className="group relative rounded-lg">
              <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-accent/30 to-primary/20 opacity-0 blur-lg transition-opacity duration-300 group-hover:opacity-60" />
              <Card className="relative teal-frame text-center p-4">
                <Icon className="h-4 w-4 text-accent mx-auto mb-1.5" />
                <p className="text-2xl font-bold text-accent">{fmt(value as never)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </Card>
            </div>
          ))}
        </div>

        {/* Orders */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Order History</h2>
            {orders.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {orders.length} order{orders.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {orders.length === 0 ? (
            <div className="group relative rounded-lg">
              <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-accent/20 to-primary/10 opacity-20 blur-xl" />
              <Card className="relative teal-frame">
                <CardContent className="flex flex-col items-center justify-center text-center py-16 space-y-4">
                  <div className="rounded-full bg-accent/10 border border-accent/20 p-5">
                    <Package className="h-10 w-10 text-accent/50" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-semibold text-lg">No orders yet</h3>
                    <p className="text-sm text-muted-foreground max-w-xs">
                      Upload a 3D model and get an instant quote to place your first order.
                    </p>
                  </div>
                  <Button asChild style={accentBtn}>
                    <Link href="/quote">
                      Get Your First Quote
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <OrderCard key={order.orderNumber} order={order} />
              ))}
            </div>
          )}
        </div>

        {/* Profile */}
        {customer && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Account</h2>
            <div className="group relative rounded-lg">
              <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-accent/20 to-primary/10 opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-60" />
              <Card className="relative teal-frame">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <User className="h-4 w-4 text-accent" />
                    Profile
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {customer.name && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Name</span>
                      <span className="font-medium">{customer.name}</span>
                    </div>
                  )}
                  {customer.email && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Email</span>
                      <span className="font-medium">{customer.email}</span>
                    </div>
                  )}
                  {customer.company && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Company</span>
                      <span className="font-medium">{customer.company}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
