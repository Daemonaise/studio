import { verifyAndFulfillOrder } from "@/app/actions/checkout-actions";
import { CheckoutSuccessClient } from "./checkout-success-client";

interface Props {
  searchParams: Promise<{ session_id?: string }>;
}

export default async function CheckoutSuccessPage({ searchParams }: Props) {
  const { session_id } = await searchParams;

  const order = await verifyAndFulfillOrder(session_id || "");

  return <CheckoutSuccessClient order={order} />;
}
