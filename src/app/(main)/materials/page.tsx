
import Image from "next/image";
import { materials, type Material } from "@/app/data/materials";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { Separator } from "@/components/ui/separator";

function MaterialCard({ material }: { material: Material }) {
  const image = PlaceHolderImages.find((img) => img.id === material.imageId);
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="relative aspect-[4/3] w-full rounded-md overflow-hidden mb-4">
          {image && (
            <Image
              src={image.imageUrl}
              alt={material.name}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              data-ai-hint={image.imageHint}
            />
          )}
        </div>
        <CardTitle>{material.name}</CardTitle>
        <CardDescription>{material.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-grow flex flex-col justify-between">
        <div>
          <h4 className="font-semibold mb-2 text-sm">Properties:</h4>
          <ul className="space-y-1 text-sm text-foreground/80 mb-4">
            {material.properties.map((prop) => (
              <li key={prop.name} className="flex justify-between">
                <span>{prop.name}:</span>
                <span className="font-mono font-medium text-right">
                  {prop.value} {prop.unit}
                </span>
              </li>
            ))}
          </ul>
          <Separator className="my-4" />
          <h4 className="font-semibold mb-2 text-sm">Common Automotive Use Cases:</h4>
          <div className="flex flex-wrap gap-2">
            {material.useCases.map((useCase) => (
              <Badge key={useCase} variant="secondary">
                {useCase}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MaterialsPage() {
  return (
    <div className="bg-secondary/50">
      <div className="container py-12 md:py-20">
        <div className="text-center space-y-4 mb-12">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Automotive Grade Materials
          </h1>
          <p className="max-w-3xl mx-auto text-lg text-foreground/70">
            Explore our range of high-performance materials suitable for demanding automotive applications.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {materials.map((material) => (
            <MaterialCard key={material.id} material={material} />
          ))}
        </div>
      </div>
    </div>
  );
}
