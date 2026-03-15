"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";
import {
  ArrowRight, Check, Cpu, Scissors, Shield, Cloud, Wrench, Box,
  Sparkles, Eye, Layers, Zap, FlipVertical, BarChart3, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  {
    icon: Sparkles,
    title: "AI Mesh Analysis",
    desc: "Gemini-powered damage classification with confidence scoring. Identifies boundary loops, non-manifold edges, corruption clusters, and prescribes exact repair parameters.",
  },
  {
    icon: Wrench,
    title: "Topology Repair",
    desc: "Client-side pipeline: vertex dedup, degenerate removal, BFS winding fix, normal correction, and ear-clip hole filling. Instant results, no server needed.",
  },
  {
    icon: Cloud,
    title: "Deep Repair Pipeline",
    desc: "15-stage server-side pipeline with feature edge preservation, thin wall detection, Screened Poisson reconstruction, and 4-method boolean fallback chain. For severely damaged meshes.",
  },
  {
    icon: Eye,
    title: "Defect Overlays",
    desc: "Real-time visualization of open edges (red) and non-manifold edges (orange) directly in the viewport. Toggle individual defect types on/off.",
  },
  {
    icon: Layers,
    title: "Variant Comparison",
    desc: "Generate multiple repair variants with different parameters. Compare side-by-side metrics — triangle count, resolution, quality score — and pick the best result.",
  },
  {
    icon: FlipVertical,
    title: "Symmetry Recovery",
    desc: "Mirror damaged meshes across any axis to reconstruct missing geometry from the intact side. Perfect for scanned objects with partial data.",
  },
  {
    icon: Scissors,
    title: "Mesh Splitting",
    desc: "Split oversized parts along configurable cut planes using manifold-3d booleans. Auto-calculates cuts from your printer bed dimensions.",
  },
  {
    icon: BarChart3,
    title: "Quality Breakdown",
    desc: "Per-category quality scores: topology, watertight integrity, normals, and geometry. Know exactly what needs fixing before committing to repair.",
  },
  {
    icon: Cpu,
    title: "3 Reconstruction Modes",
    desc: "Solid voxel, shell voxel, and point cloud (MLS/SDF). Feature-preserving modes for organic or mechanical parts. Auto-retry with AI parameter adjustment.",
  },
  {
    icon: Box,
    title: "PBR Viewport",
    desc: "Physically-based Three.js rendering with ACES tone mapping, ghost mode, wireframe, explode view, and real-time unit conversion across mm/cm/in.",
  },
  {
    icon: Shield,
    title: "Export & Quote",
    desc: "Export repaired or split parts as STL, OBJ, or ZIP. Send parts directly to the AI quote wizard — no re-upload needed.",
  },
  {
    icon: Zap,
    title: "Pipeline Console",
    desc: "Live timestamped pipeline log with color-coded status indicators. Watch every repair step in real-time from the bottom drawer.",
  },
];

const providers = [
  {
    id: "google",
    label: "Google",
    bg: "#4285F4",
    fg: "#fff",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
      </svg>
    ),
  },
  {
    id: "apple",
    label: "Apple",
    bg: "#000",
    fg: "#fff",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
      </svg>
    ),
  },
] as const;

export function KarasliceSalesPage() {
  const [loading, setLoading] = useState<string | null>(null);

  const handleSignIn = (providerId: string) => {
    setLoading(providerId);
    signIn(providerId, { callbackUrl: "/karaslice/app" });
  };

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">

      {/* ── Nav ──────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="container flex h-14 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Scissors className="h-5 w-5 text-accent" />
            <span className="font-bold tracking-tight">Karaslice</span>
          </Link>
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleSignIn("google")}
              disabled={loading !== null}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Sign In
            </Button>
            <Button
              size="sm"
              style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}
              onClick={() => handleSignIn("google")}
              disabled={loading !== null}
            >
              Get Started Free
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative w-full overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/[0.06] via-transparent to-transparent pointer-events-none" />
        <div className="container max-w-4xl text-center py-16 md:py-28 space-y-8 animate-in fade-in-0 slide-in-from-bottom-4 duration-700">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent">
            <Sparkles className="h-3.5 w-3.5" />
            Free 3D Mesh Tools
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl leading-[1.1]">
            Repair, Reconstruct &{" "}
            <span className="text-accent">Split</span>{" "}
            3D Meshes
          </h1>
          <p className="max-w-2xl mx-auto text-lg text-foreground/70 leading-relaxed">
            AI-powered mesh analysis, deep repair pipeline, defect visualization,
            feature-preserving reconstruction, and variant comparison — all in your browser. Free forever.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              size="lg"
              style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}
              onClick={() => handleSignIn("google")}
              disabled={loading !== null}
            >
              {loading === "google" ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Scissors className="h-5 w-5 mr-2" />}
              Open Karaslice — Free
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Sign in with Google or Apple to get started. No credit card required.
          </p>
        </div>
      </section>

      {/* ── Features Grid ────────────────────────────────────────────── */}
      <section className="w-full border-y border-border/50 bg-secondary/30 py-16 md:py-24">
        <div className="container">
          <div className="text-center space-y-3 mb-14">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything You Need to{" "}
              <span className="text-accent">Fix</span>{" "}
              3D Models
            </h2>
            <p className="text-foreground/60 max-w-lg mx-auto">
              From quick topology repair to full cloud-powered reconstruction — Karaslice handles meshes that other tools can&apos;t.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="group relative rounded-xl">
                <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-br from-accent/40 via-primary/30 to-secondary/20 opacity-0 blur-lg transition-opacity duration-300 group-hover:opacity-50" />
                <div className="relative rounded-xl border border-border/60 bg-card/80 p-6 h-full">
                  <div className="rounded-lg bg-accent/10 border border-accent/20 p-2.5 w-fit mb-4">
                    <Icon className="h-5 w-5 text-accent" />
                  </div>
                  <h3 className="font-semibold mb-2">{title}</h3>
                  <p className="text-sm text-foreground/60 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────────────────────── */}
      <section className="w-full py-16 md:py-24">
        <div className="container max-w-4xl">
          <div className="text-center space-y-3 mb-14">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Three Steps to a{" "}
              <span className="text-accent">Perfect</span>{" "}
              Mesh
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: "01", title: "Upload", desc: "Drop any STL, OBJ, or 3MF file. The viewport loads instantly with PBR rendering." },
              { step: "02", title: "Analyze & Repair", desc: "AI classifies your mesh and recommends the best repair path. One-click fixes run in-browser or on the cloud." },
              { step: "03", title: "Export or Quote", desc: "Download repaired files as STL/OBJ/ZIP, or send parts directly to our AI quoting engine." },
            ].map(({ step, title, desc }) => (
              <div key={step} className="text-center space-y-3">
                <span className="text-5xl font-bold text-accent/15 font-mono">{step}</span>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="text-sm text-foreground/60">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Comparison ───────────────────────────────────────────────── */}
      <section className="w-full border-y border-border/50 bg-secondary/30 py-16 md:py-24">
        <div className="container max-w-4xl">
          <div className="text-center space-y-3 mb-14">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Why <span className="text-accent">Karaslice</span>?
            </h2>
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Feature</th>
                  <th className="py-3 px-4 font-medium text-accent">Karaslice</th>
                  <th className="py-3 px-4 font-medium text-muted-foreground">Others</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  ["AI Mesh Analysis", true, false],
                  ["Deep Repair Pipeline", true, false],
                  ["Defect Edge Overlays", true, true],
                  ["3 Reconstruction Modes", true, false],
                  ["Feature-Preserving Repair", true, true],
                  ["Variant Comparison", true, false],
                  ["Symmetry Recovery", true, false],
                  ["Free to Use", true, false],
                ].map(([feature, us, them]) => (
                  <tr key={feature as string}>
                    <td className="py-2.5 px-4 text-foreground/80">{feature as string}</td>
                    <td className="py-2.5 px-4 text-center">
                      {us ? <Check className="h-4 w-4 text-green-400 mx-auto" /> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      {them ? <Check className="h-4 w-4 text-muted-foreground mx-auto" /> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────── */}
      <section className="w-full py-16 md:py-24">
        <div className="container max-w-2xl">
          <div className="relative rounded-2xl border border-accent/20 bg-accent/5 px-8 py-12 text-center overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/20 to-transparent" />
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-4">
              Ready to Fix Your{" "}
              <span className="text-accent">Mesh</span>?
            </h2>
            <p className="text-foreground/60 max-w-lg mx-auto mb-8 text-sm leading-relaxed">
              Create a free account and start repairing 3D models in seconds.
              No downloads, no installs, no credit card.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-sm mx-auto">
              {providers.map((provider) => (
                <Button
                  key={provider.id}
                  className="flex-1 gap-2 h-11"
                  style={{ backgroundColor: provider.bg, color: provider.fg }}
                  disabled={loading !== null}
                  onClick={() => handleSignIn(provider.id)}
                >
                  {loading === provider.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    provider.icon
                  )}
                  {provider.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="border-t border-border/50 py-6">
        <div className="container flex items-center justify-between text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">
            Karasawa Labs
          </Link>
          <span>Free 3D mesh tools</span>
        </div>
      </footer>
    </div>
  );
}
