import { orders } from "@/app/data/orders";
import { OrderTimeline } from "@/components/orders/order-timeline";

export default function OrdersPage() {
  return (
    <div className="bg-secondary/50">
      <div className="container py-12 md:py-20">
        <div className="text-center space-y-4 mb-12">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Order Status
          </h1>
          <p className="max-w-3xl mx-auto text-lg text-foreground/70">
            Track the progress of your manufacturing orders from submission to shipment.
          </p>
        </div>
        
        <div className="max-w-4xl mx-auto space-y-8">
            {orders.map(order => (
                <OrderTimeline key={order.id} order={order} />
            ))}
        </div>
      </div>
    </div>
  );
}
