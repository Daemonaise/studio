"use client";

import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Upload } from "lucide-react";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface MeshInfo {
  fileName: string;
  fileSizeMB: number;
  triangleCount: number;
  boundingBox: { x: number; y: number; z: number };
  format: "stl" | "obj" | "3mf";
}

export interface CutPlane {
  axis: "x" | "y" | "z";
  position: number; // 0–1 normalized within bounding box
  enabled: boolean;
}

export interface TransformState {
  scaleX: number; scaleY: number; scaleZ: number; // 0.1–10
  rotX: number; rotY: number; rotZ: number;        // degrees
}

export interface SplitPartVisual {
  geometry: THREE.BufferGeometry;
  label: string;
}

export interface ViewportHandle {
  /** Returns the geometry with current transforms baked in, ready for manifold. */
  getBakedGeometry(): {
    geo: THREE.BufferGeometry;
    bbox: THREE.Box3;
  } | null;
  /** Raw geometry for analysis (before transforms). */
  getRawGeometry(): THREE.BufferGeometry | null;
  /** Replace the current mesh with a repaired geometry (keeps camera position). */
  loadRepairedGeometry(geo: THREE.BufferGeometry, fileName: string): void;
}

interface ViewportProps {
  onMeshLoaded: (info: MeshInfo) => void;
  cutPlanes: CutPlane[];
  printerVolume: { x: number; y: number; z: number } | null;
  transforms?: TransformState;
  splitParts?: SplitPartVisual[];
  explodeAmount?: number;   // 0–1
  ghostMode?: boolean;
  wireframe?: boolean;
  selectedPartIndex?: number;
  onPartSelect?: (index: number) => void;
}

// ─── Part color palette ────────────────────────────────────────────────────────

const PART_COLORS = [
  0x4fc3f7, 0x81c784, 0xffb74d, 0xce93d8,
  0xef9a9a, 0x80cbc4, 0xfff176, 0xff8a65,
  0x90caf9, 0xa5d6a7, 0xffcc80, 0xb39ddb,
];

// ─── Component ─────────────────────────────────────────────────────────────────

export const Viewport = forwardRef<ViewportHandle, ViewportProps>(function Viewport(
  {
    onMeshLoaded,
    cutPlanes,
    printerVolume,
    transforms,
    splitParts,
    explodeAmount = 0,
    ghostMode = false,
    wireframe = false,
    selectedPartIndex,
    onPartSelect,
  },
  ref
) {
  const mountRef    = useRef<HTMLDivElement>(null);
  const sceneRef    = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef     = useRef<THREE.Mesh | null>(null);
  const bbRef       = useRef<THREE.Box3 | null>(null);
  const frameRef    = useRef<number>(0);

  const splitMeshesRef  = useRef<THREE.Mesh[]>([]);
  const planeHelpersRef = useRef<THREE.Object3D[]>([]);
  const gridRef         = useRef<THREE.GridHelper | null>(null);

  const [hasMesh, setHasMesh] = useState(false);

  // ── Cut plane visuals ───────────────────────────────────────────────────────

  const rebuildPlanes = useCallback(() => {
    if (!sceneRef.current || !bbRef.current) return;
    planeHelpersRef.current.forEach((p) => {
      sceneRef.current!.remove(p);
      if (p instanceof THREE.Mesh || p instanceof THREE.LineSegments) {
        p.geometry.dispose();
        (p.material as THREE.Material).dispose();
      }
    });
    planeHelpersRef.current = [];

    cutPlanes.forEach(({ axis, position, enabled }) => {
      if (!enabled) return;
      const bb     = bbRef.current!;
      const size   = new THREE.Vector3();
      bb.getSize(size);
      const center = new THREE.Vector3();
      bb.getCenter(center);

      let geo: THREE.PlaneGeometry;
      const pos = new THREE.Vector3();
      const rot = new THREE.Euler();
      const m = 1.2;

      if (axis === "x") {
        geo = new THREE.PlaneGeometry(size.z * m, size.y * m);
        pos.set(bb.min.x + size.x * position, center.y, center.z);
        rot.set(0, Math.PI / 2, 0);
      } else if (axis === "y") {
        geo = new THREE.PlaneGeometry(size.x * m, size.z * m);
        pos.set(center.x, bb.min.y + size.y * position, center.z);
        rot.set(Math.PI / 2, 0, 0);
      } else {
        geo = new THREE.PlaneGeometry(size.x * m, size.y * m);
        pos.set(center.x, center.y, bb.min.z + size.z * position);
        rot.set(0, 0, 0);
      }

      const mat = new THREE.MeshBasicMaterial({
        color: 0x0acdd6, transparent: true, opacity: 0.18,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const plane = new THREE.Mesh(geo, mat);
      plane.position.copy(pos);
      plane.rotation.copy(rot);
      sceneRef.current!.add(plane);
      planeHelpersRef.current.push(plane);

      const edgeMat = new THREE.LineBasicMaterial({ color: 0x0acdd6, linewidth: 2 });
      const line    = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
      line.position.copy(pos);
      line.rotation.copy(rot);
      sceneRef.current!.add(line);
      planeHelpersRef.current.push(line);
    });
  }, [cutPlanes]);

  // ── Three.js scene init ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e0e14);
    sceneRef.current = scene;

    // Grid — size is updated when a mesh loads; start at a reasonable default
    const grid = new THREE.GridHelper(400, 40, 0x252545, 0x18182e);
    grid.position.y = -0.05; // slight offset avoids z-fighting with model bottom at Y=0
    scene.add(grid);
    gridRef.current = grid;
    // Axes helper so orientation is always clear (red=X, green=Y, blue=Z)
    scene.add(new THREE.AxesHelper(30));

    // Hemisphere light gives realistic sky/ground color separation
    scene.add(new THREE.HemisphereLight(0xddeeff, 0x0a0a1a, 0.8));
    // Key light — warm, slightly above-right
    const key = new THREE.DirectionalLight(0xfff4e0, 2.2);
    key.position.set(6, 12, 8);
    scene.add(key);
    // Fill light — cool, opposite side
    const fill = new THREE.DirectionalLight(0x9fd8ff, 0.6);
    fill.position.set(-8, 2, -6);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 50000);
    camera.position.set(200, 160, 200);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, logarithmicDepthBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping      = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    // Canvas fills its container via CSS absolute positioning.
    // Pixel buffer is updated by ResizeObserver using entry.contentRect,
    // which is guaranteed to have the correct post-layout dimensions.
    const canvas = renderer.domElement;
    canvas.style.position = "absolute";
    canvas.style.top      = "0";
    canvas.style.left     = "0";
    canvas.style.width    = "100%";
    canvas.style.height   = "100%";
    canvas.style.display  = "block";
    canvas.style.outline  = "none";
    renderer.setSize(1, 1, false);   // tiny pixel buffer; ResizeObserver corrects it

    mountRef.current.appendChild(canvas);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping    = true;
    controls.dampingFactor    = 0.08;
    controls.minDistance      = 0.5;
    controls.maxDistance      = 20000;
    controls.enablePan        = true;
    controls.enableZoom       = true;
    controls.zoomSpeed        = 1.2;
    controls.panSpeed         = 0.8;
    controlsRef.current = controls;

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // ResizeObserver with entry.contentRect: fires immediately on observe()
    // and gives the true content-box size — no race with clientWidth/clientHeight.
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        const h = Math.round(entry.contentRect.height);
        if (!w || !h) continue;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      }
    });
    ro.observe(mountRef.current);

    // window resize as a belt-and-suspenders fallback
    const onResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.offsetWidth;
      const h = mountRef.current.offsetHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    window.addEventListener("resize", onResize);

    const onLoadFile = (e: Event) => {
      const file = (e as CustomEvent<File>).detail;
      if (file) handleFileRef.current(file);
    };
    window.addEventListener("split3r:load-file", onLoadFile);

    return () => {
      cancelAnimationFrame(frameRef.current);
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("split3r:load-file", onLoadFile);
      controls.dispose();
      renderer.dispose();
      if (mountRef.current?.contains(canvas)) {
        mountRef.current.removeChild(canvas);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load geometry ──────────────────────────────────────────────────────────

  const loadGeometry = useCallback((
    geo: THREE.BufferGeometry,
    fileName: string,
    fileSizeMB: number,
    format: "stl" | "obj" | "3mf"
  ) => {
    if (!sceneRef.current || !cameraRef.current || !controlsRef.current) return;

    geo.computeBoundingBox();
    geo.center();  // XZ centered, but then lift so bottom face sits on Y=0 (build plate)
    geo.computeBoundingBox();
    const liftY = -geo.boundingBox!.min.y;
    geo.translate(0, liftY, 0);
    geo.computeVertexNormals();

    if (meshRef.current) {
      sceneRef.current.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      (meshRef.current.material as THREE.Material).dispose();
    }

    const mat = new THREE.MeshStandardMaterial({
      color: 0xc8d4e8, roughness: 0.45, metalness: 0.15,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    sceneRef.current.add(mesh);
    meshRef.current = mesh;
    setHasMesh(true);

    const bb = new THREE.Box3().setFromObject(mesh);
    bbRef.current = bb;

    const size = new THREE.Vector3();
    bb.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const center = new THREE.Vector3();
    bb.getCenter(center);
    cameraRef.current.position.set(
      center.x + maxDim * 1.6,
      center.y + maxDim * 1.0,
      center.z + maxDim * 1.6
    );
    controlsRef.current.target.copy(center);
    controlsRef.current.update();

    // Resize grid to comfortably surround the loaded part.
    // Round up to a clean number so grid lines stay at whole-unit intervals.
    if (gridRef.current && sceneRef.current) {
      const footprint = Math.max(size.x, size.z);
      const gridSize  = Math.ceil(footprint * 3 / 100) * 100 || 400; // round to nearest 100
      const divisions = Math.max(20, Math.min(80, Math.round(gridSize / 10)));
      sceneRef.current.remove(gridRef.current);
      gridRef.current.dispose();
      const newGrid = new THREE.GridHelper(gridSize, divisions, 0x252545, 0x18182e);
      sceneRef.current.add(newGrid);
      gridRef.current = newGrid;
    }

    const triangleCount = geo.index
      ? geo.index.count / 3
      : (geo.attributes.position?.count ?? 0) / 3;

    onMeshLoaded({
      fileName,
      fileSizeMB,
      triangleCount: Math.round(triangleCount),
      boundingBox: {
        x: parseFloat(size.x.toFixed(1)),
        y: parseFloat(size.y.toFixed(1)),
        z: parseFloat(size.z.toFixed(1)),
      },
      format,
    });

    rebuildPlanes();
  }, [onMeshLoaded, rebuildPlanes]);

  const handleFile = useCallback((file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    const mb  = parseFloat((file.size / 1024 / 1024).toFixed(2));

    if (ext === "stl") {
      const loader = new STLLoader();
      file.arrayBuffer().then((buf) => loadGeometry(loader.parse(buf), file.name, mb, "stl"));
    } else if (ext === "obj") {
      const loader = new OBJLoader();
      file.text().then((text) => {
        const obj   = loader.parse(text);
        const child = obj.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh | undefined;
        if (child) loadGeometry(child.geometry, file.name, mb, "obj");
      });
    } else if (ext === "3mf") {
      file.arrayBuffer().then(async (buf) => {
        const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js");
        const group = new ThreeMFLoader().parse(buf);
        const geos: THREE.BufferGeometry[] = [];
        group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const g = child.geometry.clone();
            child.updateWorldMatrix(true, false);
            g.applyMatrix4(child.matrixWorld);
            geos.push(g);
          }
        });
        if (geos.length === 0) return;
        if (geos.length === 1) {
          loadGeometry(geos[0], file.name, mb, "3mf");
        } else {
          const { mergeGeometries } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
          const merged = mergeGeometries(geos);
          if (merged) loadGeometry(merged, file.name, mb, "3mf");
        }
      });
    }
  }, [loadGeometry]);

  // ── Imperative handle ───────────────────────────────────────────────────────

  useImperativeHandle(ref, () => ({
    getBakedGeometry() {
      if (!meshRef.current) return null;
      const mesh = meshRef.current;
      mesh.updateWorldMatrix(true, false);
      const cloned = mesh.geometry.clone();
      cloned.applyMatrix4(mesh.matrixWorld);
      cloned.computeBoundingBox();
      return { geo: cloned, bbox: cloned.boundingBox! };
    },
    getRawGeometry() {
      return meshRef.current?.geometry ?? null;
    },
    loadRepairedGeometry(geo: THREE.BufferGeometry, fileName: string) {
      const currentMesh = meshRef.current;
      const sizeMB = currentMesh
        ? parseFloat(((currentMesh.geometry.attributes.position?.array.byteLength ?? 0) / 1_048_576).toFixed(2))
        : 0;
      loadGeometry(geo, fileName, sizeMB, "stl");
    },
  }), [loadGeometry]);

  // Stable ref so the event listener in the scene init effect always calls latest version
  const handleFileRef = useRef(handleFile);
  useEffect(() => { handleFileRef.current = handleFile; }, [handleFile]);

  // ── Transforms ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!meshRef.current) return;
    const t = transforms ?? { scaleX: 1, scaleY: 1, scaleZ: 1, rotX: 0, rotY: 0, rotZ: 0 };
    meshRef.current.scale.set(t.scaleX, t.scaleY, t.scaleZ);
    meshRef.current.rotation.set(
      THREE.MathUtils.degToRad(t.rotX),
      THREE.MathUtils.degToRad(t.rotY),
      THREE.MathUtils.degToRad(t.rotZ)
    );
    meshRef.current.updateWorldMatrix(true, false);
    bbRef.current = new THREE.Box3().setFromObject(meshRef.current);
    rebuildPlanes();
  }, [transforms, rebuildPlanes]);

  // ── Rebuild cut planes on change ────────────────────────────────────────────

  useEffect(() => {
    rebuildPlanes();
  }, [rebuildPlanes]);

  // ── Split parts rendering ───────────────────────────────────────────────────

  useEffect(() => {
    if (!sceneRef.current) return;

    // Remove old split meshes
    splitMeshesRef.current.forEach((m) => {
      sceneRef.current!.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    splitMeshesRef.current = [];

    if (!splitParts || splitParts.length === 0) {
      if (meshRef.current) meshRef.current.visible = true;
      return;
    }

    // Hide original mesh
    if (meshRef.current) meshRef.current.visible = false;

    // Compute per-part centers for explode direction
    const centers: THREE.Vector3[] = splitParts.map((part) => {
      const bb = new THREE.Box3().setFromBufferAttribute(
        part.geometry.attributes.position as THREE.BufferAttribute
      );
      return bb.getCenter(new THREE.Vector3());
    });

    const overallCenter = centers
      .reduce((acc, c) => acc.add(c), new THREE.Vector3())
      .divideScalar(centers.length);

    splitParts.forEach((part, i) => {
      const isSelected = selectedPartIndex === i;
      const color = PART_COLORS[i % PART_COLORS.length];

      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.5,
        metalness: 0.1,
        transparent: ghostMode && !isSelected,
        opacity: ghostMode && !isSelected ? 0.28 : 1.0,
        wireframe,
        emissive: isSelected ? new THREE.Color(0x1a2a3a) : new THREE.Color(0x000000),
        emissiveIntensity: isSelected ? 1.0 : 0,
      });

      const mesh = new THREE.Mesh(part.geometry, mat);
      mesh.userData.partIndex = i;

      if (explodeAmount > 0) {
        const dir = centers[i].clone().sub(overallCenter);
        if (dir.length() < 0.001) dir.set(0, 1, 0);
        dir.normalize().multiplyScalar(explodeAmount * 60);
        mesh.position.copy(dir);
      }

      sceneRef.current!.add(mesh);
      splitMeshesRef.current.push(mesh);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitParts, explodeAmount, ghostMode, wireframe, selectedPartIndex]);

  // ── Part selection raycasting ───────────────────────────────────────────────

  useEffect(() => {
    if (!rendererRef.current || !cameraRef.current) return;
    const renderer  = rendererRef.current;
    const camera    = cameraRef.current;
    const raycaster = new THREE.Raycaster();
    const mouse     = new THREE.Vector2();

    const onPointerDown = (e: PointerEvent) => {
      if (!onPartSelect || splitMeshesRef.current.length === 0) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(splitMeshesRef.current, false);
      if (hits.length > 0) onPartSelect(hits[0].object.userData.partIndex as number);
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    return () => renderer.domElement.removeEventListener("pointerdown", onPointerDown);
  }, [onPartSelect]);

  // ── Drag and drop ───────────────────────────────────────────────────────────

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div
      className="relative w-full h-full"
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* absolute inset-0 gives definite dimensions regardless of h-full chain */}
      <div ref={mountRef} className="absolute inset-0" />

      {!hasMesh && (
        <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer gap-4 bg-background/60 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-accent/40 p-12 flex flex-col items-center gap-3 hover:border-accent/80 transition-colors">
            <Upload className="h-10 w-10 text-accent" />
            <p className="text-sm font-medium text-foreground">Drop STL, OBJ, or 3MF file here</p>
            <p className="text-xs text-muted-foreground">or click to browse · up to 250 MB</p>
          </div>
          <input
            type="file"
            accept=".stl,.obj,.3mf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </label>
      )}

      <div className="absolute bottom-3 left-3 text-[10px] font-mono text-muted-foreground/40 select-none pointer-events-none">
        SPLIT3R VIEWPORT
      </div>
    </div>
  );
});
