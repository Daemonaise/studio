"use client";

import dynamic from "next/dynamic";

const SplashScreen = dynamic(
  () => import("./splash-screen").then((m) => m.SplashScreen),
  { ssr: false }
);

const PageTransition = dynamic(
  () => import("./page-transition").then((m) => m.PageTransition),
  { ssr: false }
);

export function ClientOverlays() {
  return (
    <>
      <SplashScreen />
      <PageTransition />
    </>
  );
}
