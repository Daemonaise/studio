import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { KarasliceSalesPage } from "./karaslice-sales";

export const metadata: Metadata = {
  title: "Karaslice — Free 3D Mesh Repair & Slicer",
  description:
    "AI-powered mesh analysis, repair, reconstruction, and splitting. Defect overlays, cloud repair pipeline, feature-preserving reconstruction, and variant comparison — all free.",
};

export default async function KaraslicePage() {
  const session = await auth();

  // If already logged in, go straight to the app
  if (session?.user) {
    redirect("/karaslice/app");
  }

  return <KarasliceSalesPage />;
}
