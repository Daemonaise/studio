import type { Metadata } from "next";
import { cookies } from "next/headers";
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
      provider: "oauth",
      providerId: session.user.email,
    }).catch(() => {});
  }

  // Check both the NextAuth session name AND the cookie-based name override
  const cookieStore = await cookies();
  const cookieName = cookieStore.get("user_display_name")?.value;
  const effectiveName = cookieName || session.user.name;

  const needsName =
    !effectiveName ||
    effectiveName.trim() === "" ||
    effectiveName === session.user.email;

  if (needsName) {
    return <NameGate email={session.user.email ?? ""} />;
  }

  return <KarasliceClient />;
}
