export type OrderStatus =
  | "Submitted"
  | "Quoted"
  | "Approved"
  | "In Production"
  | "Shipped";

export type StatusHistory = {
  status: OrderStatus;
  date: string;
  notes: string;
};

export type Order = {
  id: string;
  partName: string;
  material: string;
  quantity: number;
  statusHistory: StatusHistory[];
};

export const orders: Order[] = [
  {
    id: "KHI-00128",
    partName: "Main Gearbox Housing",
    material: "Nylon (PA12)",
    quantity: 50,
    statusHistory: [
      {
        status: "Submitted",
        date: "2024-07-15",
        notes: "Initial quote request received.",
      },
      {
        status: "Quoted",
        date: "2024-07-16",
        notes: "Quote sent to customer.",
      },
      {
        status: "Approved",
        date: "2024-07-17",
        notes: "Customer approved quote and paid.",
      },
      {
        status: "In Production",
        date: "2024-07-18",
        notes: "Parts are now being printed.",
      },
      {
        status: "Shipped",
        date: "2024-07-22",
        notes: "Order shipped via Fedex. Tracking #123456789",
      },
    ],
  },
  {
    id: "KHI-00127",
    partName: "Enclosure v3 Prototype",
    material: "Standard Resin",
    quantity: 3,
    statusHistory: [
      {
        status: "Submitted",
        date: "2024-07-18",
        notes: "Initial quote request received.",
      },
      {
        status: "Quoted",
        date: "2024-07-18",
        notes: "Quote sent to customer.",
      },
      {
        status: "Approved",
        date: "2024-07-19",
        notes: "Customer approved quote and paid.",
      },
      {
        status: "In Production",
        date: "2024-07-20",
        notes: "Parts are now being printed.",
      },
    ],
  },
  {
    id: "KHI-00125",
    partName: "Mounting Bracket",
    material: "PETG",
    quantity: 200,
    statusHistory: [
      {
        status: "Submitted",
        date: "2024-07-20",
        notes: "Initial quote request received.",
      },
       {
        status: "Quoted",
        date: "2024-07-21",
        notes: "Quote sent to customer.",
      },
    ],
  },
];
