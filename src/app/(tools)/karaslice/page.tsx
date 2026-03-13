import type { Metadata } from "next";
import { KarasliceClient } from "./karaslice-client";

export const metadata: Metadata = {
  title: "Karaslice — 3D Model Slicer",
  description:
    "Browser-based 3D model splitter. Upload oversized STL/OBJ files, configure cut planes, and export print-ready split parts.",
};

export default function KaraslicePage() {
  return <KarasliceClient />;
}
