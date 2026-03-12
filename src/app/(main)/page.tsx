'use client';
import Link from 'next/link';
import { ArrowRight, Check, Wand2, Car, Layers, Upload, Settings2, PackageCheck, Zap, Ruler, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';

const steps = [
  {
    icon: Upload,
    step: '01',
    title: 'Upload Your Model',
    desc: 'Drop an STL, OBJ, or 3MF file into the quote wizard. We support single parts and ZIP archives with multiple components.',
  },
  {
    icon: Settings2,
    step: '02',
    title: 'Configure & Quote',
    desc: 'Choose your material, finish level, and scale. Our AI engine returns an accurate price and lead time estimate instantly.',
  },
  {
    icon: PackageCheck,
    step: '03',
    title: 'Print & Ship',
    desc: 'We manufacture your parts and ship directly to your door. Track your order in real time through the customer portal.',
  },
];

const stats = [
  { icon: Ruler, value: '1 m³', label: 'Max build volume' },
  { icon: Layers, value: '50+', label: 'Materials available' },
  { icon: Clock, value: '3–7', label: 'Day lead time' },
  { icon: Zap, value: 'AI', label: 'Instant quoting' },
];

const features = [
  'Carbon-composite body panels',
  'Aerodynamic front splitters and rear diffusers',
  'Active aero wings and ducts',
  'Integrated cooling channels',
  'Lightweight structural sub-assemblies',
];

export default function HomePage() {
  return (
    <div className="flex flex-col">
      {/* Hero */}
      <section className="relative w-full overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-accent/[0.08] via-accent/[0.03] to-transparent pointer-events-none" />
        <div className="container grid lg:grid-cols-2 gap-8 lg:gap-12 items-center py-8 md:py-14">
          <div className="space-y-5 text-center lg:text-left animate-in fade-in-0 slide-in-from-bottom-4 duration-700">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent">
              <Wand2 className="h-3.5 w-3.5" />
              AI-Powered Manufacturing
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              Build Hardware{' '}
              <span className="text-accent">Faster</span>
            </h1>
            <p className="max-w-2xl mx-auto lg:mx-0 text-lg text-foreground/75">
              From rapid prototyping to full-scale production — get an instant
              AI-powered quote, pick your material, and we handle the rest.
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
                  Start Quote
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/materials">Browse Materials</Link>
              </Button>
            </div>
          </div>
          <div className="relative animate-in fade-in-0 slide-in-from-bottom-4 duration-700 delay-150">
            <div className="absolute -inset-1 rounded-lg bg-gradient-to-br from-primary/50 via-accent/50 to-secondary/40 opacity-50 blur-xl" />
            <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-muted shadow-2xl shadow-primary/20 teal-frame">
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

      {/* Stats bar */}
      <section className="w-full border-y border-border/50 bg-secondary/30">
        <div className="container py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-0 md:divide-x divide-border/60">
            {stats.map(({ icon: Icon, value, label }) => (
              <div key={label} className="flex flex-col items-center gap-1 text-center md:px-8">
                <Icon className="h-4 w-4 text-accent mb-0.5" />
                <span className="text-2xl font-bold tracking-tight">{value}</span>
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="w-full py-10 md:py-14">
        <div className="container">
          <div className="text-center space-y-3 mb-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent">
              <Layers className="h-3.5 w-3.5" />
              Simple Process
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              From file to{' '}
              <span className="text-accent">doorstep</span>
            </h2>
            <p className="text-foreground/65 max-w-lg mx-auto">
              Three steps. No back-and-forth. No tooling delays.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {steps.map(({ icon: Icon, step, title, desc }) => (
              <div key={step} className="group relative rounded-lg">
                <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-primary/60 via-accent/60 to-secondary/40 opacity-0 blur-lg transition-opacity duration-300 group-hover:opacity-40" />
                <div className="relative rounded-lg border border-border/60 bg-card/60 p-6 h-full teal-frame">
                  <div className="flex items-start gap-4">
                    <div className="rounded-lg bg-accent/10 border border-accent/20 p-2.5 shrink-0">
                      <Icon className="h-5 w-5 text-accent" />
                    </div>
                    <span className="text-4xl font-bold text-accent/15 leading-none mt-0.5 font-mono">
                      {step}
                    </span>
                  </div>
                  <h3 className="font-semibold mt-4 mb-2">{title}</h3>
                  <p className="text-sm text-foreground/65 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Button
              asChild
              style={{
                backgroundColor: 'hsl(var(--accent))',
                color: 'hsl(var(--accent-foreground))',
              }}
            >
              <Link href="/quote">
                Get Started Now
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Hypercar section */}
      <section className="w-full bg-secondary/40 border-y border-border/50 py-10 md:py-14">
        <div className="container grid lg:grid-cols-2 gap-8 xl:gap-16 items-center">
          <div className="space-y-5 lg:order-2">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent">
                <Car className="h-3.5 w-3.5" />
                Engineered From First Principles
              </div>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Custom Hypercar{' '}
                <span className="text-accent">Development</span>
              </h2>
            </div>
            <p className="text-foreground/75">
              Karasawa develops modular hypercar body systems through advanced
              additive manufacturing and composite integration. This is not
              cosmetic aero — it's structural, load-bearing architecture for
              platforms pushing extreme power-to-weight ratios.
            </p>
            <ul className="space-y-2">
              {features.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                  <span className="text-foreground/75 text-sm">{feature}</span>
                </li>
              ))}
            </ul>
            <div className="rounded-lg border border-accent/20 bg-accent/5 px-5 py-4 space-y-1.5">
              <h3 className="text-sm font-semibold tracking-tight">
                Digital Manufacturing → Physical Dominance
              </h3>
              <p className="text-sm text-foreground/65 leading-relaxed">
                Parametric modeling, CFD analysis, and high-strength printed
                cores with composite reinforcement. Rapid iteration without
                traditional tooling.
              </p>
            </div>
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
            <div className="absolute -inset-1 rounded-lg bg-gradient-to-br from-primary/50 via-accent/50 to-secondary/40 opacity-50 blur-xl" />
            <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-muted shadow-2xl shadow-primary/20 teal-frame">
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

      {/* CTA strip */}
      <section className="w-full bg-background py-8 md:py-12">
        <div className="container">
          <div className="relative rounded-2xl border border-accent/20 bg-accent/5 px-8 py-8 text-center overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/20 to-transparent" />
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent mb-4">
              <Layers className="h-3.5 w-3.5" />
              Ready to build?
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-3">
              Get an instant quote{' '}
              <span className="text-accent">in seconds</span>
            </h2>
            <p className="text-foreground/65 max-w-xl mx-auto mb-7 text-sm">
              Upload your 3D model, pick a material, and our AI returns an
              accurate price estimate and lead time — no back-and-forth required.
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
