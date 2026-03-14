"""
Cloud Run mesh repair & split worker.
Receives HTTP requests, downloads mesh from Firebase Storage,
runs repair or split pipeline, uploads results, and updates Firestore.
"""

import os
import json
import traceback
import tempfile
from datetime import datetime, timezone

from flask import Flask, request, jsonify
from google.cloud import storage, firestore

from repair_pipeline import run_repair_pipeline
from boolean_split import robust_split

app = Flask(__name__)

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "studio-4705021877-a1dff")
STORAGE_BUCKET = os.environ.get("STORAGE_BUCKET", "studio-4705021877-a1dff.firebasestorage.app")
FIRESTORE_COLLECTION = "repair_jobs"


def get_storage_client():
    return storage.Client(project=PROJECT_ID)


def get_firestore_client():
    return firestore.Client(project=PROJECT_ID)


def update_job(job_id: str, status: str, extra: dict | None = None):
    """Update Firestore job document."""
    db = get_firestore_client()
    doc_ref = db.collection(FIRESTORE_COLLECTION).document(job_id)
    data = {"status": status, "updatedAt": datetime.now(timezone.utc).isoformat()}
    if extra:
        data.update(extra)
    doc_ref.update(data)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200


# ─── Repair endpoint ─────────────────────────────────────────────────────────

@app.route("/repair", methods=["POST"])
def repair():
    """
    Main repair endpoint. Expects JSON:
    {
        "jobId": "...",
        "inputPath": "Karaslice/repair-jobs/<user>/<jobId>/input.obj",
        "repairMode": "auto" | "conservative" | "watertight" | "reconstruct",
        "params": { ... }
    }
    """
    payload = request.get_json(silent=True)
    if not payload or "jobId" not in payload:
        return jsonify({"error": "Missing jobId"}), 400

    job_id = payload["jobId"]
    input_path = payload.get("inputPath", "")
    repair_mode = payload.get("repairMode", "auto")
    params = payload.get("params", {})

    try:
        update_job(job_id, "running", {"startedAt": datetime.now(timezone.utc).isoformat()})

        client = get_storage_client()
        bucket = client.bucket(STORAGE_BUCKET)
        blob = bucket.blob(input_path)

        if not blob.exists():
            update_job(job_id, "failed", {"error": f"Input not found: {input_path}"})
            return jsonify({"error": "Input not found"}), 404

        ext = os.path.splitext(input_path)[1].lower() or ".obj"

        with tempfile.TemporaryDirectory() as tmpdir:
            input_file = os.path.join(tmpdir, f"input{ext}")
            blob.download_to_filename(input_file)

            update_job(job_id, "running", {"step": "downloaded", "inputSizeBytes": os.path.getsize(input_file)})

            result = run_repair_pipeline(
                input_file=input_file,
                output_dir=tmpdir,
                mode=repair_mode,
                params=params,
                progress_callback=lambda step, msg: update_job(job_id, "running", {"step": step, "stepMessage": msg}),
            )

            # Upload outputs
            output_base = f"Karaslice/repair-jobs/{'/'.join(input_path.split('/')[2:-1])}"
            uploaded = _upload_outputs(bucket, output_base, result.get("output_files", {}))

            # Upload report
            report = result.get("report", {})
            report_path = f"{output_base}/repair_report.json"
            bucket.blob(report_path).upload_from_string(json.dumps(report, indent=2), content_type="application/json")
            uploaded["repair_report.json"] = report_path

            update_job(job_id, "finished", {
                "finishedAt": datetime.now(timezone.utc).isoformat(),
                "outputPaths": uploaded,
                "report": report,
            })

            return jsonify({"status": "finished", "jobId": job_id, "outputPaths": uploaded, "report": report}), 200

    except Exception as e:
        tb = traceback.format_exc()
        update_job(job_id, "failed", {"error": str(e), "traceback": tb, "finishedAt": datetime.now(timezone.utc).isoformat()})
        return jsonify({"error": str(e)}), 500


# ─── Split endpoint ──────────────────────────────────────────────────────────

@app.route("/split", methods=["POST"])
def split():
    """
    Boolean split endpoint. Expects JSON:
    {
        "jobId": "...",
        "inputPath": "Karaslice/repair-jobs/<user>/<jobId>/input.stl",
        "cutPlanes": [{"normal": [0,1,0], "origin": [0, 50, 0]}, ...],
        "params": { "capHoles": true, "perturbEpsilon": 1e-5 }
    }
    """
    payload = request.get_json(silent=True)
    if not payload or "jobId" not in payload:
        return jsonify({"error": "Missing jobId"}), 400

    job_id = payload["jobId"]
    input_path = payload.get("inputPath", "")
    cut_planes = payload.get("cutPlanes", [])
    params = payload.get("params", {})

    if not cut_planes:
        return jsonify({"error": "No cut planes provided"}), 400

    try:
        update_job(job_id, "running", {
            "jobType": "split",
            "startedAt": datetime.now(timezone.utc).isoformat(),
        })

        client = get_storage_client()
        bucket = client.bucket(STORAGE_BUCKET)
        blob = bucket.blob(input_path)

        if not blob.exists():
            update_job(job_id, "failed", {"error": f"Input not found: {input_path}"})
            return jsonify({"error": "Input not found"}), 404

        ext = os.path.splitext(input_path)[1].lower() or ".stl"

        with tempfile.TemporaryDirectory() as tmpdir:
            input_file = os.path.join(tmpdir, f"input{ext}")
            blob.download_to_filename(input_file)

            update_job(job_id, "running", {"step": "downloaded", "inputSizeBytes": os.path.getsize(input_file)})

            result = robust_split(
                input_file=input_file,
                cut_planes=cut_planes,
                output_dir=tmpdir,
                params=params,
                progress_callback=lambda step, msg: update_job(job_id, "running", {"step": step, "stepMessage": msg}),
            )

            # Upload each part
            output_base = f"Karaslice/repair-jobs/{'/'.join(input_path.split('/')[2:-1])}"
            uploaded = {}

            for part in result.get("parts", []):
                part_file = part["filePath"]
                part_name = part["fileName"]
                if os.path.exists(part_file):
                    blob_path = f"{output_base}/parts/{part_name}"
                    bucket.blob(blob_path).upload_from_filename(part_file)
                    uploaded[part_name] = blob_path
                    part["storagePath"] = blob_path

            # Upload split report
            report = result.get("report", {})
            report_path = f"{output_base}/split_report.json"
            bucket.blob(report_path).upload_from_string(json.dumps(report, indent=2), content_type="application/json")
            uploaded["split_report.json"] = report_path

            update_job(job_id, "finished", {
                "jobType": "split",
                "finishedAt": datetime.now(timezone.utc).isoformat(),
                "outputPaths": uploaded,
                "parts": result.get("parts", []),
                "report": report,
            })

            return jsonify({
                "status": "finished",
                "jobId": job_id,
                "parts": result.get("parts", []),
                "report": report,
            }), 200

    except Exception as e:
        tb = traceback.format_exc()
        update_job(job_id, "failed", {"error": str(e), "traceback": tb, "finishedAt": datetime.now(timezone.utc).isoformat()})
        return jsonify({"error": str(e)}), 500


def _upload_outputs(bucket, base_path: str, output_files: dict) -> dict:
    """Upload output files to Storage, return name → path mapping."""
    uploaded = {}
    for name, local_path in output_files.items():
        if os.path.exists(local_path):
            blob_path = f"{base_path}/{name}"
            bucket.blob(blob_path).upload_from_filename(local_path)
            uploaded[name] = blob_path
    return uploaded


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=True)
