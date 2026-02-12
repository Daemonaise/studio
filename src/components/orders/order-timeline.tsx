"use client";

import { CheckCircle, Circle, CircleDot, Truck } from "lucide-react";
import { Order, OrderStatus } from "@/app/data/orders";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const statusIcons: Record<OrderStatus, React.ReactNode> = {
  Submitted: <CircleDot className="h-5 w-5 text-blue-500" />,
  Quoted: <Circle className="h-5 w-5 text-gray-400" />,
  Approved: <CheckCircle className="h-5 w-5 text-green-500" />,
  "In Production": <Circle className="h-5 w-5 text-gray-400" />,
  Shipped: <Truck className="h-5 w-5 text-purple-500" />,
};

const statusConfig: {
  [key in OrderStatus]: {
    icon: React.ReactNode;
    color: string;
  };
} = {
    Submitted: { icon: <CircleDot />, color: "text-blue-500" },
    Quoted: { icon: <CircleDot />, color: "text-blue-500" },
    Approved: { icon: <CheckCircle />, color: "text-green-500" },
    'In Production': { icon: <CircleDot />, color: "text-orange-500" },
    Shipped: { icon: <Truck />, color: "text-purple-500" },
};

const allStatuses: OrderStatus[] = ["Submitted", "Quoted", "Approved", "In Production", "Shipped"];

export function OrderTimeline({ order }: { order: Order }) {
    const currentStatus = order.statusHistory[order.statusHistory.length - 1].status;
    const currentStatusIndex = allStatuses.indexOf(currentStatus);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order #{order.id}</CardTitle>
        <CardDescription>
          {order.quantity}x {order.partName} in {order.material}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative pl-8">
            {allStatuses.map((status, index) => {
                const statusDetail = order.statusHistory.find(h => h.status === status);
                const isCompleted = index <= currentStatusIndex;
                const isCurrent = index === currentStatusIndex;

                return (
                    <div key={status} className="flex items-start pb-8">
                        {index < allStatuses.length -1 && <div className={cn("absolute left-[15px] top-1 h-full w-0.5", isCompleted ? "bg-primary" : "bg-gray-200")}></div>}
                        <div className="flex items-center">
                            <div className={cn("z-10 flex h-8 w-8 items-center justify-center rounded-full", isCompleted ? "bg-primary text-primary-foreground" : "bg-gray-200 text-gray-600")}>
                                {statusConfig[status].icon}
                            </div>
                            <div className="ml-4">
                                <h4 className={cn("font-semibold", isCompleted ? "text-foreground" : "text-muted-foreground")}>{status}</h4>
                                {statusDetail && (
                                     <p className="text-sm text-muted-foreground">{statusDetail.notes}</p>
                                )}
                            </div>
                        </div>
                        {statusDetail && (
                            <div className="ml-auto text-right">
                                <p className="text-sm font-medium">{statusDetail.date}</p>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
      </CardContent>
    </Card>
  );
}
