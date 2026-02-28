
'use client';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  const features = [
    'Carbon-composite body panels',
    'Aerodynamic front splitters and rear diffusers',
    'Active aero wings and ducts',
    'Integrated cooling channels',
    'Lightweight structural sub-assemblies',
  ];

  return (
    <div className="flex flex-col">
      <section className="relative w-full bg-secondary/50">
        <div className="container grid lg:grid-cols-2 gap-12 items-center py-20 md:py-32">
          <div className="space-y-6 text-center lg:text-left">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              Build Hardware Faster
            </h1>
            <p className="max-w-2xl mx-auto lg:mx-0 text-lg text-foreground/80 md:text-xl">
              From rapid prototyping to full-scale production, we are your partner in building hardware faster. Use our AI Assistant for instant material advice, or get a full quote for your project.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <Button
                asChild
                size="lg"
                style={{
                  backgroundColor: 'hsl(var(--accent))',
                  color: 'hsl(var(--accent-foreground))',
                }}
              >
                <Link href="/quote">
                  Start Quote{' '}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-1 rounded-lg bg-gradient-to-br from-primary/50 via-accent/50 to-secondary/40 opacity-50 blur-xl"></div>
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

      <section className="w-full bg-background py-20 md:py-32">
        <div className="container grid lg:grid-cols-2 gap-12 xl:gap-20 items-center">
          <div className="space-y-6 lg:order-2">
            <div className="space-y-2">
              <p className="font-semibold text-accent">Engineered From First Principles</p>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Custom Hypercar Development
              </h2>
            </div>
            <p className="text-lg text-foreground/80">
              Karasawa develops modular hypercar body systems through advanced
              additive manufacturing and composite integration. This is not
              cosmetic aero; it's structural, load-bearing architecture for
              platforms pushing extreme power-to-weight ratios.
            </p>
            <ul className="space-y-2">
              {features.map((feature) => (
                <li key={feature} className="flex items-start">
                  <Check className="mt-1 h-5 w-5 flex-shrink-0 text-accent" />
                  <span className="ml-2 text-foreground/80">{feature}</span>
                </li>
              ))}
            </ul>
            <div className="pt-4">
              <h3 className="text-xl font-semibold tracking-tight">
                Digital Manufacturing → Physical Dominance
              </h3>
              <p className="mt-2 text-foreground/70">
                Our workflow combines parametric modeling, CFD analysis, and
                high-strength printed cores with composite reinforcement. This allows
                rapid iteration without traditional tooling. The result is aggressive
                geometry that remains functional—not ornamental. Every vent,
                channel, and surface has a purpose.
              </p>
            </div>
          </div>
          <div className="relative lg:order-1">
            <div className="absolute -inset-1 rounded-lg bg-gradient-to-br from-primary/50 via-accent/50 to-secondary/40 opacity-50 blur-xl"></div>
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
    </div>
  );
}
