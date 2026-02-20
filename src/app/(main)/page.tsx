
'use client';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PlaceHolderImages } from '@/lib/placeholder-images';

const packages = [
  {
    id: 'digital-file',
    name: '3D Printed Car Body – Digital File Package',
    price: '$500',
    includes: [
      'Segmented print-ready files',
      'Panel splits & alignment features',
      'BOM/spec sheet',
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
    name: '3D Printed Car Body – Disassembled Kit',
    price: '$5,000 - $15,000',
    includes: [
      'Printed body panels/monocoque segments',
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
    name: '3D Printed Car Body – Assembled',
    price: '$10,000 - $25,000+',
    includes: [
      'Assembled body/monocoque shell',
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
          <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-muted flex items-center justify-center">
            <div className="text-center text-muted-foreground">
                <PlayCircle className="h-20 w-20 mx-auto" />
                <p className="mt-4 font-medium">Video coming soon</p>
            </div>
          </div>
        </div>
      </section>

      <section id="packages" className="py-20 md:py-32">
        <div className="container">
          <div className="text-center space-y-4 mb-12">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Choose Your Package
            </h2>
            <p className="max-w-3xl mx-auto text-lg text-foreground/70">
              Select the package that best fits your project needs and budget.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {packages.map((pkg) => (
              <Card key={pkg.id} className="flex flex-col">
                <CardHeader>
                  <div className="relative aspect-video w-full rounded-md overflow-hidden mb-4">
                    <Image
                      src={pkg.imageUrl}
                      alt={pkg.name}
                      fill
                      className="object-cover"
                      data-ai-hint={pkg.imageHint}
                    />
                  </div>
                  <CardTitle>{pkg.name}</CardTitle>
                  <p className="text-2xl font-bold">{pkg.price}</p>
                  {pkg.disclaimer && (
                    <CardDescription className="text-amber-600 dark:text-amber-500 text-xs py-2">
                      {pkg.disclaimer}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="flex-grow space-y-4">
                  <div>
                    <h4 className="font-semibold mb-2 text-sm">What you get:</h4>
                    <ul className="list-disc list-inside text-sm text-foreground/80 space-y-1">
                      {pkg.includes.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2 text-sm">
                      What you provide:
                    </h4>
                    <ul className="list-disc list-inside text-sm text-foreground/80 space-y-1">
                      {pkg.provides.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button asChild className="w-full">
                    <Link href={`/quote?package=${pkg.id}`}>Select</Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
