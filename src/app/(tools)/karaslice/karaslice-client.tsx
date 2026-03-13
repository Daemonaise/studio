"use client";

import dynamic from "next/dynamic";

const KarasliceApp = dynamic(
  () => import("@/components/karaslice/karaslice-app").then((m) => m.KarasliceApp),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground text-sm">
        Loading Karaslice…
      </div>
    ),
  }
);

export function KarasliceClient() {
  return <KarasliceApp />;
}
