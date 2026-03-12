import type { Metadata } from "next";
import { Split3rClient } from "./split3r-client";

export const metadata: Metadata = {
  title: "Split3r — 3D Model Slicer",
  description:
    "Browser-based 3D model splitter. Upload oversized STL/OBJ files, configure cut planes, and export print-ready split parts.",
};

export default function Split3rPage() {
  return <Split3rClient />;
}
