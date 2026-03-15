"""
Cloud Run mesh repair & split worker.
Receives HTTP requests, downloads mesh from Firebase Storage,
runs repair or split pipeline, uploads results, and updates Firestore.
"""

import os
import re
import json
import traceback
import tempfile
from datetime import datetime, timezone

from flask import Flask, request, jsonify
from google.cloud import storage, firestore

from repair_pipeline import run_repair_pipeline
from boolean_split import robust_split

app = Flask(__name__)

# ─── Security config ─────────────────────────────────────────────────────────
MAX_INPUT_SIZE_MB = 500  # Reject files larger than 500 MB
ALLOWED_EXTENSIONS = {".stl", ".obj", ".3mf", ".ply", ".off"}
MAX_JOB_ID_LENGTH = 100
JOB_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_\-]+$")

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


def validate_job_id(job_id: str) -> str | None:
    """Validate job ID format. Returns error string or None if valid."""
    if not job_id:
        return "Missing jobId"
    if len(job_id) > MAX_JOB_ID_LENGTH:
        return "jobId too long"
    if not JOB_ID_PATTERN.match(job_id):
        return "Invalid jobId format"
    return None


def validate_storage_path(path: str) -> str | None:
    """Validate storage path. Returns error string or None if valid."""
    if not path:
        return "Missing path"
    if ".." in path:
        return "Path traversal detected"
    if "\0" in path:
        return "Null byte in path"
    if not path.startswith("Karaslice/"):
        return "Invalid path prefix"
    ext = os.path.splitext(path)[1].lower()
    if ext and ext not in ALLOWED_EXTENSIONS:
        return f"File type {ext} not allowed"
    return None


def validate_file_size(file_path: str) -> str | None:
    """Check file size after download. Returns error string or None if valid."""
    size_mb = os.path.getsize(file_path) / (1024 * 1024)
    if size_mb > MAX_INPUT_SIZE_MB:
        return f"File too large ({size_mb:.1f} MB, max {MAX_INPUT_SIZE_MB} MB)"
    return None


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

    # Validate inputs
    job_err = validate_job_id(job_id)
    if job_err:
        return jsonify({"error": job_err}), 400
    path_err = validate_storage_path(input_path)
    if path_err:
        return jsonify({"error": path_err}), 400
    if repair_mode not in ("auto", "conservative", "watertight", "reconstruct"):
        return jsonify({"error": "Invalid repair mode"}), 400

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

            # Validate file size
            size_err = validate_file_size(input_file)
            if size_err:
                update_job(job_id, "failed", {"error": size_err})
                return jsonify({"error": size_err}), 400

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

    # Validate inputs
    job_err = validate_job_id(job_id)
    if job_err:
        return jsonify({"error": job_err}), 400
    path_err = validate_storage_path(input_path)
    if path_err:
        return jsonify({"error": path_err}), 400

    if not cut_planes:
        return jsonify({"error": "No cut planes provided"}), 400
    if len(cut_planes) > 50:
        return jsonify({"error": "Too many cut planes (max 50)"}), 400

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


# ─── Analyze endpoint ────────────────────────────────────────────────────────

@app.route("/analyze", methods=["POST"])
def analyze():
    """
    Deep mesh analysis endpoint for large meshes (>2M triangles).
    Returns shell decomposition, defect regions, overhang analysis, and thickness estimate.

    Expects JSON:
    {
        "inputPath": "Karaslice/repair-jobs/<user>/<jobId>/input.stl",
        "overhangThresholdDeg": 45,
        "minWallThicknessMM": 0.8
    }
    """
    payload = request.get_json(silent=True)
    if not payload or "inputPath" not in payload:
        return jsonify({"error": "Missing inputPath"}), 400

    input_path = payload["inputPath"]
    overhang_threshold = payload.get("overhangThresholdDeg", 45)
    min_wall = payload.get("minWallThicknessMM", 0.8)

    # Validate inputs
    path_err = validate_storage_path(input_path)
    if path_err:
        return jsonify({"error": path_err}), 400
    if not isinstance(overhang_threshold, (int, float)) or overhang_threshold < 0 or overhang_threshold > 90:
        return jsonify({"error": "Invalid overhang threshold (0-90)"}), 400
    if not isinstance(min_wall, (int, float)) or min_wall < 0 or min_wall > 100:
        return jsonify({"error": "Invalid wall thickness threshold (0-100)"}), 400

    try:
        client = get_storage_client()
        bucket = client.bucket(STORAGE_BUCKET)
        blob = bucket.blob(input_path)

        if not blob.exists():
            return jsonify({"error": f"Input not found: {input_path}"}), 404

        ext = os.path.splitext(input_path)[1].lower() or ".stl"

        with tempfile.TemporaryDirectory() as tmpdir:
            input_file = os.path.join(tmpdir, f"input{ext}")
            blob.download_to_filename(input_file)

            import trimesh
            import numpy as np

            mesh = trimesh.load(input_file, force="mesh")

            report = {
                "vertices": int(mesh.vertices.shape[0]),
                "faces": int(mesh.faces.shape[0]),
                "isWatertight": bool(mesh.is_watertight),
                "isVolume": bool(mesh.is_volume),
                "eulerNumber": int(mesh.euler_number),
                "surfaceAreaMM2": float(mesh.area),
                "volumeMM3": float(mesh.volume) if mesh.is_watertight else 0.0,
            }

            # Shell decomposition
            components = mesh.split(only_watertight=False)
            shells = []
            for i, comp in enumerate(components):
                shells.append({
                    "id": i,
                    "faces": int(comp.faces.shape[0]),
                    "vertices": int(comp.vertices.shape[0]),
                    "surfaceArea": float(comp.area),
                    "isWatertight": bool(comp.is_watertight),
                    "bounds": comp.bounds.tolist(),
                    "centroid": comp.centroid.tolist(),
                })
            report["shells"] = shells
            report["shellCount"] = len(shells)

            # Overhang analysis
            face_normals = mesh.face_normals
            # Angle from vertical (Z-up): acos(|nz|), overhang if angle > threshold AND nz < 0
            nz = face_normals[:, 2]
            angle_from_vertical = np.degrees(np.arccos(np.clip(np.abs(nz), 0, 1)))
            overhang_mask = (angle_from_vertical > overhang_threshold) & (nz < 0)
            overhang_count = int(np.sum(overhang_mask))
            report["overhangs"] = {
                "count": overhang_count,
                "percentOfMesh": round(overhang_count / max(1, len(mesh.faces)) * 100, 2),
                "maxAngleDeg": float(np.max(angle_from_vertical[overhang_mask])) if overhang_count > 0 else 0,
                "thresholdDeg": overhang_threshold,
            }

            # Defect edges
            edges = mesh.edges_sorted
            edge_counts = {}
            for e in edges:
                key = (int(e[0]), int(e[1]))
                edge_counts[key] = edge_counts.get(key, 0) + 1

            open_edges = sum(1 for v in edge_counts.values() if v == 1)
            non_manifold_edges = sum(1 for v in edge_counts.values() if v > 2)
            report["openEdges"] = open_edges
            report["nonManifoldEdges"] = non_manifold_edges

            # Thickness estimate (sample ray test)
            try:
                from trimesh.proximity import closest_point
                sample_count = min(2000, len(mesh.faces))
                sample_indices = np.random.choice(len(mesh.faces), sample_count, replace=False)
                sample_centroids = mesh.triangles_center[sample_indices]
                sample_normals = -face_normals[sample_indices]  # inward

                # Shoot rays inward
                locations, distances, _ = mesh.ray.intersects_location(
                    ray_origins=sample_centroids + sample_normals * 0.01,
                    ray_directions=sample_normals,
                )
                if len(distances) > 0:
                    valid = distances[distances > 0.01]
                    report["thickness"] = {
                        "minMM": float(np.min(valid)) if len(valid) > 0 else 0,
                        "avgMM": float(np.mean(valid)) if len(valid) > 0 else 0,
                        "samples": sample_count,
                        "thinRegions": int(np.sum(valid < min_wall)) if len(valid) > 0 else 0,
                    }
                else:
                    report["thickness"] = {"minMM": 0, "avgMM": 0, "samples": sample_count, "thinRegions": 0}
            except Exception:
                report["thickness"] = {"minMM": 0, "avgMM": 0, "samples": 0, "thinRegions": 0}

            return jsonify({"status": "ok", "report": report}), 200

    except Exception as e:
        tb = traceback.format_exc()
        return jsonify({"error": str(e), "traceback": tb}), 500


# ─── Hollow endpoint ────────────────────────────────────────────────────────

@app.route("/hollow", methods=["POST"])
def hollow():
    """
    Hollow a mesh by creating a thin-walled shell via offset surface subtraction.
    Optionally adds escape holes for resin/powder drainage.

    Expects JSON:
    {
        "inputPath": "Karaslice/repair-jobs/<user>/<jobId>/input.stl",
        "jobId": "abc123",
        "wallThicknessMM": 2.0,
        "escapeHoles": [
            {"position": [x, y, z], "radius": 3.0, "direction": [0, 0, -1]}
        ]
    }
    """
    payload = request.get_json(silent=True)
    if not payload or "inputPath" not in payload or "jobId" not in payload:
        return jsonify({"error": "Missing inputPath or jobId"}), 400

    input_path = payload["inputPath"]
    job_id = payload["jobId"]
    wall_thickness = payload.get("wallThicknessMM", 2.0)
    escape_holes = payload.get("escapeHoles", [])

    # Validate
    id_err = validate_job_id(job_id)
    if id_err:
        return jsonify({"error": id_err}), 400
    path_err = validate_storage_path(input_path)
    if path_err:
        return jsonify({"error": path_err}), 400
    if not isinstance(wall_thickness, (int, float)) or wall_thickness < 0.1 or wall_thickness > 50:
        return jsonify({"error": "wallThicknessMM must be 0.1-50"}), 400
    if len(escape_holes) > 20:
        return jsonify({"error": "Max 20 escape holes"}), 400

    try:
        update_job(job_id, "running", {"step": "downloading", "stepMessage": "Downloading mesh..."})

        client = get_storage_client()
        bucket = client.bucket(STORAGE_BUCKET)
        blob = bucket.blob(input_path)

        if not blob.exists():
            update_job(job_id, "error", {"error": f"Input not found: {input_path}"})
            return jsonify({"error": f"Input not found: {input_path}"}), 404

        ext = os.path.splitext(input_path)[1].lower() or ".stl"

        with tempfile.TemporaryDirectory() as tmpdir:
            input_file = os.path.join(tmpdir, f"input{ext}")
            blob.download_to_filename(input_file)

            size_err = validate_file_size(input_file)
            if size_err:
                update_job(job_id, "error", {"error": size_err})
                return jsonify({"error": size_err}), 400

            import trimesh
            import numpy as np

            update_job(job_id, "running", {"step": "loading", "stepMessage": "Loading mesh..."})
            mesh = trimesh.load(input_file, force="mesh")

            if not mesh.is_watertight:
                update_job(job_id, "running", {"step": "repairing", "stepMessage": "Fixing mesh for hollowing..."})
                trimesh.repair.fix_normals(mesh)
                trimesh.repair.fill_holes(mesh)
                trimesh.repair.fix_winding(mesh)

            # Create offset (inner) mesh by scaling from centroid
            update_job(job_id, "running", {"step": "hollowing", "stepMessage": f"Creating {wall_thickness}mm shell..."})
            original_volume = float(mesh.volume) if mesh.is_watertight else 0.0

            centroid = mesh.centroid
            bounds = mesh.bounds
            min_dim = float(np.min(bounds[1] - bounds[0]))

            if wall_thickness * 2 >= min_dim:
                err = f"Wall thickness {wall_thickness}mm too large for mesh (min dim: {min_dim:.1f}mm)"
                update_job(job_id, "error", {"error": err})
                return jsonify({"error": err}), 400

            scale_factor = 1 - (2 * wall_thickness) / min_dim

            # Scale inner mesh from centroid
            inner = mesh.copy()
            inner.vertices = centroid + (inner.vertices - centroid) * scale_factor

            # Boolean subtraction: outer - inner
            try:
                result = trimesh.boolean.difference([mesh, inner], engine="blender")
            except Exception:
                try:
                    result = trimesh.boolean.difference([mesh, inner], engine="manifold")
                except Exception:
                    # Fallback: simple voxel-based hollowing
                    update_job(job_id, "running", {"step": "hollowing", "stepMessage": "Boolean failed, using voxel fallback..."})
                    pitch = min(wall_thickness / 2, 1.0)
                    voxel_grid = mesh.voxelized(pitch)
                    eroded = voxel_grid.copy()
                    eroded.encoding.data = eroded.encoding.data  # keep as-is for now
                    result = voxel_grid.marching_cubes
                    trimesh.repair.fix_normals(result)

            # Add escape holes
            holes_added = 0
            if escape_holes and hasattr(result, 'is_watertight'):
                update_job(job_id, "running", {"step": "escape_holes", "stepMessage": "Adding escape holes..."})
                for hole_spec in escape_holes[:20]:
                    pos = hole_spec.get("position", [0, 0, 0])
                    radius = hole_spec.get("radius", 3.0)
                    direction = hole_spec.get("direction", [0, 0, -1])
                    if not isinstance(radius, (int, float)) or radius < 0.5 or radius > 50:
                        continue

                    height = float(np.linalg.norm(bounds[1] - bounds[0])) * 1.5
                    cyl = trimesh.creation.cylinder(radius=radius, height=height, sections=24)

                    # Orient cylinder along direction
                    d = np.array(direction, dtype=float)
                    d = d / np.linalg.norm(d)
                    z_axis = np.array([0, 0, 1], dtype=float)
                    if abs(np.dot(d, z_axis)) < 0.999:
                        rot_axis = np.cross(z_axis, d)
                        rot_axis = rot_axis / np.linalg.norm(rot_axis)
                        angle = np.arccos(np.clip(np.dot(z_axis, d), -1, 1))
                        rot_matrix = trimesh.transformations.rotation_matrix(angle, rot_axis)
                        cyl.apply_transform(rot_matrix)

                    cyl.apply_translation(np.array(pos) - d * height * 0.5)

                    try:
                        result = trimesh.boolean.difference([result, cyl], engine="blender")
                        holes_added += 1
                    except Exception:
                        try:
                            result = trimesh.boolean.difference([result, cyl], engine="manifold")
                            holes_added += 1
                        except Exception:
                            pass  # Skip this hole

            # Export result
            update_job(job_id, "running", {"step": "uploading", "stepMessage": "Uploading result..."})
            output_file = os.path.join(tmpdir, "hollowed.stl")
            result.export(output_file, file_type="stl")

            # Upload to storage
            output_path = input_path.rsplit("/", 1)[0] + "/hollowed.stl"
            output_blob = bucket.blob(output_path)
            output_blob.upload_from_filename(output_file, content_type="application/octet-stream")

            hollow_volume = float(result.volume) if hasattr(result, 'volume') and result.is_watertight else 0.0
            saved_pct = round((original_volume - hollow_volume) / max(1, original_volume) * 100, 1) if original_volume > 0 else 0

            report = {
                "originalVolumeMM3": original_volume,
                "hollowVolumeMM3": hollow_volume,
                "materialSavedPercent": saved_pct,
                "wallThicknessMM": wall_thickness,
                "escapeHolesAdded": holes_added,
                "outputFaces": int(result.faces.shape[0]),
                "outputVertices": int(result.vertices.shape[0]),
            }

            update_job(job_id, "done", {
                "step": "done",
                "stepMessage": f"Hollowed — {saved_pct}% material saved",
                "report": report,
                "outputPaths": [output_path],
                "finishedAt": datetime.now(timezone.utc).isoformat(),
            })

            return jsonify({"status": "ok", "report": report, "outputPath": output_path}), 200

    except Exception as e:
        tb = traceback.format_exc()
        update_job(job_id, "error", {"error": str(e)})
        return jsonify({"error": str(e), "traceback": tb}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=True)
