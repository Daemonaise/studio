'use client';
import Link from 'next/link';
import { ArrowRight, Check, Wand2, Car, Layers, Upload, Settings2, PackageCheck, Zap, Ruler, Clock, Scissors, Cpu, Shield, Cloud, Wrench, Box, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';

const stats = [
  { icon: Layers, value: '8', label: 'Materials' },
  { icon: Ruler, value: '1 m³', label: 'Max build volume' },
  { icon: Clock, value: '3–7 days', label: 'Lead time' },
  { icon: Zap, value: 'AI', label: 'Instant quoting' },
];

const steps = [
  {
    icon: Upload,
    step: '01',
    title: 'Upload Your Model',
    desc: 'Drop an STL, OBJ, or 3MF file. We support single parts and multi-component archives.',
  },
  {
    icon: Settings2,
    step: '02',
    title: 'Configure & Quote',
    desc: 'Choose material, finish, and scale. Our AI engine returns an accurate price instantly.',
  },
  {
    icon: PackageCheck,
    step: '03',
    title: 'Print & Ship',
    desc: 'We manufacture and ship to your door. Track your order through the customer portal.',
  },
];

const tools = [
  {
    icon: Cpu,
    title: 'AI Mesh Analysis',
    desc: 'Gemini-powered damage classification with per-category quality scores. Identifies boundary loops, non-manifold edges, and corruption clusters — then prescribes exact repair parameters.',
  },
  {
    icon: Wrench,
    title: 'Topology Repair',
    desc: 'Client-side repair pipeline: exact vertex dedup, degenerate removal, BFS winding fix, outward normal correction, and ear-clip hole filling — all in-browser with variant comparison.',
  },
  {
    icon: Cloud,
    title: 'Deep Repair Pipeline',
    desc: '15-stage server-side pipeline with feature edge preservation, thin wall detection, Screened Poisson reconstruction, and live pipeline log console. For severely damaged meshes only.',
  },
  {
    icon: Scissors,
    title: 'Reconstruction Studio',
    desc: 'Three reconstruction modes (solid, shell, point cloud) with feature-preserving settings, symmetry recovery, and one-click variant generation for A/B comparison.',
  },
  {
    icon: Box,
    title: 'Shell Browser & Defect Inspector',
    desc: 'Connected component analysis with per-shell stats. Extended defect overlays: open edges, non-manifold, sliver triangles, and inverted normals — all color-coded in the viewport.',
  },
  {
    icon: Shield,
    title: 'Printability Analysis',
    desc: 'Overhang detection with adjustable threshold, wall thickness estimation, and printability scoring. Visualize overhang faces as a heat gradient directly on the mesh.',
  },
  {
    icon: Target,
    title: 'Hollowing & Escape Holes',
    desc: 'Create thin-walled shells via manifold boolean subtraction, add drainage holes for resin printing, and preview estimated material savings — all client-side.',
  },
  {
    icon: Layers,
    title: 'Support Preview & Printer Fit',
    desc: 'Visualize support columns from overhang analysis, check build volume fit against 40+ printer profiles, and get actionable warnings before you slice.',
  },
];

const hypercarFeatures = [
  'Carbon-composite body panels',
  'Aerodynamic splitters and diffusers',
  'Active aero wings and ducts',
  'Integrated cooling channels',
  'Lightweight structural sub-assemblies',
];

export default function HomePage() {
  return (
    <div className="flex flex-col">

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <section className="relative w-full overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/[0.06] via-transparent to-transparent pointer-events-none" />
        <div className="container grid lg:grid-cols-2 gap-8 lg:gap-14 items-center py-10 md:py-20">
          <div className="space-y-6 text-center lg:text-left animate-in fade-in-0 slide-in-from-bottom-4 duration-700">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent">
              <Wand2 className="h-3.5 w-3.5" />
              AI-Powered Manufacturing
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl leading-[1.1]">
              Build Hardware{' '}
              <span className="text-accent">Faster</span>
            </h1>
            <p className="max-w-xl mx-auto lg:mx-0 text-lg text-foreground/70 leading-relaxed">
              From rapid prototyping to production-grade parts — upload your
              model, get an AI-powered quote, and we handle the rest.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <Button
                asChild
                size="lg"
                style={{
                  backgroundColor: 'hsl(var(--accent))',
                  color: 'hsl(var(--accent-foreground))',
                }}
              >
                <Link href="/quote">
                  Start a Quote
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/materials">Browse Materials</Link>
              </Button>
            </div>
          </div>
          <div className="relative animate-in fade-in-0 slide-in-from-bottom-4 duration-700 delay-150">
            <div className="absolute -inset-2 rounded-xl bg-gradient-to-br from-accent/30 via-primary/20 to-secondary/20 opacity-60 blur-2xl" />
            <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-muted shadow-2xl shadow-accent/10 teal-frame">
              <video
                className="absolute top-0 left-0 w-full h-full object-cover"
                src="https://firebasestorage.googleapis.com/v0/b/studio-4705021877-a1dff.firebasestorage.app/o/Stock%20images%2FHero%20video.mp4?alt=media&token=15f35f34-1dae-4197-9fec-895a186ce9e9"
                autoPlay
                loop
                muted
                playsInline
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ─────────────────────────────────────────────────── */}
      <section className="w-full border-y border-border/50 bg-secondary/30">
        <div className="container py-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-0 md:divide-x divide-border/60">
            {stats.map(({ icon: Icon, value, label }) => (
              <div key={label} className="flex flex-col items-center gap-1.5 text-center md:px-8">
                <Icon className="h-4 w-4 text-accent" />
                <span className="text-2xl font-bold tracking-tight">{value}</span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────────────────── */}
      <section className="w-full py-12 md:py-20">
        <div className="container">
          <div className="text-center space-y-3 mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent">
              <Layers className="h-3.5 w-3.5" />
              Simple Process
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              From file to{' '}
              <span className="text-accent">doorstep</span>
            </h2>
            <p className="text-foreground/60 max-w-md mx-auto">
              Three steps. No back-and-forth. No tooling delays.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {steps.map(({ icon: Icon, step, title, desc }) => (
              <div key={step} className="group relative rounded-xl">
                <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-br from-accent/40 via-primary/30 to-secondary/20 opacity-0 blur-lg transition-opacity duration-300 group-hover:opacity-50" />
                <div className="relative rounded-xl border border-border/60 bg-card/60 p-6 h-full teal-frame">
                  <div className="flex items-start gap-4">
                    <div className="rounded-lg bg-accent/10 border border-accent/20 p-2.5 shrink-0">
                      <Icon className="h-5 w-5 text-accent" />
                    </div>
                    <span className="text-4xl font-bold text-accent/15 leading-none mt-0.5 font-mono">
                      {step}
                    </span>
                  </div>
                  <h3 className="font-semibold mt-4 mb-2">{title}</h3>
                  <p className="text-sm text-foreground/60 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Button
              asChild
              style={{
                backgroundColor: 'hsl(var(--accent))',
                color: 'hsl(var(--accent-foreground))',
              }}
            >
              <Link href="/quote">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── KARASLICE TOOLS ───────────────────────────────────────────── */}
      <section className="w-full border-y border-border/50 bg-secondary/30 py-12 md:py-20">
        <div className="container">
          <div className="text-center space-y-3 mb-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent">
              <Scissors className="h-3.5 w-3.5" />
              Free Tools
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Karaslice{' '}
              <span className="text-accent">Repair Workbench</span>
            </h2>
            <p className="text-foreground/60 max-w-lg mx-auto">
              AI-powered mesh analysis, defect overlays, deep repair pipeline, feature-preserving
              reconstruction with variant comparison, and symmetry recovery — free, in your browser.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
            {tools.map(({ icon: Icon, title, desc }) => (
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

          <div className="text-center">
            <Button
              asChild
              size="lg"
              style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}
            >
              <Link href="/karaslice">
                Open Karaslice
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── HYPERCAR ──────────────────────────────────────────────────── */}
      <section className="w-full py-12 md:py-20">
        <div className="container grid lg:grid-cols-2 gap-10 xl:gap-16 items-center">
          <div className="space-y-6 lg:order-2">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent">
                <Car className="h-3.5 w-3.5" />
                Automotive Division
              </div>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Custom Hypercar{' '}
                <span className="text-accent">Development</span>
              </h2>
            </div>
            <p className="text-foreground/70 leading-relaxed">
              Modular hypercar body systems through additive manufacturing and
              composite integration. Structural, load-bearing architecture for
              platforms pushing extreme power-to-weight ratios.
            </p>
            <ul className="space-y-2.5">
              {hypercarFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span className="text-foreground/70 text-sm">{feature}</span>
                </li>
              ))}
            </ul>
            <Button
              asChild
              style={{
                backgroundColor: 'hsl(var(--accent))',
                color: 'hsl(var(--accent-foreground))',
              }}
            >
              <Link href="/automotive">
                View Packages
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
          <div className="relative lg:order-1">
            <div className="absolute -inset-2 rounded-xl bg-gradient-to-br from-accent/30 via-primary/20 to-secondary/20 opacity-50 blur-2xl" />
            <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-muted shadow-2xl shadow-accent/10 teal-frame">
              <video
                className="absolute top-0 left-0 w-full h-full object-cover"
                src="https://firebasestorage.googleapis.com/v0/b/studio-4705021877-a1dff.firebasestorage.app/o/Stock%20images%2F20fd23dec958480baafbcb5e2e7dc22b.mov?alt=media&token=bd957dbc-d6f1-45da-a912-db18186bed35"
                autoPlay
                loop
                muted
                playsInline
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────── */}
      <section className="w-full border-t border-border/50 bg-secondary/30 py-10 md:py-16">
        <div className="container">
          <div className="relative rounded-2xl border border-accent/20 bg-accent/5 px-8 py-10 text-center overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/20 to-transparent" />
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-3">
              Ready to{' '}
              <span className="text-accent">build</span>?
            </h2>
            <p className="text-foreground/60 max-w-lg mx-auto mb-8 text-sm leading-relaxed">
              Upload your 3D model, pick a material, and get an accurate
              AI-powered quote in seconds.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                asChild
                size="lg"
                style={{
                  backgroundColor: 'hsl(var(--accent))',
                  color: 'hsl(var(--accent-foreground))',
                }}
              >
                <Link href="/quote">
                  <Wand2 className="mr-2 h-4 w-4" />
                  Start a Quote
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/assistant">Talk to AI Assistant</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
