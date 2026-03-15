import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
MAIN_PATH = ROOT / "main.py"


def load_main_module():
    for name in [
        "cloud_worker_main_test",
        "main",
        "google",
        "google.cloud",
        "google.cloud.storage",
        "google.cloud.firestore",
        "repair_pipeline",
        "boolean_split",
    ]:
        sys.modules.pop(name, None)

    google_mod = types.ModuleType("google")
    cloud_mod = types.ModuleType("google.cloud")
    storage_mod = types.ModuleType("google.cloud.storage")
    firestore_mod = types.ModuleType("google.cloud.firestore")
    storage_mod.Client = mock.Mock(name="StorageClient")
    firestore_mod.Client = mock.Mock(name="FirestoreClient")
    google_mod.cloud = cloud_mod
    cloud_mod.storage = storage_mod
    cloud_mod.firestore = firestore_mod

    repair_mod = types.ModuleType("repair_pipeline")
    repair_mod.run_repair_pipeline = mock.Mock(name="run_repair_pipeline")

    split_mod = types.ModuleType("boolean_split")
    split_mod.robust_split = mock.Mock(name="robust_split")

    sys.modules["google"] = google_mod
    sys.modules["google.cloud"] = cloud_mod
    sys.modules["google.cloud.storage"] = storage_mod
    sys.modules["google.cloud.firestore"] = firestore_mod
    sys.modules["repair_pipeline"] = repair_mod
    sys.modules["boolean_split"] = split_mod

    spec = importlib.util.spec_from_file_location("cloud_worker_main_test", MAIN_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeBlob:
    def __init__(self, path, exists=True, download_bytes=b"mesh-data"):
        self.path = path
        self._exists = exists
        self.download_bytes = download_bytes
        self.uploaded_files = []
        self.uploaded_strings = []

    def exists(self):
        return self._exists

    def download_to_filename(self, filename):
        Path(filename).write_bytes(self.download_bytes)

    def upload_from_filename(self, filename, content_type=None):
        self.uploaded_files.append((filename, content_type))

    def upload_from_string(self, content, content_type=None):
        self.uploaded_strings.append((content, content_type))


class FakeBucket:
    def __init__(self, existing=None):
        self.existing = existing or {}
        self.blobs = {}

    def blob(self, path):
        if path in self.existing:
            blob = self.existing[path]
        else:
            blob = self.blobs.get(path)
            if blob is None:
                blob = FakeBlob(path)
        self.blobs[path] = blob
        return blob


class MainAppTests(unittest.TestCase):
    def setUp(self):
        self.main = load_main_module()
        self.client = self.main.app.test_client()

    def test_health_returns_ok(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"status": "ok"})

    def test_repair_requires_job_id(self):
        response = self.client.post("/repair", json={"inputPath": "x"})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "Missing jobId"})

    def test_split_requires_cut_planes(self):
        response = self.client.post(
            "/split",
            json={"jobId": "job-1", "inputPath": "Karaslice/repair-jobs/user/job-1/input.stl"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "No cut planes provided"})

    def test_upload_outputs_only_uploads_existing_files(self):
        bucket = FakeBucket()
        with tempfile.TemporaryDirectory() as tmpdir:
            existing_file = Path(tmpdir) / "mesh.obj"
            existing_file.write_text("mesh")
            missing_file = Path(tmpdir) / "missing.obj"

            uploaded = self.main._upload_outputs(
                bucket,
                "Karaslice/repair-jobs/user/job-1",
                {
                    "mesh.obj": str(existing_file),
                    "missing.obj": str(missing_file),
                },
            )

        self.assertEqual(
            uploaded,
            {"mesh.obj": "Karaslice/repair-jobs/user/job-1/mesh.obj"},
        )
        self.assertEqual(
            bucket.blobs["Karaslice/repair-jobs/user/job-1/mesh.obj"].uploaded_files,
            [(str(existing_file), None)],
        )
        self.assertNotIn("Karaslice/repair-jobs/user/job-1/missing.obj", bucket.blobs)

    def test_repair_returns_404_when_input_blob_missing(self):
        input_path = "Karaslice/repair-jobs/user/job-404/input.obj"
        bucket = FakeBucket(existing={input_path: FakeBlob(input_path, exists=False)})
        storage_client = mock.Mock()
        storage_client.bucket.return_value = bucket

        with mock.patch.object(self.main, "get_storage_client", return_value=storage_client), \
             mock.patch.object(self.main, "update_job") as update_job:
            response = self.client.post(
                "/repair",
                json={"jobId": "job-404", "inputPath": input_path},
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json(), {"error": "Input not found"})
        update_job.assert_any_call("job-404", "running", mock.ANY)
        update_job.assert_any_call("job-404", "failed", {"error": f"Input not found: {input_path}"})

    def test_repair_success_uploads_outputs_and_report(self):
        input_path = "Karaslice/repair-jobs/user/job-1/input.obj"
        input_blob = FakeBlob(input_path, exists=True, download_bytes=b"input-mesh")
        bucket = FakeBucket(existing={input_path: input_blob})
        storage_client = mock.Mock()
        storage_client.bucket.return_value = bucket

        def fake_pipeline(input_file, output_dir, mode, params, progress_callback):
            progress_callback("repairing", "Working")
            repaired_path = Path(output_dir) / "repaired.obj"
            repaired_path.write_text("repaired")
            return {
                "output_files": {"repaired.obj": str(repaired_path)},
                "report": {"faces": 12},
            }

        with mock.patch.object(self.main, "get_storage_client", return_value=storage_client), \
             mock.patch.object(self.main, "run_repair_pipeline", side_effect=fake_pipeline), \
             mock.patch.object(self.main, "update_job") as update_job:
            response = self.client.post(
                "/repair",
                json={
                    "jobId": "job-1",
                    "inputPath": input_path,
                    "repairMode": "auto",
                    "params": {"keepNormals": True},
                },
            )

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["status"], "finished")
        self.assertEqual(
            data["outputPaths"],
            {
                "repaired.obj": "Karaslice/repair-jobs/user/job-1/repaired.obj",
                "repair_report.json": "Karaslice/repair-jobs/user/job-1/repair_report.json",
            },
        )
        self.assertEqual(data["report"], {"faces": 12})

        uploaded_blob = bucket.blobs["Karaslice/repair-jobs/user/job-1/repaired.obj"]
        self.assertEqual(len(uploaded_blob.uploaded_files), 1)

        report_blob = bucket.blobs["Karaslice/repair-jobs/user/job-1/repair_report.json"]
        self.assertEqual(report_blob.uploaded_strings[0][1], "application/json")
        self.assertEqual(json.loads(report_blob.uploaded_strings[0][0]), {"faces": 12})

        self.assertTrue(any(call.args[1] == "finished" for call in update_job.call_args_list))
        self.assertTrue(any(call.args[2].get("step") == "repairing" for call in update_job.call_args_list))

    def test_split_success_uploads_existing_parts_and_sets_storage_path(self):
        input_path = "Karaslice/repair-jobs/user/job-2/input.stl"
        input_blob = FakeBlob(input_path, exists=True, download_bytes=b"split-input")
        bucket = FakeBucket(existing={input_path: input_blob})
        storage_client = mock.Mock()
        storage_client.bucket.return_value = bucket

        def fake_split(input_file, cut_planes, output_dir, params, progress_callback):
            progress_callback("splitting", "Cutting")
            existing_part = Path(output_dir) / "part_000.stl"
            existing_part.write_text("part")
            missing_part = Path(output_dir) / "part_001.stl"
            return {
                "parts": [
                    {"fileName": "part_000.stl", "filePath": str(existing_part)},
                    {"fileName": "part_001.stl", "filePath": str(missing_part)},
                ],
                "report": {"output_parts": 2},
            }

        with mock.patch.object(self.main, "get_storage_client", return_value=storage_client), \
             mock.patch.object(self.main, "robust_split", side_effect=fake_split), \
             mock.patch.object(self.main, "update_job") as update_job:
            response = self.client.post(
                "/split",
                json={
                    "jobId": "job-2",
                    "inputPath": input_path,
                    "cutPlanes": [{"normal": [0, 1, 0], "origin": [0, 0, 0]}],
                    "params": {"capHoles": True},
                },
            )

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["status"], "finished")
        self.assertEqual(data["report"], {"output_parts": 2})
        self.assertEqual(
            data["parts"][0]["storagePath"],
            "Karaslice/repair-jobs/user/job-2/parts/part_000.stl",
        )
        self.assertNotIn("storagePath", data["parts"][1])

        uploaded_blob = bucket.blobs["Karaslice/repair-jobs/user/job-2/parts/part_000.stl"]
        self.assertEqual(len(uploaded_blob.uploaded_files), 1)

        report_blob = bucket.blobs["Karaslice/repair-jobs/user/job-2/split_report.json"]
        self.assertEqual(json.loads(report_blob.uploaded_strings[0][0]), {"output_parts": 2})

        self.assertTrue(any(call.args[1] == "finished" for call in update_job.call_args_list))
        self.assertTrue(any(call.args[2].get("step") == "splitting" for call in update_job.call_args_list))

    def test_repair_rejects_invalid_job_id_format(self):
        response = self.client.post(
            "/repair",
            json={"jobId": "../bad", "inputPath": "Karaslice/repair-jobs/user/job-1/input.stl"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "Invalid jobId format"})

    def test_repair_rejects_invalid_storage_path_prefix(self):
        response = self.client.post(
            "/repair",
            json={"jobId": "job-1", "inputPath": "repair-jobs/user/job-1/input.stl"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "Invalid path prefix"})

    def test_repair_rejects_invalid_repair_mode(self):
        response = self.client.post(
            "/repair",
            json={
                "jobId": "job-1",
                "inputPath": "Karaslice/repair-jobs/user/job-1/input.stl",
                "repairMode": "turbo",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "Invalid repair mode"})

    def test_split_rejects_excessive_cut_planes(self):
        response = self.client.post(
            "/split",
            json={
                "jobId": "job-1",
                "inputPath": "Karaslice/repair-jobs/user/job-1/input.stl",
                "cutPlanes": [{"normal": [0, 0, 1], "origin": [0, 0, 0]}] * 51,
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "Too many cut planes (max 50)"})

    def test_analyze_rejects_invalid_thresholds(self):
        response = self.client.post(
            "/analyze",
            json={
                "inputPath": "Karaslice/repair-jobs/user/job-1/input.stl",
                "overhangThresholdDeg": 120,
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "Invalid overhang threshold (0-90)"})

    def test_hollow_rejects_invalid_wall_thickness(self):
        response = self.client.post(
            "/hollow",
            json={
                "jobId": "job-1",
                "inputPath": "Karaslice/repair-jobs/user/job-1/input.stl",
                "wallThicknessMM": 0.05,
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "wallThicknessMM must be 0.1-50"})

    def test_hollow_rejects_too_many_escape_holes(self):
        response = self.client.post(
            "/hollow",
            json={
                "jobId": "job-1",
                "inputPath": "Karaslice/repair-jobs/user/job-1/input.stl",
                "escapeHoles": [{"position": [0, 0, 0], "radius": 2.0}] * 21,
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {"error": "Max 20 escape holes"})


if __name__ == "__main__":
    unittest.main()
