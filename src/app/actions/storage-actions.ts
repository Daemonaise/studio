"use server";

import { auth } from "@/auth";
import { getAdminStorage } from "@/lib/firebase-admin";
import { validateUpload, validateFileContent, sanitizeStoragePath, uploadLimiter, MAX_UPLOAD_BYTES } from "@/lib/security";

const BUCKET_FOLDER = "Karaslice";

/** Max concurrent uploads to avoid overwhelming the storage backend. */
const UPLOAD_CONCURRENCY = 5;

/** Sanitize user email/id into a safe folder name. */
function userFolder(email?: string | null, id?: string | null): string {
  return (email ?? id ?? "unknown").replace(/[^a-zA-Z0-9@._-]/g, "_");
}

/** Generate a short job ID from timestamp + random suffix. */
function generateJobId(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[T:\-]/g, "")
    .slice(0, 14); // YYYYMMDDHHmmss
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}_${rand}`;
}

// ─── Single file upload ───────────────────────────────────────────────────────

export async function uploadToKaraslice(formData: FormData): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new Error("Authentication required");

  // Rate limit by user
  const rateLimitKey = session.user.email ?? session.user.id ?? "unknown";
  const rateCheck = uploadLimiter.check(rateLimitKey);
  if (!rateCheck.allowed) throw new Error("Too many uploads — please wait a moment");

  const file = formData.get("file") as File | null;
  const subfolder = (formData.get("subfolder") as string) || "uploads";
  const jobId = (formData.get("jobId") as string) || "";
  if (!file || file.size === 0) throw new Error("No file provided");

  // Validate upload (file type, size, filename)
  const validation = validateUpload(file);
  if (!validation.valid) throw new Error(validation.error ?? "Invalid file");

  // Validate file content (magic bytes)
  const buffer = await file.arrayBuffer();
  const contentValidation = validateFileContent(buffer, file.name);
  if (!contentValidation.valid) throw new Error(contentValidation.error ?? "Invalid file content");

  const folder = userFolder(session.user.email, session.user.id);
  const storage = getAdminStorage();
  const bucket = storage.bucket();

  // If a jobId is provided, nest under jobs/<jobId>/<subfolder>/
  // Otherwise fall back to the flat layout for backwards compat.
  const basePath = jobId
    ? `${BUCKET_FOLDER}/jobs/${folder}/${jobId}/${subfolder}`
    : `${BUCKET_FOLDER}/${subfolder}/${folder}`;
  const gcsPath = `${basePath}/${file.name}`;

  const bucketFile = bucket.file(gcsPath);
  const uploadBuffer = Buffer.from(buffer);

  await bucketFile.save(uploadBuffer, {
    contentType: file.type || "application/octet-stream",
    metadata: {
      uploadedBy: session.user.email ?? session.user.id ?? "unknown",
      userName: session.user.name ?? "",
      originalName: file.name,
      uploadedAt: new Date().toISOString(),
      ...(jobId ? { jobId } : {}),
    },
  });

  return gcsPath;
}

// ─── Batch upload (for sliced parts) ──────────────────────────────────────────

export interface BatchUploadEntry {
  /** File name including part details, e.g. "body_part03_120x80x45mm_12450tri.stl" */
  fileName: string;
  /** base64-encoded file content */
  base64: string;
  /** MIME type */
  mimeType: string;
  /** Part metadata stored as custom GCS metadata */
  partMeta?: {
    partIndex?: number;
    label?: string;
    triangleCount?: number;
    volumeMM3?: number;
    bboxX?: number;
    bboxY?: number;
    bboxZ?: number;
  };
}

export interface BatchUploadResult {
  jobId: string;
  uploaded: number;
  failed: number;
  errors: string[];
  paths: string[];
}

/**
 * Upload the original file + all sliced parts in a single server action call.
 * Files are grouped under: Karaslice/jobs/<user>/<jobId>/original/ and /parts/
 * Uploads are throttled to UPLOAD_CONCURRENCY at a time to avoid overwhelming GCS.
 */
export async function batchUploadJob(
  originalFile: { fileName: string; base64: string; mimeType: string } | null,
  parts: BatchUploadEntry[],
  existingJobId?: string,
): Promise<BatchUploadResult> {
  const session = await auth();
  if (!session?.user) throw new Error("Authentication required");

  const folder = userFolder(session.user.email, session.user.id);
  const storage = getAdminStorage();
  const bucket = storage.bucket();
  const jobId = existingJobId || generateJobId();
  const jobBase = `${BUCKET_FOLDER}/jobs/${folder}/${jobId}`;

  const paths: string[] = [];
  const errors: string[] = [];
  let uploaded = 0;
  let failed = 0;

  // Helper to upload a single file with error handling
  const uploadOne = async (
    gcsPath: string,
    buffer: Buffer,
    mimeType: string,
    meta: Record<string, string>,
  ) => {
    try {
      await bucket.file(gcsPath).save(buffer, {
        contentType: mimeType,
        metadata: {
          uploadedBy: session.user?.email ?? session.user?.id ?? "unknown",
          userName: session.user?.name ?? "",
          uploadedAt: new Date().toISOString(),
          jobId,
          ...meta,
        },
      });
      paths.push(gcsPath);
      uploaded++;
    } catch (err) {
      failed++;
      errors.push(`${gcsPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 1. Upload original file first (if provided)
  if (originalFile) {
    const origPath = `${jobBase}/original/${originalFile.fileName}`;
    const origBuf = Buffer.from(originalFile.base64, "base64");
    await uploadOne(origPath, origBuf, originalFile.mimeType, {
      originalName: originalFile.fileName,
      fileType: "original",
    });
  }

  // 2. Upload parts with concurrency throttling
  const uploadPart = async (entry: BatchUploadEntry) => {
    const partPath = `${jobBase}/parts/${entry.fileName}`;
    const partBuf = Buffer.from(entry.base64, "base64");
    const meta: Record<string, string> = {
      originalName: entry.fileName,
      fileType: "part",
    };
    if (entry.partMeta) {
      if (entry.partMeta.partIndex != null) meta.partIndex = String(entry.partMeta.partIndex);
      if (entry.partMeta.label) meta.partLabel = entry.partMeta.label;
      if (entry.partMeta.triangleCount != null) meta.triangleCount = String(entry.partMeta.triangleCount);
      if (entry.partMeta.volumeMM3 != null) meta.volumeMM3 = String(Math.round(entry.partMeta.volumeMM3));
      if (entry.partMeta.bboxX != null) meta.bboxMM = `${Math.round(entry.partMeta.bboxX)}x${Math.round(entry.partMeta.bboxY!)}x${Math.round(entry.partMeta.bboxZ!)}`;
    }
    await uploadOne(partPath, partBuf, entry.mimeType, meta);
  };

  // Process parts in batches of UPLOAD_CONCURRENCY
  for (let i = 0; i < parts.length; i += UPLOAD_CONCURRENCY) {
    const batch = parts.slice(i, i + UPLOAD_CONCURRENCY);
    await Promise.all(batch.map(uploadPart));
  }

  return { jobId, uploaded, failed, errors, paths };
}

// ─── List ────────────────────────────────────────────────────────────────────

export interface KarasliceFile {
  path: string;
  name: string;
  originalName: string;
  subfolder: string;
  size: number;
  uploadedAt: string;
  jobId?: string;
  fileType?: "original" | "part";
  partMeta?: {
    partIndex?: number;
    partLabel?: string;
    triangleCount?: number;
    bboxMM?: string;
  };
}

export interface KarasliceJob {
  jobId: string;
  uploadedAt: string;
  original?: KarasliceFile;
  parts: KarasliceFile[];
}

export async function listKarasliceFiles(): Promise<KarasliceFile[]> {
  const session = await auth();
  if (!session?.user) throw new Error("Authentication required");

  const folder = userFolder(session.user.email, session.user.id);
  const storage = getAdminStorage();
  const bucket = storage.bucket();

  const results: KarasliceFile[] = [];

  // Legacy flat layout
  for (const subfolder of ["uploads", "exports"] as const) {
    const prefix = `${BUCKET_FOLDER}/${subfolder}/${folder}/`;
    const [files] = await bucket.getFiles({ prefix });

    for (const file of files) {
      const meta = file.metadata;
      const customMeta = meta.metadata as Record<string, string> | undefined;
      results.push({
        path: file.name,
        name: file.name.split("/").pop() ?? file.name,
        originalName: customMeta?.originalName ?? file.name.split("/").pop() ?? "",
        subfolder,
        size: Number(meta.size ?? 0),
        uploadedAt: customMeta?.uploadedAt ?? meta.timeCreated ?? "",
      });
    }
  }

  // Job-based layout
  const jobPrefix = `${BUCKET_FOLDER}/jobs/${folder}/`;
  const [jobFiles] = await bucket.getFiles({ prefix: jobPrefix });

  for (const file of jobFiles) {
    const meta = file.metadata;
    const customMeta = meta.metadata as Record<string, string> | undefined;
    // Extract job ID and subfolder from path: Karaslice/jobs/<user>/<jobId>/<original|parts>/<file>
    const relative = file.name.slice(jobPrefix.length); // <jobId>/<original|parts>/<file>
    const segments = relative.split("/");
    const jobId = segments[0];
    const subfolder = segments[1] ?? "parts"; // "original" or "parts"

    const entry: KarasliceFile = {
      path: file.name,
      name: file.name.split("/").pop() ?? file.name,
      originalName: customMeta?.originalName ?? file.name.split("/").pop() ?? "",
      subfolder,
      size: Number(meta.size ?? 0),
      uploadedAt: customMeta?.uploadedAt ?? meta.timeCreated ?? "",
      jobId,
      fileType: (customMeta?.fileType as "original" | "part") ?? (subfolder === "original" ? "original" : "part"),
    };

    if (customMeta?.partIndex || customMeta?.partLabel || customMeta?.triangleCount) {
      entry.partMeta = {
        partIndex: customMeta.partIndex ? Number(customMeta.partIndex) : undefined,
        partLabel: customMeta.partLabel,
        triangleCount: customMeta.triangleCount ? Number(customMeta.triangleCount) : undefined,
        bboxMM: customMeta.bboxMM,
      };
    }

    results.push(entry);
  }

  // Sort newest first
  results.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return results;
}

/** Group flat file list into jobs for UI display (async wrapper for "use server" compat). */
export async function groupFilesByJob(files: KarasliceFile[]): Promise<KarasliceJob[]> {
  const jobMap = new Map<string, KarasliceJob>();

  for (const f of files) {
    if (!f.jobId) continue;
    let job = jobMap.get(f.jobId);
    if (!job) {
      job = { jobId: f.jobId, uploadedAt: f.uploadedAt, parts: [] };
      jobMap.set(f.jobId, job);
    }
    if (f.fileType === "original") {
      job.original = f;
    } else {
      job.parts.push(f);
    }
    if (f.uploadedAt < job.uploadedAt) job.uploadedAt = f.uploadedAt;
  }

  for (const job of jobMap.values()) {
    job.parts.sort((a, b) => (a.partMeta?.partIndex ?? 0) - (b.partMeta?.partIndex ?? 0));
  }

  return Array.from(jobMap.values()).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

// ─── Download (signed URL) ───────────────────────────────────────────────────

export async function getKarasliceDownloadUrl(path: string): Promise<string> {
  const session = await auth();
  if (!session?.user) throw new Error("Authentication required");

  // Verify the file belongs to this user
  const folder = userFolder(session.user.email, session.user.id);
  if (!path.includes(`/${folder}/`)) {
    throw new Error("Access denied");
  }

  const storage = getAdminStorage();
  const bucket = storage.bucket();
  const file = bucket.file(path);

  const [url] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 15 * 60 * 1000, // 15 minutes
  });

  return url;
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export async function deleteKarasliceFile(path: string): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Authentication required");

  // Verify the file belongs to this user
  const folder = userFolder(session.user.email, session.user.id);
  if (!path.includes(`/${folder}/`)) {
    throw new Error("Access denied");
  }

  const storage = getAdminStorage();
  const bucket = storage.bucket();
  await bucket.file(path).delete();
}

/** Delete all files in a job. */
export async function deleteKarasliceJob(jobId: string): Promise<number> {
  const session = await auth();
  if (!session?.user) throw new Error("Authentication required");

  const folder = userFolder(session.user.email, session.user.id);
  const storage = getAdminStorage();
  const bucket = storage.bucket();
  const prefix = `${BUCKET_FOLDER}/jobs/${folder}/${jobId}/`;
  const [files] = await bucket.getFiles({ prefix });

  let deleted = 0;
  for (let i = 0; i < files.length; i += UPLOAD_CONCURRENCY) {
    const batch = files.slice(i, i + UPLOAD_CONCURRENCY);
    await Promise.all(batch.map((f) => f.delete().then(() => deleted++).catch(() => {})));
  }
  return deleted;
}
