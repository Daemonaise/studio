"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { materials, type Material, type MaterialCategory } from "@/app/data/materials";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { Separator } from "@/components/ui/separator";
import { Layers, Thermometer, Zap, FlaskConical, ArrowRight, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORIES: { label: string; value: "All" | MaterialCategory }[] = [
  { label: "All Materials", value: "All" },
  { label: "Standard", value: "Standard" },
  { label: "Engineering", value: "Engineering" },
  { label: "Flexible", value: "Flexible" },
  { label: "Composite", value: "Composite" },
];

const CATEGORY_INFO: Record<MaterialCategory, { icon: React.ReactNode; description: string }> = {
  Standard: {
    icon: <Layers className="h-4 w-4" />,
    description: "Easy to print, cost-effective, wide color range",
  },
  Engineering: {
    icon: <Zap className="h-4 w-4" />,
    description: "High strength, temperature & chemical resistance",
  },
  Flexible: {
    icon: <FlaskConical className="h-4 w-4" />,
    description: "Rubber-like elasticity, impact absorption",
  },
  Composite: {
    icon: <Thermometer className="h-4 w-4" />,
    description: "Carbon fiber reinforced, maximum stiffness-to-weight",
  },
};

function MaterialCard({ material }: { material: Material }) {
  const router = useRouter();
  const image = PlaceHolderImages.find((img) => img.id === material.imageId);
  const info = CATEGORY_INFO[material.category];

  return (
    <Card className="relative flex h-full flex-col overflow-hidden transition-shadow duration-300 group-hover:shadow-2xl group-hover:shadow-primary/20">
      <CardHeader className="p-0">
        <div className="relative aspect-[4/3] w-full overflow-hidden">
          {image && (
            <Image
              src={image.imageUrl}
              alt={material.name}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              data-ai-hint={image.imageHint}
            />
          )}
          {/* Category pill overlay */}
          <div className="absolute top-3 left-3">
            <Badge
              variant="secondary"
              className="flex items-center gap-1 bg-background/80 backdrop-blur-sm text-xs"
            >
              {info.icon}
              {material.category}
            </Badge>
          </div>
        </div>
        <div className="px-6 pt-5 pb-2">
          <CardTitle className="text-xl">{material.name}</CardTitle>
          <CardDescription className="mt-1.5 text-sm leading-relaxed">
            {material.description}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex-grow flex flex-col justify-between px-6 pb-6">
        <div>
          <h4 className="font-semibold mb-2 text-sm text-foreground/70 uppercase tracking-wide">
            Properties
          </h4>
          <ul className="space-y-1.5 text-sm mb-4">
            {material.properties.map((prop) => (
              <li key={prop.name} className="flex justify-between items-center">
                <span className="text-muted-foreground">{prop.name}</span>
                <span className="font-mono font-semibold text-right tabular-nums">
                  {prop.value}
                  {prop.unit && (
                    <span className="text-muted-foreground font-normal ml-1 text-xs">
                      {prop.unit}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          <Separator className="mb-4" />

          <h4 className="font-semibold mb-2 text-sm text-foreground/70 uppercase tracking-wide">
            Common Applications
          </h4>
          <div className="flex flex-wrap gap-1.5 mb-6">
            {material.useCases.map((useCase) => (
              <Badge key={useCase} variant="secondary" className="text-xs">
                {useCase}
              </Badge>
            ))}
          </div>
        </div>

        <Button
          className="w-full gap-2"
          style={{
            backgroundColor: "hsl(var(--accent))",
            color: "hsl(var(--accent-foreground))",
          }}
          onClick={() => router.push(`/quote?material=${material.id}`)}
        >
          <Wand2 className="h-4 w-4" />
          Quote This Material
          <ArrowRight className="h-4 w-4 ml-auto" />
        </Button>
      </CardContent>
    </Card>
  );
}

export default function MaterialsPage() {
  const [activeCategory, setActiveCategory] = useState<"All" | MaterialCategory>("All");

  const filtered = activeCategory === "All"
    ? materials
    : materials.filter((m) => m.category === activeCategory);

  const stats = [
    { value: `${materials.length}`, label: "Available Materials" },
    { value: "FDM", label: "Print Technology" },
    { value: "< 10s", label: "Instant Quotes" },
    { value: "4", label: "Material Classes" },
  ];

  return (
    <div className="bg-secondary/50 min-h-screen">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-border/50">
        <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-accent/8 via-accent/[0.03] to-transparent pointer-events-none" />
        <div className="container py-14 md:py-20">
          <div className="text-center space-y-5 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent">
              <Layers className="h-3.5 w-3.5" />
              Material Science
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              3D Printing{" "}
              <span className="text-accent">Materials</span>
            </h1>
            <p className="text-lg text-foreground/65 leading-relaxed">
              From rapid prototyping to end-use structural parts — we stock a curated range of
              FDM materials to match any application, budget, and performance requirement.
            </p>

            {/* Stats */}
            <div className="flex flex-wrap justify-center gap-10 pt-3">
              {stats.map(({ value, label }) => (
                <div key={label} className="text-center">
                  <p className="text-2xl font-bold text-accent">{value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="container py-12 md:py-16">

        {/* Category overview cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {(Object.keys(CATEGORY_INFO) as MaterialCategory[]).map((cat) => {
            const info = CATEGORY_INFO[cat];
            const count = materials.filter((m) => m.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "rounded-lg border p-4 text-left transition-all duration-200 hover:border-accent/60 hover:bg-accent/5",
                  activeCategory === cat
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-card text-foreground"
                )}
              >
                <div className={cn("mb-2", activeCategory === cat ? "text-accent" : "text-muted-foreground")}>
                  {info.icon}
                </div>
                <p className="font-semibold text-sm">{cat}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{info.description}</p>
                <p className={cn("text-xs font-medium mt-2", activeCategory === cat ? "text-accent" : "text-muted-foreground")}>
                  {count} material{count !== 1 ? "s" : ""}
                </p>
              </button>
            );
          })}
        </div>

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-2 mb-8">
          {CATEGORIES.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setActiveCategory(value)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200",
                activeCategory === value
                  ? "bg-accent text-accent-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              )}
            >
              {label}
              <span className="ml-2 text-xs opacity-70">
                {value === "All" ? materials.length : materials.filter((m) => m.category === value).length}
              </span>
            </button>
          ))}
        </div>

        {/* Material grid */}
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((material) => (
            <div
              key={material.id}
              className="group relative transform-gpu rounded-lg transition-transform duration-300 ease-in-out will-change-transform hover:scale-[1.02]"
            >
              <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-primary/70 via-accent/70 to-secondary/70 opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-100" />
              <MaterialCard material={material} />
            </div>
          ))}
        </div>

        {/* Bottom info strip */}
        <div className="mt-16 rounded-xl border border-accent/20 bg-accent/5 px-8 py-8 text-center">
          <h3 className="text-lg font-semibold mb-2">Not sure which material to choose?</h3>
          <p className="text-muted-foreground text-sm max-w-xl mx-auto mb-5">
            Our AI-powered quote tool analyzes your part geometry and recommends the best material
            for your application and budget. Upload your file and get an instant estimate.
          </p>
          <Button
            size="lg"
            className="gap-2"
            style={{
              backgroundColor: "hsl(var(--accent))",
              color: "hsl(var(--accent-foreground))",
            }}
            onClick={() => window.location.href = "/quote"}
          >
            <Wand2 className="h-4 w-4" />
            Get an AI Quote
          </Button>
        </div>
      </div>
    </div>
  );
}
