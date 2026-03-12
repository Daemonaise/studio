"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/icons";

export function SplashScreen() {
  const [phase, setPhase] = useState<"show" | "exit" | "done">("show");

  useEffect(() => {
    // Hand off from the blocking inline overlay to this animated version
    const staticEl = document.getElementById("kl-splash-init");
    if (staticEl) staticEl.remove();

    const exitTimer = setTimeout(() => setPhase("exit"), 2400);
    const doneTimer = setTimeout(() => setPhase("done"), 3100);
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  if (phase === "done") return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center transition-opacity duration-700 ${
        phase === "exit" ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      style={{ background: "hsl(240, 6%, 7%)" }}
    >
      {/* Grid background */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(hsl(183 91% 43% / 0.06) 1px, transparent 1px),
            linear-gradient(90deg, hsl(183 91% 43% / 0.06) 1px, transparent 1px)
          `,
          backgroundSize: "52px 52px",
        }}
      />

      {/* Radial vignette over grid */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 50%, transparent 0%, hsl(240, 6%, 7%) 100%)",
        }}
      />

      {/* Corner brackets */}
      <div className="absolute top-8 left-8 w-10 h-10 border-t-2 border-l-2 border-[hsl(183,91%,43%)] opacity-50" />
      <div className="absolute top-8 right-8 w-10 h-10 border-t-2 border-r-2 border-[hsl(183,91%,43%)] opacity-50" />
      <div className="absolute bottom-8 left-8 w-10 h-10 border-b-2 border-l-2 border-[hsl(183,91%,43%)] opacity-50" />
      <div className="absolute bottom-8 right-8 w-10 h-10 border-b-2 border-r-2 border-[hsl(183,91%,43%)] opacity-50" />

      {/* Horizontal scan line sweeping down */}
      <div className="kl-scan-h" />

      {/* Center content */}
      <div className="relative flex flex-col items-center gap-7 animate-in fade-in-0 zoom-in-95 duration-700">
        {/* Logo with teal glow */}
        <div
          style={{
            filter:
              "drop-shadow(0 0 20px hsl(183, 91%, 43%)) drop-shadow(0 0 48px hsl(183, 91%, 43% / 0.45))",
          }}
        >
          <Logo className="h-20 w-20 text-[hsl(183,91%,43%)]" />
        </div>

        {/* Brand name */}
        <div className="text-center space-y-2 animate-in fade-in-0 slide-in-from-bottom-2 duration-700 delay-300">
          <h1 className="text-3xl font-bold tracking-[0.4em] text-white uppercase">
            Karasawa
            <span className="text-[hsl(183,91%,43%)]"> Labs</span>
          </h1>
          <p
            className="text-[10px] tracking-[0.6em] uppercase font-mono"
            style={{ color: "hsl(183, 91%, 43%, 0.55)" }}
          >
            Precision Manufacturing
          </p>
        </div>

        {/* Progress bar */}
        <div
          className="mt-2 w-52 h-px relative overflow-hidden rounded-full animate-in fade-in-0 duration-500 delay-500"
          style={{ background: "hsl(183 91% 43% / 0.12)" }}
        >
          <div className="kl-scan-progress" />
        </div>

        {/* Status text */}
        <p
          className="text-[9px] tracking-[0.8em] uppercase font-mono animate-in fade-in-0 duration-500 delay-700"
          style={{ color: "hsl(0, 0%, 98%, 0.2)" }}
        >
          Initializing Systems
        </p>
      </div>
    </div>
  );
}
