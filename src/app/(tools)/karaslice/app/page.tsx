import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { KarasliceClient } from "../karaslice-client";
import { NameGate } from "../name-gate";
import { recordLoginAndCheckDuplicates } from "@/app/actions/account-actions";

export const metadata: Metadata = {
  title: "Karaslice — 3D Model Slicer",
  description:
    "Browser-based 3D model splitter. Upload oversized STL/OBJ files, configure cut planes, and export print-ready split parts.",
};

export default async function KarasliceAppPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/karaslice");
  }

  // Record login and check for duplicate accounts (fire-and-forget)
  if (session.user.email) {
    recordLoginAndCheckDuplicates({
      email: session.user.email,
      name: session.user.name ?? null,
      provider: "oauth", // generic — exact provider not available in session
      providerId: session.user.email,
    }).catch(() => {});
  }

  // If user has no name or name equals their email, force them to set a name
  const needsName =
    !session.user.name ||
    session.user.name.trim() === "" ||
    session.user.name === session.user.email;

  if (needsName) {
    return <NameGate email={session.user.email ?? ""} />;
  }

  return <KarasliceClient />;
}
