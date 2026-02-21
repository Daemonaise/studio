'use client';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <div className="flex flex-col">
      <section className="relative w-full bg-secondary/50">
        <div className="container grid lg:grid-cols-2 gap-12 items-center py-20 md:py-32">
          <div className="space-y-6 text-center lg:text-left">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              Build Hardware Faster
            </h1>
            <p className="max-w-2xl mx-auto lg:mx-0 text-lg text-foreground/80 md:text-xl">
              Use our AI Assistant for instant material advice, or get a full
              quote for your project.
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
                  Start Automotive Quote{' '}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-1 rounded-lg bg-gradient-to-br from-primary/70 via-accent/70 to-secondary/70 opacity-60 blur-xl"></div>
            <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-muted shadow-2xl shadow-primary/20">
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
    </div>
  );
}
