import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Bot, HardDrive, TestTube } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function HomePage() {
  const heroImage = PlaceHolderImages.find((img) => img.id === "hero-image");

  const features = [
    {
      icon: <HardDrive className="h-8 w-8 text-primary" />,
      title: "Upload & Configure",
      description:
        "Easily upload your STL, OBJ, and 3MF files. Our wizard guides you through selecting materials and specifications.",
    },
    {
      icon: <Bot className="h-8 w-8 text-primary" />,
      title: "AI-Powered Assistance",
      description:
        "Get expert material recommendations from our AI assistant to optimize for strength, cost, and print time.",
    },
    {
      icon: <TestTube className="h-8 w-8 text-primary" />,
      title: "Expert Materials",
      description:
        "Browse our extensive catalog of high-performance materials, complete with detailed datasheets for your needs.",
    },
  ];

  return (
    <div className="flex flex-col">
      <section className="relative w-full bg-secondary/50">
        <div className="container grid lg:grid-cols-2 gap-12 items-center py-20 md:py-32">
          <div className="space-y-6 text-center lg:text-left">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
              Karasawa Heavy Industries
            </h1>
            <p className="max-w-2xl mx-auto lg:mx-0 text-lg text-foreground/80 md:text-xl">
              Precision Engineering, On-Demand Manufacturing. Get instant quotes
              and expert guidance for your 3D printing projects.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <Button asChild size="lg" style={{ backgroundColor: "hsl(var(--accent))", color: "hsl(var(--accent-foreground))" }}>
                <Link href="/quote">
                  Get an Instant Quote <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/materials">Browse Materials</Link>
              </Button>
            </div>
          </div>
          <div className="relative rounded-lg overflow-hidden aspect-video">
            {heroImage && (
              <Image
                src={heroImage.imageUrl}
                alt={heroImage.description}
                fill
                className="object-cover"
                data-ai-hint={heroImage.imageHint}
                priority
              />
            )}
          </div>
        </div>
      </section>

      <section className="py-20 md:py-32">
        <div className="container">
          <div className="text-center space-y-4 mb-12">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Your Partner in Digital Manufacturing
            </h2>
            <p className="max-w-3xl mx-auto text-lg text-foreground/70">
              From prototype to production, we provide the tools and expertise
              to bring your designs to life.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {features.map((feature, index) => (
              <Card key={index} className="flex flex-col items-center text-center p-6">
                <CardHeader>
                  {feature.icon}
                  <CardTitle className="mt-4">{feature.title}</CardTitle>
                </CardHeader>
                <CardDescription>{feature.description}</CardDescription>
              </Card>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
