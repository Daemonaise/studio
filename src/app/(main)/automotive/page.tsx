
'use client';
import Image from 'next/image';
import Link from 'next/link';
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
    price: '$5,000 - $10,000+',
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

export default function AutomotivePage() {
  return (
    <div className="py-20 md:py-32">
      <div className="container">
        <div className="text-center space-y-4 mb-12">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Automotive Packages
          </h1>
          <p className="max-w-3xl mx-auto text-lg text-foreground/70">
            Select the package that best fits your project needs and budget.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-12 md:grid-cols-2 lg:grid-cols-3">
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className="group relative transform-gpu rounded-lg transition-transform duration-300 ease-in-out will-change-transform hover:scale-105"
            >
              <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-primary/70 via-accent/70 to-secondary/70 opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-100"></div>
              <Card className="relative flex h-full flex-col overflow-hidden transition-shadow duration-300 group-hover:shadow-2xl group-hover:shadow-primary/20">
                <CardHeader>
                  <div className="relative aspect-video w-full overflow-hidden rounded-md mb-4">
                    <Image
                      src={pkg.imageUrl}
                      alt={pkg.name}
                      fill
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
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
                    <h4 className="font-semibold mb-2 text-sm">
                      What you get:
                    </h4>
                    <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80">
                      {pkg.includes.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2 text-sm">
                      What you provide:
                    </h4>
                    <ul className="list-disc list-inside space-y-1 text-sm text-foreground/80">
                      {pkg.provides.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
                <CardFooter>
                  {pkg.id === 'digital-file' || pkg.id === 'disassembled-kit' ? (
                    <div className="flex w-full flex-col gap-2">
                      <Button asChild className="w-full">
                        <Link href="/gallery">Choose from our selection</Link>
                      </Button>
                      <Button asChild className="w-full" variant="secondary">
                        <Link href={`/quote?package=${pkg.id}`}>Upload your own file</Link>
                      </Button>
                    </div>
                  ) : (
                    <Button asChild className="w-full">
                      <Link href={`/quote?package=${pkg.id}`}>Select</Link>
                    </Button>
                  )}
                </CardFooter>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
