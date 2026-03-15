import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { apiLimiter } from "@/lib/security";

const COLLECTION = "repair_jobs";

/** Extract client IP for rate limiting. */
function getClientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
}

/** Allowed fields that the Cloud Run worker can update via PATCH. */
const ALLOWED_PATCH_FIELDS = new Set([
  "status", "step", "stepMessage", "error", "report",
  "outputPaths", "startedAt", "finishedAt", "jobType",
  "inputSizeBytes", "parts",
]);

/**
 * GET /api/repair-job/[jobId]
 * Public status endpoint — used by the Cloud Run worker and client polling.
 * Returns job status without requiring auth (jobId acts as bearer token).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  // Rate limit by IP
  const ip = getClientIp(req);
  const rateCheck = apiLimiter.check(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { jobId } = await params;
  if (!jobId || jobId.length > 100) {
    return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
  }

  // Reject suspicious jobId patterns
  if (/[^a-zA-Z0-9_\-]/.test(jobId)) {
    return NextResponse.json({ error: "Invalid jobId format" }, { status: 400 });
  }

  const db = getAdminFirestore();
  const doc = await db.collection(COLLECTION).doc(jobId).get();

  if (!doc.exists) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const data = doc.data()!;
  return NextResponse.json({
    jobId: data.jobId,
    status: data.status,
    step: data.step,
    stepMessage: data.stepMessage,
    error: data.error,
    report: data.report,
    outputPaths: data.outputPaths,
    startedAt: data.startedAt,
    finishedAt: data.finishedAt,
  });
}

/**
 * PATCH /api/repair-job/[jobId]
 * Called by the Cloud Run worker to update job status.
 * Only allows whitelisted fields to prevent arbitrary data injection.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  // Rate limit by IP
  const ip = getClientIp(req);
  const rateCheck = apiLimiter.check(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { jobId } = await params;
  if (!jobId || jobId.length > 100) {
    return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
  }

  if (/[^a-zA-Z0-9_\-]/.test(jobId)) {
    return NextResponse.json({ error: "Invalid jobId format" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Whitelist: only allow known fields to be updated
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_PATCH_FIELDS.has(key)) {
      sanitized[key] = value;
    }
  }

  if (Object.keys(sanitized).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const db = getAdminFirestore();
  const docRef = db.collection(COLLECTION).doc(jobId);
  const doc = await docRef.get();

  if (!doc.exists) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  await docRef.update({
    ...sanitized,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
