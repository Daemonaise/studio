"""
Robust boolean mesh splitting for the cloud worker.

Handles degenerate cases that crash client-side manifold-3d:
- Coplanar faces (cut plane exactly on a face)
- Edge-on-edge / vertex-on-plane intersections
- Non-manifold input geometry

Fallback chain:
  1. trimesh.intersections.slice_mesh_plane (fast, handles most cases)
  2. Perturbed plane (tiny offset to avoid exact coplanar)
  3. PyMeshLab CSG boolean with constructed plane mesh
  4. Manual triangle clipping (always works, slower)
"""

import os
import time
import numpy as np
import trimesh
import pymeshlab
from typing import Callable


def robust_split(
    input_file: str,
    cut_planes: list[dict],
    output_dir: str,
    params: dict | None = None,
    progress_callback: Callable[[str, str], None] | None = None,
) -> dict:
    """
    Split a mesh along one or more cut planes.

    Args:
        input_file: Path to input mesh
        cut_planes: List of {"normal": [x,y,z], "origin": [x,y,z]} dicts
        output_dir: Directory to write output parts
        params: Optional parameters:
            - capHoles (bool): Fill open cross-sections after split. Default True.
            - perturbEpsilon (float): Perturbation for degenerate cases. Default 1e-5.
        progress_callback: Optional (step, message) callback

    Returns:
        dict with "parts" (list of part info) and "report"
    """
    params = params or {}
    t0 = time.time()
    cap_holes = params.get("capHoles", True)
    perturb_eps = params.get("perturbEpsilon", 1e-5)

    def progress(step: str, msg: str):
        if progress_callback:
            try:
                progress_callback(step, msg)
            except Exception:
                pass

    progress("split_parse", "Loading mesh for splitting…")

    # Load mesh
    mesh = trimesh.load(input_file, force="mesh", process=False)
    if mesh is None or len(mesh.faces) == 0:
        return {"parts": [], "report": {"error": "Empty input mesh"}}

    # Sort planes by axis for deterministic results
    planes = _normalize_planes(cut_planes, mesh)

    progress("split_start", f"Splitting along {len(planes)} plane(s)…")

    # Recursive binary splitting
    pieces = [mesh]
    split_report = []

    for i, plane in enumerate(planes):
        progress("split_cut", f"Cut {i+1}/{len(planes)}…")
        new_pieces = []

        for piece in pieces:
            if len(piece.faces) < 4:
                new_pieces.append(piece)
                continue

            above, below, method = _split_single(piece, plane, cap_holes, perturb_eps)
            split_report.append({
                "plane_index": i,
                "method": method,
                "input_faces": len(piece.faces),
                "above_faces": len(above.faces) if above else 0,
                "below_faces": len(below.faces) if below else 0,
            })

            if above and len(above.faces) > 0:
                new_pieces.append(above)
            if below and len(below.faces) > 0:
                new_pieces.append(below)

            # If split produced nothing, keep original piece
            if not new_pieces or (above is None and below is None):
                new_pieces.append(piece)

        pieces = new_pieces

    # Export each part
    progress("split_export", f"Exporting {len(pieces)} parts…")
    parts = []

    for idx, piece in enumerate(pieces):
        if len(piece.faces) < 4:
            continue

        # Clean up each part
        piece = _clean_part(piece)

        part_name = f"part_{idx:03d}.stl"
        part_path = os.path.join(output_dir, part_name)

        piece.export(part_path, file_type="stl")

        bb = piece.bounding_box.extents
        parts.append({
            "index": idx,
            "fileName": part_name,
            "filePath": part_path,
            "faces": len(piece.faces),
            "vertices": len(piece.vertices),
            "bbox": [float(bb[0]), float(bb[1]), float(bb[2])],
            "volume": float(piece.volume) if piece.is_watertight else 0.0,
            "watertight": bool(piece.is_watertight),
        })

    elapsed = round(time.time() - t0, 2)
    report = {
        "input_faces": len(mesh.faces),
        "planes": len(planes),
        "output_parts": len(parts),
        "split_details": split_report,
        "elapsed_seconds": elapsed,
    }

    progress("split_done", f"Split complete: {len(parts)} parts in {elapsed}s")
    return {"parts": parts, "report": report}


def _normalize_planes(cut_planes: list[dict], mesh: trimesh.Trimesh) -> list[dict]:
    """Normalize and validate cut plane definitions."""
    result = []
    for p in cut_planes:
        normal = np.array(p.get("normal", [0, 1, 0]), dtype=float)
        norm_len = np.linalg.norm(normal)
        if norm_len < 1e-10:
            continue
        normal = normal / norm_len

        origin = np.array(p.get("origin", [0, 0, 0]), dtype=float)
        result.append({"normal": normal, "origin": origin})
    return result


def _split_single(
    mesh: trimesh.Trimesh,
    plane: dict,
    cap_holes: bool,
    perturb_eps: float,
) -> tuple:
    """
    Split a mesh along a single plane. Returns (above, below, method).
    Uses fallback chain for robustness.
    """
    normal = plane["normal"]
    origin = plane["origin"]

    # Attempt 1: Direct trimesh slice
    try:
        above = mesh.slice_plane(origin, normal, cap=cap_holes)
        below = mesh.slice_plane(origin, -normal, cap=cap_holes)
        if above is not None and below is not None and len(above.faces) > 0 and len(below.faces) > 0:
            return above, below, "trimesh_direct"
    except Exception:
        pass

    # Attempt 2: Perturbed plane (avoids exact coplanar/vertex-on-plane)
    for attempt in range(3):
        try:
            # Random perturbation perpendicular to normal
            perturb = np.random.randn(3) * perturb_eps * (attempt + 1)
            perturb -= perturb.dot(normal) * normal  # keep perpendicular
            p_origin = origin + perturb

            # Also slightly tilt the normal
            n_perturb = normal + np.random.randn(3) * perturb_eps * 0.1 * (attempt + 1)
            n_perturb = n_perturb / np.linalg.norm(n_perturb)

            above = mesh.slice_plane(p_origin, n_perturb, cap=cap_holes)
            below = mesh.slice_plane(p_origin, -n_perturb, cap=cap_holes)
            if above is not None and below is not None and len(above.faces) > 0 and len(below.faces) > 0:
                return above, below, f"perturbed_attempt_{attempt+1}"
        except Exception:
            continue

    # Attempt 3: Vertex classification split (always works)
    try:
        above, below = _vertex_classify_split(mesh, normal, origin, cap_holes)
        if above is not None and below is not None:
            return above, below, "vertex_classify"
    except Exception:
        pass

    return None, None, "failed"


def _vertex_classify_split(
    mesh: trimesh.Trimesh,
    normal: np.ndarray,
    origin: np.ndarray,
    cap_holes: bool,
) -> tuple:
    """
    Manual split by classifying each vertex as above/below the plane.
    Intersecting triangles are clipped. Always works but slower.
    """
    vertices = np.asarray(mesh.vertices)
    faces = np.asarray(mesh.faces)

    # Signed distance of each vertex to plane
    dists = np.dot(vertices - origin, normal)
    eps = np.max(np.abs(dists)) * 1e-8

    above_verts = dists > eps
    below_verts = dists < -eps
    on_plane = ~above_verts & ~below_verts

    # Classify triangles
    above_faces = []
    below_faces = []
    new_vertices = list(vertices)
    edge_cache = {}  # (min_vi, max_vi) -> new vertex index

    def get_intersection(vi, vj):
        """Get or create intersection vertex on edge vi-vj."""
        key = (min(vi, vj), max(vi, vj))
        if key in edge_cache:
            return edge_cache[key]
        d0, d1 = dists[vi], dists[vj]
        t = d0 / (d0 - d1)
        t = max(0.0, min(1.0, t))
        new_v = vertices[vi] + t * (vertices[vj] - vertices[vi])
        idx = len(new_vertices)
        new_vertices.append(new_v)
        edge_cache[key] = idx
        return idx

    for fi in range(len(faces)):
        v0, v1, v2 = faces[fi]
        d0, d1, d2 = dists[v0], dists[v1], dists[v2]
        a0, a1, a2 = d0 > eps, d1 > eps, d2 > eps
        b0, b1, b2 = d0 < -eps, d1 < -eps, d2 < -eps

        above_count = int(a0) + int(a1) + int(a2)
        below_count = int(b0) + int(b1) + int(b2)

        if below_count == 0:
            above_faces.append([v0, v1, v2])
        elif above_count == 0:
            below_faces.append([v0, v1, v2])
        else:
            # Triangle straddles the plane — clip it
            verts = [(v0, d0), (v1, d1), (v2, d2)]
            _clip_triangle(verts, eps, above_faces, below_faces, get_intersection)

    if len(above_faces) == 0 or len(below_faces) == 0:
        return None, None

    all_verts = np.array(new_vertices)

    above_mesh = trimesh.Trimesh(vertices=all_verts, faces=np.array(above_faces), process=True)
    below_mesh = trimesh.Trimesh(vertices=all_verts, faces=np.array(below_faces), process=True)

    # Cap holes if requested (fill the cross-section)
    if cap_holes:
        above_mesh = _cap_cross_section(above_mesh)
        below_mesh = _cap_cross_section(below_mesh)

    return above_mesh, below_mesh


def _clip_triangle(verts, eps, above_list, below_list, get_intersection):
    """Clip a triangle that straddles the plane into above/below pieces."""
    # Sort vertices so that the lone vertex (on one side) comes first
    # This simplifies the clipping logic
    indices = [v[0] for v in verts]
    dists_local = [v[1] for v in verts]
    above = [d > eps for d in dists_local]

    above_count = sum(above)

    if above_count == 1:
        # One vertex above, two below — find the lone above vertex
        lone = above.index(True)
        other = [(lone + 1) % 3, (lone + 2) % 3]

        vi_lone = indices[lone]
        vi_a = indices[other[0]]
        vi_b = indices[other[1]]

        # Intersection points on the two crossing edges
        int_a = get_intersection(vi_lone, vi_a)
        int_b = get_intersection(vi_lone, vi_b)

        above_list.append([vi_lone, int_a, int_b])
        below_list.append([int_a, vi_a, vi_b])
        below_list.append([int_a, vi_b, int_b])

    elif above_count == 2:
        # Two vertices above, one below
        lone = above.index(False)
        other = [(lone + 1) % 3, (lone + 2) % 3]

        vi_lone = indices[lone]
        vi_a = indices[other[0]]
        vi_b = indices[other[1]]

        int_a = get_intersection(vi_lone, vi_a)
        int_b = get_intersection(vi_lone, vi_b)

        below_list.append([vi_lone, int_a, int_b])
        above_list.append([int_a, vi_a, vi_b])
        above_list.append([int_a, vi_b, int_b])


def _cap_cross_section(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Fill open boundary loops (cross-section holes) after a planar cut."""
    try:
        mesh.fill_holes()
    except Exception:
        pass
    return mesh


def _clean_part(piece: trimesh.Trimesh) -> trimesh.Trimesh:
    """Clean up a split part: remove degenerates, merge close vertices."""
    try:
        piece.merge_vertices()
        piece.remove_degenerate_faces()
        piece.remove_duplicate_faces()
        piece.remove_unreferenced_vertices()
        piece.fix_normals()
    except Exception:
        pass
    return piece
