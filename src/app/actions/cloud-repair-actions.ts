"use server";

import { auth } from "@/auth";
import { getAdminStorage } from "@/lib/firebase-admin";
import { getAdminFirestore } from "@/lib/firebase-admin";

const REPAIR_JOBS_COLLECTION = "repair_jobs";
const BUCKET_FOLDER = "Karaslice/repair-jobs";

/** Sanitize user email/id into a safe folder name. */
function userFolder(email?: string | null, id?: string | null): string {
  return (email ?? id ?? "unknown").replace(/[^a-zA-Z0-9@._-]/g, "_");
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RepairJobStatus {
  jobId: string;
  status: "queued" | "running" | "finished" | "failed";
  step?: string;
  stepMessage?: string;
  error?: string;
  inputSizeBytes?: number;
  startedAt?: string;
  finishedAt?: string;
  outputPaths?: Record<string, string>;
  report?: RepairReport;
}

export interface RepairReport {
  inputVertices: number;
  inputFaces: number;
  outputVertices: number;
  outputFaces: number;
  componentsDetected: number;
  componentsRemoved: number;
  debrisTrianglesRemoved: number;
  duplicateFacesRemoved: number;
  verticesWelded?: number;
  nonManifoldEdgesFixed: number;
  selfIntersectionsRemoved?: number;
  holesFilled: number;
  featureEdgesPreserved?: number;
  thinWallsThickened?: number;
  reconstructionUsed: boolean;
  reconstructionMethod?: string | null;
  watertight: boolean;
  manifold?: boolean;
  eulerCharacteristic: number | null;
  qualityScore?: number;
  damageClassification?: string;
  elapsedSeconds: number;
  mode: string;
  stages: Array<{
    name: string;
    metrics: Record<string, unknown>;
    elapsed: number;
  }>;
}

export interface SubmitRepairResult {
  jobId: string;
  inputPath: string;
}

export interface SplitPart {
  index: number;
  fileName: string;
  storagePath?: string;
  faces: number;
  vertices: number;
  bbox: [number, number, number];
  volume: number;
  watertight: boolean;
}

export interface SplitJobStatus {
  jobId: string;
  status: "queued" | "running" | "finished" | "failed";
  step?: string;
  stepMessage?: string;
  error?: string;
  parts?: SplitPart[];
  report?: Record<string, unknown>;
}

// ─── Submit repair job ───────────────────────────────────────────────────────

export async function submitCloudRepairJob(
  formData: FormData,
): Promise<SubmitRepairResult> {
  const session = await auth();
  if (!session?.user) throw new Error("Authentication required");

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) throw new Error("No file provided");

  const repairMode = (formData.get("repairMode") as string) || "auto";
  const paramsJson = formData.get("params") as string;
  const params = paramsJson ? JSON.parse(paramsJson) : {};

  const folder = userFolder(session.user.email, session.user.id);
  const jobId = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Upload mesh to Firebase Storage
  const storage = getAdminStorage();
  const bucket = storage.bucket();
  const inputPath = `${BUCKET_FOLDER}/${folder}/${jobId}/input${getExtension(file.name)}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await bucket.file(inputPath).save(buffer, {
    contentType: file.type || "application/octet-stream",
    metadata: {
      uploadedBy: session.user.email ?? session.user.id ?? "unknown",
      originalName: file.name,
      uploadedAt: new Date().toISOString(),
      jobId,
    },
  });

  // Create Firestore job document
  const db = getAdminFirestore();
  await db.collection(REPAIR_JOBS_COLLECTION).doc(jobId).set({
    jobId,
    userId: session.user.id ?? session.user.email ?? "unknown",
    userEmail: session.user.email ?? "",
    userName: session.user.name ?? "",
    status: "queued",
    inputPath,
    inputFileName: file.name,
    inputSizeBytes: file.size,
    repairMode,
    params,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Trigger Cloud Run worker
  const workerUrl = process.env.MESH_REPAIR_WORKER_URL;
  if (workerUrl) {
    // Fire-and-forget — worker updates Firestore directly
    triggerWorker(workerUrl, jobId, inputPath, repairMode, params).catch(
      (err) => {
        // If trigger fails, mark job as failed
        db.collection(REPAIR_JOBS_COLLECTION)
          .doc(jobId)
          .update({
            status: "failed",
            error: `Worker trigger failed: ${err instanceof Error ? err.message : String(err)}`,
            updatedAt: new Date().toISOString(),
          })
          .catch(() => {});
      },
    );
  } else {
    // No worker URL configured — run inline (dev mode)
    // Mark as failed with helpful message
    await db.collection(REPAIR_JOBS_COLLECTION).doc(jobId).update({
      status: "queued",
      stepMessage: "Waiting for worker — set MESH_REPAIR_WORKER_URL env var for Cloud Run, or use the local dev endpoint.",
      updatedAt: new Date().toISOString(),
    });
  }

  return { jobId, inputPath };
}

async function triggerWorker(
  workerUrl: string,
  jobId: string,
  inputPath: string,
  repairMode: string,
  params: Record<string, unknown>,
): Promise<void> {
  // Get an identity token for Cloud Run authentication
  let headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // On Cloud Run / App Hosting, use the metadata server for identity tokens
  try {
    const tokenUrl = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${workerUrl}`;
    const tokenRes = await fetch(tokenUrl, {
      headers: { "Metadata-Flavor": "Google" },
    });
    if (tokenRes.ok) {
      const token = await tokenRes.text();
      headers["Authorization"] = `Bearer ${token}`;
    }
  } catch {
    // Local dev — no metadata server, skip auth
  }

  const res = await fetch(`${workerUrl}/repair`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jobId, inputPath, repairMode, params }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Worker responded ${res.status}: ${text}`);
  }
}

// ─── Poll job status ─────────────────────────────────────────────────────────

export async function getRepairJobStatus(jobId: string): Promise<RepairJobStatus | null> {
  const session = await auth();
  if (!session?.user) throw new Error("Authentication required");

  const db = getAdminFirestore();
  const doc = await db.collection(REPAIR_JOBS_COLLECTION).doc(jobId).get();

  if (!doc.exists) return null;

  const data = doc.data()!;

  // Verify ownership
  const userId = session.user.id ?? session.user.email ?? "";
  if (data.userId !== userId && data.userEmail !== session.user.email) {
    throw new Error("Access denied");
  }

  return {
    jobId: data.jobId,
    status: data.status,
    step: data.step,
    stepMessage: data.stepMessage,
    error: data.error,
    inputSizeBytes: data.inputSizeBytes,
    startedAt: data.startedAt,
    finishedAt: data.finishedAt,
    outputPaths: data.outputPaths,
    report: data.report,
  };
}

// ─── Get signed download URL for repaired mesh ──────────────────────────────

export async function getRepairResultUrl(
  jobId: string,
  fileName: string = "repaired.stl",
): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new Error("Authentication required");

  // Verify ownership via Firestore
  const db = getAdminFirestore();
  const doc = await db.collection(REPAIR_JOBS_COLLECTION).doc(jobId).get();
  if (!doc.exists) throw new Error("Job not found");

  const data = doc.data()!;
  const userId = session.user.id ?? session.user.email ?? "";
  if (data.userId !== userId && data.userEmail !== session.user.email) {
    throw new Error("Access denied");
  }

  const outputPaths = data.outputPaths as Record<string, string> | undefined;
  const filePath = outputPaths?.[fileName];
  if (!filePath) throw new Error(`Output file "${fileName}" not found`);

  const storage = getAdminStorage();
  const bucket = storage.bucket();
  const [url] = await bucket.file(filePath).getSignedUrl({
    action: "read",
    expires: Date.now() + 30 * 60 * 1000, // 30 minutes
  });

  return url;
}

// ─── List user's repair jobs ─────────────────────────────────────────────────

export async function listRepairJobs(): Promise<RepairJobStatus[]> {
  const session = await auth();
  if (!session?.user) throw new Error("Authentication required");

  const db = getAdminFirestore();
  const userId = session.user.id ?? session.user.email ?? "";

  const snapshot = await db
    .collection(REPAIR_JOBS_COLLECTION)
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();

  return snapshot.docs.map((doc) => {
    const d = doc.data();
    return {
      jobId: d.jobId,
      status: d.status,
      step: d.step,
      stepMessage: d.stepMessage,
      error: d.error,
      inputSizeBytes: d.inputSizeBytes,
      startedAt: d.startedAt,
      finishedAt: d.finishedAt,
      outputPaths: d.outputPaths,
      report: d.report,
    };
  });
}

// ─── Delete a repair job ─────────────────────────────────────────────────────

export async function deleteRepairJob(jobId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Authentication required");

  const db = getAdminFirestore();
  const doc = await db.collection(REPAIR_JOBS_COLLECTION).doc(jobId).get();
  if (!doc.exists) return;

  const data = doc.data()!;
  const userId = session.user.id ?? session.user.email ?? "";
  if (data.userId !== userId && data.userEmail !== session.user.email) {
    throw new Error("Access denied");
  }

  // Delete storage files
  const storage = getAdminStorage();
  const bucket = storage.bucket();
  const folder = userFolder(session.user.email, session.user.id);
  const prefix = `${BUCKET_FOLDER}/${folder}/${jobId}/`;

  try {
    const [files] = await bucket.getFiles({ prefix });
    await Promise.all(files.map((f) => f.delete().catch(() => {})));
  } catch {
    // Storage cleanup is best-effort
  }

  // Delete Firestore document
  await db.collection(REPAIR_JOBS_COLLECTION).doc(jobId).delete();
}

// ─── Cloud split ─────────────────────────────────────────────────────────────

export interface CloudSplitInput {
  cutPlanes: Array<{ normal: [number, number, number]; origin: [number, number, number] }>;
  params?: Record<string, unknown>;
}

export async function submitCloudSplitJob(
  formData: FormData,
  splitInput: CloudSplitInput,
): Promise<SubmitRepairResult> {
  const session = await auth();
  if (!session?.user) throw new Error("Authentication required");

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) throw new Error("No file provided");

  const folder = userFolder(session.user.email, session.user.id);
  const jobId = `split_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Upload mesh
  const storage = getAdminStorage();
  const bucket = storage.bucket();
  const inputPath = `${BUCKET_FOLDER}/${folder}/${jobId}/input${getExtension(file.name)}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await bucket.file(inputPath).save(buffer, {
    contentType: file.type || "application/octet-stream",
    metadata: {
      uploadedBy: session.user.email ?? session.user.id ?? "unknown",
      originalName: file.name,
      jobId,
    },
  });

  // Create Firestore job
  const db = getAdminFirestore();
  await db.collection(REPAIR_JOBS_COLLECTION).doc(jobId).set({
    jobId,
    jobType: "split",
    userId: session.user.id ?? session.user.email ?? "unknown",
    userEmail: session.user.email ?? "",
    status: "queued",
    inputPath,
    inputFileName: file.name,
    inputSizeBytes: file.size,
    cutPlanes: splitInput.cutPlanes,
    params: splitInput.params ?? {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Trigger worker
  const workerUrl = process.env.MESH_REPAIR_WORKER_URL;
  if (workerUrl) {
    triggerSplitWorker(workerUrl, jobId, inputPath, splitInput).catch((err) => {
      db.collection(REPAIR_JOBS_COLLECTION)
        .doc(jobId)
        .update({
          status: "failed",
          error: `Worker trigger failed: ${err instanceof Error ? err.message : String(err)}`,
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
    });
  }

  return { jobId, inputPath };
}

async function triggerSplitWorker(
  workerUrl: string,
  jobId: string,
  inputPath: string,
  splitInput: CloudSplitInput,
): Promise<void> {
  let headers: Record<string, string> = { "Content-Type": "application/json" };

  try {
    const tokenUrl = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${workerUrl}`;
    const tokenRes = await fetch(tokenUrl, { headers: { "Metadata-Flavor": "Google" } });
    if (tokenRes.ok) {
      headers["Authorization"] = `Bearer ${await tokenRes.text()}`;
    }
  } catch {
    // Local dev
  }

  const res = await fetch(`${workerUrl}/split`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jobId,
      inputPath,
      cutPlanes: splitInput.cutPlanes,
      params: splitInput.params ?? {},
    }),
  });

  if (!res.ok) throw new Error(`Worker responded ${res.status}: ${await res.text()}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getExtension(filename: string): string {
  const ext = filename.lastIndexOf(".");
  return ext >= 0 ? filename.slice(ext).toLowerCase() : ".obj";
}
