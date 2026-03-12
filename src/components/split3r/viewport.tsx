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

  const [hasMesh, setHasMesh] = useState(false);

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
  }));

  // ── Cut plane visuals ───────────────────────────────────────────────────────

  const rebuildPlanes = useCallback(() => {
    if (!sceneRef.current || !bbRef.current) return;
    planeHelpersRef.current.forEach((p) => sceneRef.current!.remove(p));
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
    const w = mountRef.current.clientWidth;
    const h = mountRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0d12);
    sceneRef.current = scene;

    scene.add(new THREE.GridHelper(400, 40, 0x1a1a2e, 0x1a1a2e));
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dir1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dir1.position.set(5, 10, 7);
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0x88eeff, 0.4);
    dir2.position.set(-5, -3, -5);
    scene.add(dir2);

    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 10000);
    camera.position.set(200, 160, 200);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      if (!mountRef.current) return;
      const w2 = mountRef.current.clientWidth;
      const h2 = mountRef.current.clientHeight;
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2);
    };
    window.addEventListener("resize", onResize);

    const onLoadFile = (e: Event) => {
      const file = (e as CustomEvent<File>).detail;
      if (file) handleFileRef.current(file);
    };
    window.addEventListener("split3r:load-file", onLoadFile);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("split3r:load-file", onLoadFile);
      renderer.dispose();
      if (mountRef.current?.contains(renderer.domElement)) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load geometry ──────────────────────────────────────────────────────────

  const loadGeometry = useCallback((
    geo: THREE.BufferGeometry,
    fileName: string,
    fileSizeMB: number,
    format: "stl" | "obj"
  ) => {
    if (!sceneRef.current || !cameraRef.current || !controlsRef.current) return;

    geo.computeBoundingBox();
    geo.center();

    if (meshRef.current) {
      sceneRef.current.remove(meshRef.current);
      meshRef.current.geometry.dispose();
    }

    const mat = new THREE.MeshPhongMaterial({
      color: 0xd0d8e8, specular: 0x222244, shininess: 30,
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
    cameraRef.current.position.set(maxDim * 1.5, maxDim * 1.2, maxDim * 1.5);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();

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

      const mat = new THREE.MeshPhongMaterial({
        color,
        specular: 0x111122,
        shininess: 20,
        transparent: ghostMode && !isSelected,
        opacity: ghostMode && !isSelected ? 0.28 : 1.0,
        wireframe,
        emissive: isSelected ? new THREE.Color(0x334455) : new THREE.Color(0x000000),
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
      <div ref={mountRef} className="w-full h-full" />

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
