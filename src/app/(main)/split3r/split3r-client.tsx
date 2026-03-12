"use client";

import dynamic from "next/dynamic";

const Split3rApp = dynamic(
  () => import("@/components/split3r/split3r-app").then((m) => m.Split3rApp),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground text-sm">
        Loading Split3r…
      </div>
    ),
  }
);

export function Split3rClient() {
  return <Split3rApp />;
}
