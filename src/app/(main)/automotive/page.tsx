'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { CheckCircle2, Car, AlertTriangle } from 'lucide-react';

const packages = [
  {
    id: 'digital-file',
    name: '3D Printed Car Body',
    subtitle: 'Digital File Package',
    price: '$500',
    includes: [
      'Segmented print-ready files',
      'Panel splits & alignment features',
      'BOM / spec sheet',
      'Assembly guide',
    ],
    provides: ['Your 3D model'],
    disclaimer: null,
    imageUrl:
      PlaceHolderImages.find((img) => img.id === 'digital-file-package')
        ?.imageUrl || '',
    imageHint: 'digital blueprint',
  },
  {
    id: 'disassembled-kit',
    name: '3D Printed Car Body',
    subtitle: 'Disassembled Kit',
    price: '$5,000 – $10,000+',
    includes: [
      'Printed body panels / monocoque segments',
      'Labeled parts list',
      'Assembly guide',
    ],
    provides: ['Your 3D model & configuration'],
    disclaimer:
      'Delivered as boxed parts. Assembly is required. Some modifications and post-processing may be necessary.',
    imageUrl:
      PlaceHolderImages.find((img) => img.id === 'disassembled-kit-package')
        ?.imageUrl || '',
    imageHint: 'car parts kit',
  },
  {
    id: 'assembled',
    name: '3D Printed Car Body',
    subtitle: 'Assembled',
    price: '$10,000 – $25,000+',
    includes: [
      'Assembled body / monocoque shell',
      'Bonding performed',
      'Alignment verified',
    ],
    provides: ['Your 3D model & configuration'],
    disclaimer:
      'Shell will still need reinforcement (fiberglass or carbon fiber) for rigidity and durability.',
    imageUrl:
      PlaceHolderImages.find((img) => img.id === 'assembled-package')
        ?.imageUrl || '',
    imageHint: 'car body shell',
  },
];

export default function AutomotivePage() {
  return (
    <div className="bg-secondary/50 min-h-screen">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-border/50">
        <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-accent/8 via-accent/[0.03] to-transparent pointer-events-none" />
        <div className="container py-14 md:py-20">
          <div className="text-center space-y-5 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent">
              <Car className="h-3.5 w-3.5" />
              Automotive Manufacturing
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Automotive{' '}
              <span className="text-accent">Packages</span>
            </h1>
            <p className="text-lg text-foreground/65 leading-relaxed">
              From digital files to a fully assembled shell — choose the package that fits your
              project needs and budget.
            </p>
          </div>
        </div>
      </div>

      <div className="container py-12 md:py-16">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className="group relative transform-gpu rounded-lg transition-transform duration-300 ease-in-out will-change-transform hover:scale-[1.02]"
            >
              {/* Glow effect */}
              <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-primary/70 via-accent/70 to-secondary/70 opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-100" />

              <Card className="relative flex h-full flex-col overflow-hidden transition-shadow duration-300 group-hover:shadow-2xl group-hover:shadow-accent/20">
                {/* Image */}
                <div className="relative aspect-video w-full overflow-hidden">
                  <Image
                    src={pkg.imageUrl}
                    alt={pkg.name}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    data-ai-hint={pkg.imageHint}
                  />
                  {/* Gradient fade into card */}
                  <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
                </div>

                <CardHeader className="pt-5 pb-2">
                  <p className="text-xs font-medium text-accent uppercase tracking-widest mb-0.5">
                    {pkg.subtitle}
                  </p>
                  <CardTitle className="text-xl leading-snug">{pkg.name}</CardTitle>
                  <p className="text-3xl font-bold text-accent pt-1">{pkg.price}</p>
                </CardHeader>

                <CardContent className="flex-grow space-y-5 pt-2">
                  <Separator />

                  <div>
                    <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-widest mb-3">
                      What you get
                    </h4>
                    <ul className="space-y-2">
                      {pkg.includes.map((item) => (
                        <li key={item} className="flex items-start gap-2.5 text-sm text-foreground/80">
                          <CheckCircle2 className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-widest mb-3">
                      What you provide
                    </h4>
                    <ul className="space-y-2">
                      {pkg.provides.map((item) => (
                        <li key={item} className="flex items-start gap-2.5 text-sm text-foreground/80">
                          <CheckCircle2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {pkg.disclaimer && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {pkg.disclaimer}
                    </div>
                  )}
                </CardContent>

                <CardFooter className="pt-2 pb-6">
                  <div className="flex w-full flex-col gap-2">
                    <Button
                      asChild
                      className="w-full"
                      style={{
                        backgroundColor: 'hsl(var(--accent))',
                        color: 'hsl(var(--accent-foreground))',
                      }}
                    >
                      <Link href={`/quote?package=${pkg.id}`}>Get a Quote</Link>
                    </Button>
                    <Button asChild className="w-full" variant="outline">
                      <Link href="/contact">Contact Us</Link>
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
