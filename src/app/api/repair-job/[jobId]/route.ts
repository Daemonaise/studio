import { NextRequest, NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";

const COLLECTION = "repair_jobs";

/**
 * GET /api/repair-job/[jobId]
 * Public status endpoint — used by the Cloud Run worker and client polling.
 * Returns job status without requiring auth (jobId acts as bearer token).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
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
 * Accepts JSON body with status fields to merge.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const body = await req.json();
  const db = getAdminFirestore();
  const docRef = db.collection(COLLECTION).doc(jobId);
  const doc = await docRef.get();

  if (!doc.exists) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  await docRef.update({
    ...body,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
