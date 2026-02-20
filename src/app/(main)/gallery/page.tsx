
import Image from 'next/image';
import { PlaceHolderImages } from '@/lib/placeholder-images';

const galleryImages = [
  { id: 'gallery-1', hint: 'custom car build' },
  { id: 'gallery-2', hint: '3d printed part' },
  { id: 'gallery-3', hint: 'car monocoque' },
  { id: 'gallery-4', hint: 'prototype design' },
  { id: 'gallery-5', hint: 'automotive engineering' },
  { id: 'gallery-6', hint: 'race car body' },
];

export default function GalleryPage() {
  return (
    <div className="container py-12 md:py-20">
      <div className="text-center space-y-4 mb-12">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Gallery
        </h1>
        <p className="max-w-3xl mx-auto text-lg text-foreground/70">
          Check out some of the amazing projects built by our customers and our team.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {galleryImages.map((imgInfo, index) => (
          <div key={imgInfo.id} className="relative aspect-square rounded-lg overflow-hidden">
            <Image
              src={`https://picsum.photos/seed/${imgInfo.id}/600/600`}
              alt={`Gallery image ${index + 1}`}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              data-ai-hint={imgInfo.hint}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
