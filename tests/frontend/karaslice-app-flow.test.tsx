import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import * as THREE from "three";


const uploadToKarasliceMock = vi.fn().mockResolvedValue({});
const analyzeMeshWithAIMock = vi.fn();
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}


vi.stubGlobal("ResizeObserver", ResizeObserverMock);


vi.mock("next/dynamic", async () => {
  const React = await import("react");
  const MockViewport = React.forwardRef(function MockViewport(
    props: {
      onMeshLoaded: (info: {
        fileName: string;
        fileSizeMB: number;
        triangleCount: number;
        boundingBox: { x: number; y: number; z: number };
        format: "stl" | "obj" | "3mf";
      }) => void;
    },
    ref: React.ForwardedRef<{
      getRawGeometry: () => THREE.BufferGeometry;
      loadRepairedGeometry: () => void;
      captureScreenshot: () => string;
      clearDefectOverlays: () => void;
      showDefectOverlays: () => void;
      replaceGeometry: () => void;
      showSupportPreview: () => void;
    }>,
  ) {
    const rawGeometry = React.useMemo(() => new THREE.BoxGeometry(4, 4, 4), []);

    React.useImperativeHandle(ref, () => ({
      getRawGeometry: () => rawGeometry,
      loadRepairedGeometry: () => {},
      captureScreenshot: () => "mock-screenshot",
      clearDefectOverlays: () => {},
      showDefectOverlays: () => {},
      replaceGeometry: () => {},
      showSupportPreview: () => {},
    }), [rawGeometry]);

    React.useEffect(() => {
      const handler = (event: Event) => {
        const customEvent = event as CustomEvent<File>;
        props.onMeshLoaded({
          fileName: customEvent.detail?.name ?? "fixture.stl",
          fileSizeMB: 1.2,
          triangleCount: 12,
          boundingBox: { x: 4, y: 4, z: 4 },
          format: "stl",
        });
      };

      window.addEventListener("karaslice:load-file", handler);
      return () => window.removeEventListener("karaslice:load-file", handler);
    }, [props]);

    return <div data-testid="mock-viewport">Viewport</div>;
  });

  return {
    default: () => React.forwardRef((props, ref) => <MockViewport {...props} ref={ref} />),
  };
});


vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));


vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));


vi.mock("@/app/actions/storage-actions", () => ({
  uploadToKaraslice: uploadToKarasliceMock,
  batchUploadJob: vi.fn(),
}));


vi.mock("@/app/actions/cloud-repair-actions", () => ({
  submitCloudRepairJob: vi.fn(),
  getRepairJobStatus: vi.fn(),
  getRepairResultUrl: vi.fn(),
}));


vi.mock("@/app/actions/mesh-analysis-actions", () => ({
  analyzeMeshWithAI: analyzeMeshWithAIMock,
  diagnoseReconstructionFailure: vi.fn(),
  postRepairReview: vi.fn(),
}));


vi.mock("@/components/karaslice/stl-utils", () => ({
  analyzeGeometry: vi.fn(() => ({
    triangleCount: 12,
    vertexCount: 8,
    isWatertight: false,
    openEdgeCount: 2,
    nonManifoldEdgeCount: 0,
    surfaceAreaMM2: 96,
    volumeMM3: 64,
    issues: ["2 open edges"],
    diagnostics: {
      avgEdgeLengthMM: 4,
      medianEdgeLengthMM: 4,
      boundaryLoopCount: 1,
      avgGapWidthMM: 0.2,
      maxGapWidthMM: 0.2,
      corruptionClustering: 0.3,
      degenerateTriCount: 0,
      normalConsistency: 1,
    },
  })),
}));


vi.mock("@/components/karaslice/mesh-sanitize", () => ({
  sanitizeMesh: vi.fn((geo: THREE.BufferGeometry) => ({
    geometry: geo,
    stats: {
      duplicateFacesRemoved: 0,
      debrisComponentsRemoved: 0,
      debrisTrianglesRemoved: 0,
      nonManifoldEdgesResolved: 0,
      inputTriangles: 12,
      outputTriangles: 12,
    },
  })),
}));


vi.mock("@/components/karaslice/validate-reconstruction", () => ({
  validateReconstructionOutput: vi.fn(() => ({
    passed: true,
    failures: [],
    metrics: {
      triangleCount: 24,
      vertexCount: 8,
      nanVertices: 0,
      degenerateTriangles: 0,
      nonManifoldEdges: 0,
      boundaryEdges: 0,
    },
  })),
}));


vi.mock("@/components/karaslice/poisson-reconstruct", () => ({
  pointCloudReconstruct: vi.fn(),
}));


vi.mock("@/components/karaslice/voxel-reconstruct", () => ({
  autoVoxelResolution: vi.fn(() => 2),
  minSafeResolution: vi.fn(() => 1),
  estimateOutputTriangles: vi.fn(() => 42),
  estimateWallThickness: vi.fn(async () => ({
    avgMM: 1.5,
    minMM: 1.2,
    isThinShell: false,
  })),
  voxelReconstruct: vi.fn(),
  shellVoxelReconstruct: vi.fn(),
  postProcessVoxelOutput: vi.fn(async (geo: THREE.BufferGeometry) => geo),
}));


describe("KarasliceApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    analyzeMeshWithAIMock.mockResolvedValue({
      meshType: "solid_body",
      repairStrategy: "topology_repair",
      confidence: 0.91,
      reasoning: "Minor open edges detected.",
      warnings: [],
      heuristic: false,
      error: null,
      modelId: { description: "Mock model" },
      repairPlan: {
        pipeline: "point_cloud",
        userMessage: "Use point cloud reconstruction.",
        params: {
          pointCloud: {
            resolution: 2,
            smoothingIterations: 0,
            simplifyTarget: 0,
          },
          postProcess: {
            smoothingIterations: 0,
            simplifyTarget: 0,
          },
        },
      },
    });
  });

  it("handles upload, analysis, and repair-mode selection", async () => {
    const user = userEvent.setup();
    const { KarasliceApp } = await import("@/components/karaslice/karaslice-app");

    const { container } = render(<KarasliceApp />);
    expect(screen.getByTestId("mock-viewport")).toBeInTheDocument();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["solid"], "fixture.stl", { type: "model/stl" });
    await user.upload(input, file);
    fireEvent(window, new CustomEvent("karaslice:load-file", { detail: file }));

    const fileNameLabels = await screen.findAllByText("fixture.stl");
    expect(fileNameLabels.length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Analyze Mesh" }));

    expect((await screen.findAllByText(/solid body/i)).length).toBeGreaterThan(0);
    expect(screen.getByText("Mock model")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Repair" }));
    await user.click(screen.getByRole("button", { name: "Reconstruction" }));
    await user.click(await screen.findByRole("button", { name: "Point Cloud" }));

    expect(screen.getByText("MLS/SDF reconstruction from point cloud. Best for thin shells and car bodies.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconstruct (Point Cloud)" })).toBeInTheDocument();
  }, 30000);
});
