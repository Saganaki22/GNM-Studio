"""Build the constrained multi-view GNM identity fitting runtime.

The runtime does not claim that DINOv3 reconstructs a head. MediaPipe supplies
dense geometric observations; DINOv3 is an optional same-person cross-view
validator. A compact PCA subspace learned from valid outputs of Google's GNM
identity decoder constrains the browser solver to coherent head identities.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

from custom_head_landmarks import LANDMARK_GROUPS


ROOT = Path(__file__).resolve().parents[1]
MODEL_SOURCE = ROOT / "src-tauri" / "resources" / "gnm_head.npz"
DECODER_SOURCE = ROOT / "public" / "models" / "gnm_identity_decoder.bin"
DESTINATION = ROOT / "public" / "models" / "gnm_custom_head_fit.json"

SAMPLE_COUNT = 12_000
LATENT_DIMENSIONS = 48
LANDMARK_DISTANCE_SCALE = np.asarray([0.075, 0.100, 0.090], dtype=np.float64)
POINT_WEIGHTS = {
    "oval": 1.00,
    "brows": 0.75,
    "eyes": 1.00,
    "nose": 1.15,
    "cheeks": 0.80,
    # Keep lip identity available while preventing it from overpowering the
    # cranial fit when a source photo is not perfectly neutral.
    "mouth": 0.65,
}


def read_decoder(path: Path) -> list[tuple[np.ndarray, np.ndarray]]:
    data = path.read_bytes()
    if data[:4] != b"GND1":
        raise RuntimeError("Unsupported GNM identity decoder")
    offset = 4
    layer_count = struct.unpack_from("<I", data, offset)[0]
    offset += 4
    layers: list[tuple[np.ndarray, np.ndarray]] = []
    for _ in range(layer_count):
        rows, columns = struct.unpack_from("<II", data, offset)
        offset += 8
        kernel = np.frombuffer(
            data, dtype="<f4", count=rows * columns, offset=offset,
        ).reshape(rows, columns)
        offset += rows * columns * 4
        bias = np.frombuffer(data, dtype="<f4", count=columns, offset=offset)
        offset += columns * 4
        layers.append((np.asarray(kernel, dtype=np.float64), np.asarray(bias, dtype=np.float64)))
    if offset != len(data):
        raise RuntimeError("The GNM identity decoder has trailing data")
    return layers


def sample_identity_weights(sample_count: int, seed: int = 0x474E4D) -> np.ndarray:
    rng = np.random.default_rng(seed)
    inputs = np.zeros((sample_count, 70), dtype=np.float64)
    inputs[:, :64] = rng.normal(size=(sample_count, 64))
    presentation = rng.uniform(-1.0, 1.0, size=sample_count)
    inputs[:, 64] = (1.0 - presentation) * 0.5
    inputs[:, 65] = (1.0 + presentation) * 0.5
    inputs[:, 66:] = rng.dirichlet(np.ones(4), size=sample_count)
    values = inputs
    layers = read_decoder(DECODER_SOURCE)
    for index, (kernel, bias) in enumerate(layers):
        values = values @ kernel + bias
        if index < len(layers) - 1:
            values = np.maximum(values, 0.0)
    return values


def group_members(names: list[str], groups: np.ndarray, name: str) -> np.ndarray:
    if name not in names:
        raise RuntimeError(f"GNM anatomy is missing {name}")
    return np.flatnonzero(groups[names.index(name)] > 0.5)


def extreme(
    vertices: np.ndarray,
    names: list[str],
    groups: np.ndarray,
    group: str,
    axis: int,
    maximum: bool,
) -> int:
    members = group_members(names, groups, group)
    values = vertices[members, axis]
    return int(members[np.argmax(values) if maximum else np.argmin(values)])


def flattened_landmarks() -> tuple[list[int], list[str], np.ndarray]:
    indices: list[int] = []
    regions: list[str] = []
    coordinates: list[tuple[float, float, float]] = []
    for region, landmarks in LANDMARK_GROUPS.items():
        for index, x, y, z in landmarks:
            if index in indices:
                raise RuntimeError(f"MediaPipe fitting landmark {index} is duplicated")
            indices.append(index)
            regions.append(region)
            coordinates.append((x, y, z))
    required = {1, 10, 152, 234, 454}
    if not required.issubset(indices):
        raise RuntimeError("The fitting landmarks do not contain all local-axis anchors")
    return indices, regions, np.asarray(coordinates, dtype=np.float64)


def reference_affine(
    vertices: np.ndarray,
    canonical_by_index: dict[int, np.ndarray],
    names: list[str],
    groups: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    references = [
        (10, extreme(vertices, names, groups, "forehead_region", 1, True)),
        (152, extreme(vertices, names, groups, "chin_region", 1, False)),
        (234, extreme(vertices, names, groups, "right_temple_region", 0, False)),
        (454, extreme(vertices, names, groups, "left_temple_region", 0, True)),
        (33, extreme(vertices, names, groups, "right_orbital_region", 0, False)),
        (263, extreme(vertices, names, groups, "left_orbital_region", 0, True)),
        (1, extreme(vertices, names, groups, "nose_region", 2, True)),
        (0, extreme(vertices, names, groups, "upper_lip_region", 2, True)),
        (61, extreme(vertices, names, groups, "upper_lip_region", 0, False)),
        (291, extreme(vertices, names, groups, "upper_lip_region", 0, True)),
        (168, extreme(vertices, names, groups, "middle_brow_region", 2, True)),
    ]
    scale = np.zeros(3, dtype=np.float64)
    offset = np.zeros(3, dtype=np.float64)
    for axis in range(3):
        source = np.asarray([canonical_by_index[index][axis] for index, _ in references])
        target = np.asarray([vertices[vertex, axis] for _, vertex in references])
        scale[axis], offset[axis] = np.linalg.lstsq(
            np.column_stack([source, np.ones(len(source))]), target, rcond=None,
        )[0]
    return scale, offset


def candidate_vertices(
    region: str,
    ordinal: int,
    canonical_x: float,
    names: list[str],
    groups: np.ndarray,
) -> np.ndarray:
    side = "right" if canonical_x < 0 else "left"
    members = lambda name: group_members(names, groups, name)
    if region == "oval":
        return members("skin_exterior")
    if region == "brows":
        return members(f"{side}_brow_region") if abs(canonical_x) > 1.0 else members("middle_brow_region")
    if region == "eyes":
        return members(f"{side}_orbital_region")
    if region == "nose":
        return members("nose_region")
    if region == "cheeks":
        return np.unique(np.concatenate([
            members(f"{side}_zygomatic_region"),
            members(f"{side}_infraorbital_region"),
            members(f"{side}_cheek_region"),
            members(f"{side}_parotid_region"),
        ]))
    if region == "mouth":
        return members("upper_lip_region" if ordinal < 11 else "lower_lip_region")
    raise RuntimeError(f"Unknown fitting region {region}")


def build_correspondences(
    vertices: np.ndarray,
    landmark_indices: list[int],
    landmark_regions: list[str],
    canonical: np.ndarray,
    names: list[str],
    groups: np.ndarray,
) -> tuple[np.ndarray, dict[str, tuple[float, float]]]:
    canonical_by_index = {
        index: canonical[position] for position, index in enumerate(landmark_indices)
    }
    scale, offset = reference_affine(vertices, canonical_by_index, names, groups)
    projected = canonical * scale + offset
    correspondence_vertices: list[int] = []
    region_ordinals: dict[str, int] = {}
    used_by_region: dict[str, set[int]] = {}
    distances: dict[str, list[float]] = {}
    for position, (index, region) in enumerate(zip(landmark_indices, landmark_regions)):
        ordinal = region_ordinals.get(region, 0)
        region_ordinals[region] = ordinal + 1
        candidates = candidate_vertices(region, ordinal, canonical[position, 0], names, groups)
        normalized_delta = (vertices[candidates] - projected[position]) / LANDMARK_DISTANCE_SCALE
        order = np.argsort(np.sum(np.square(normalized_delta), axis=1))
        used = used_by_region.setdefault(region, set())
        selected = next(
            (int(candidates[candidate]) for candidate in order if int(candidates[candidate]) not in used),
            int(candidates[order[0]]),
        )
        used.add(selected)
        correspondence_vertices.append(selected)
        distances.setdefault(region, []).append(float(np.linalg.norm(vertices[selected] - projected[position])))
        if index in {1, 10, 152, 234, 454} and selected < 0:
            raise RuntimeError("Invalid local-axis correspondence")
    diagnostics = {
        region: (float(np.mean(values)), float(np.max(values)))
        for region, values in distances.items()
    }
    return np.asarray(correspondence_vertices, dtype=np.int32), diagnostics


def normalized_local_positions(positions: np.ndarray, landmark_indices: list[int]) -> np.ndarray:
    """Remove translation, rotation, and scale while preserving proportions."""
    lookup = {index: position for position, index in enumerate(landmark_indices)}
    positive_side = positions[..., lookup[454], :]
    negative_side = positions[..., lookup[234], :]
    forehead = positions[..., lookup[10], :]
    chin = positions[..., lookup[152], :]
    nose = positions[..., lookup[1], :]

    x_axis = positive_side - negative_side
    x_axis /= np.maximum(np.linalg.norm(x_axis, axis=-1, keepdims=True), 1e-8)
    y_axis = forehead - chin
    y_axis -= x_axis * np.sum(y_axis * x_axis, axis=-1, keepdims=True)
    y_axis /= np.maximum(np.linalg.norm(y_axis, axis=-1, keepdims=True), 1e-8)
    z_axis = np.cross(x_axis, y_axis)
    origin = (positive_side + negative_side) * 0.5
    orientation = np.sum(z_axis * (nose - origin), axis=-1, keepdims=True)
    z_axis *= np.where(orientation < 0.0, -1.0, 1.0)
    height = np.maximum(np.linalg.norm(forehead - chin, axis=-1, keepdims=True), 1e-8)
    relative = positions - origin[..., None, :]
    local = np.stack([
        np.sum(relative * x_axis[..., None, :], axis=-1),
        np.sum(relative * y_axis[..., None, :], axis=-1),
        np.sum(relative * z_axis[..., None, :], axis=-1),
    ], axis=-1)
    return local / height[..., None]


def round_list(values: np.ndarray, digits: int = 8) -> list:
    return np.round(values.astype(np.float64), digits).tolist()


def validate_oral_subspace(
    template: np.ndarray,
    identity_basis: np.ndarray,
    names: list[str],
    groups: np.ndarray,
    valid_weights: np.ndarray,
    prior_weights: np.ndarray,
    weight_modes: np.ndarray,
) -> dict:
    """Check that bounded PCA combinations retain valid oral containment."""
    mean_vertices = template + np.einsum(
        "c,cad->ad", prior_weights, identity_basis, optimize=True,
    )
    oral_groups = {
        "lip": np.unique(np.concatenate([
            group_members(names, groups, "upper_lip_region"),
            group_members(names, groups, "lower_lip_region"),
        ])),
        "teeth": group_members(names, groups, "teeth"),
        "gums": group_members(names, groups, "gums"),
        "tongue": group_members(names, groups, "tongue"),
        "sock": group_members(names, groups, "mouth_sock"),
    }
    selected_vertices: list[int] = []
    selected_by_group: dict[str, np.ndarray] = {}
    for name, members in oral_groups.items():
        selected: list[int] = []
        for axis in range(3):
            selected.extend([
                int(members[np.argmin(mean_vertices[members, axis])]),
                int(members[np.argmax(mean_vertices[members, axis])]),
            ])
        start = len(selected_vertices)
        selected_vertices.extend(selected)
        selected_by_group[name] = np.arange(start, start + len(selected), dtype=np.int32)
    selected_array = np.asarray(selected_vertices, dtype=np.int32)
    selected_template = template[selected_array]
    selected_basis = identity_basis[:, selected_array, :]

    def features(sample_weights: np.ndarray) -> np.ndarray:
        positions = selected_template[None, :, :] + np.einsum(
            "sc,cad->sad", sample_weights, selected_basis, optimize=True,
        )
        bounds = {
            name: (
                positions[:, indices].min(axis=1),
                positions[:, indices].max(axis=1),
            )
            for name, indices in selected_by_group.items()
        }
        lip_width = np.maximum(bounds["lip"][1][:, 0] - bounds["lip"][0][:, 0], 1e-8)
        values = []
        for name in ["teeth", "gums", "tongue", "sock"]:
            values.append((bounds[name][1][:, 0] - bounds[name][0][:, 0]) / lip_width)
        for name in ["teeth", "gums", "tongue", "sock"]:
            values.append((bounds["lip"][1][:, 2] - bounds[name][1][:, 2]) / lip_width)
        return np.stack(values, axis=1)

    rng = np.random.default_rng(0x0A11CE)
    latent = np.clip(rng.normal(size=(5_000, LATENT_DIMENSIONS)), -2.8, 2.8)
    latent_rms = np.sqrt(np.mean(np.square(latent), axis=1))
    latent *= np.minimum(1.0, 1.35 / np.maximum(latent_rms, 1e-8))[:, None]
    subspace_weights = prior_weights + latent @ weight_modes
    valid_features = features(valid_weights)
    subspace_features = features(subspace_weights)
    metric_names = [
        "teethWidth", "gumsWidth", "tongueWidth", "sockWidth",
        "teethFrontClearance", "gumsFrontClearance",
        "tongueFrontClearance", "sockFrontClearance",
    ]
    metrics = {}
    maximum_outside_rate = 0.0
    for index, name in enumerate(metric_names):
        valid = valid_features[:, index]
        fitted = subspace_features[:, index]
        outside_rate = float(np.mean((fitted < valid.min()) | (fitted > valid.max())))
        maximum_outside_rate = max(maximum_outside_rate, outside_rate)
        metrics[name] = {
            "validP001": round(float(np.percentile(valid, 0.1)), 6),
            "validP999": round(float(np.percentile(valid, 99.9)), 6),
            "subspaceP001": round(float(np.percentile(fitted, 0.1)), 6),
            "subspaceP999": round(float(np.percentile(fitted, 99.9)), 6),
            "outsideValidRangeRate": round(outside_rate, 8),
        }
    if maximum_outside_rate > 0.001:
        raise RuntimeError(
            f"Bounded identity subspace exceeded the sampled oral envelope ({maximum_outside_rate:.3%})"
        )
    for name in [
        "teethFrontClearance", "gumsFrontClearance",
        "tongueFrontClearance", "sockFrontClearance",
    ]:
        if metrics[name]["subspaceP001"] <= 0.0:
            raise RuntimeError(f"Bounded identity subspace failed {name} containment")
    return {
        "randomSamples": len(latent),
        "maximumOutsideValidRangeRate": round(maximum_outside_rate, 8),
        "metrics": metrics,
    }


def main() -> None:
    landmark_indices, landmark_regions, canonical_positions = flattened_landmarks()
    weights = sample_identity_weights(SAMPLE_COUNT)
    prior_weights = weights.mean(axis=0)
    centered_weights = weights - prior_weights
    _, singular_values, principal_axes = np.linalg.svd(centered_weights, full_matrices=False)
    mode_scales = singular_values[:LATENT_DIMENSIONS] / np.sqrt(SAMPLE_COUNT - 1)
    weight_modes = principal_axes[:LATENT_DIMENSIONS] * mode_scales[:, None]
    explained_variance = np.square(singular_values)
    explained_ratio = float(
        explained_variance[:LATENT_DIMENSIONS].sum() / explained_variance.sum()
    )

    with np.load(MODEL_SOURCE) as model:
        template = np.asarray(model["template_vertex_positions"], dtype=np.float64)
        identity_basis = np.asarray(model["vertex_identity_basis"], dtype=np.float64)
        names = [str(name) for name in model["vertex_group_names"]]
        groups = np.asarray(model["vertex_groups"])

    mean_vertices = template + np.einsum(
        "c,cad->ad", prior_weights, identity_basis, optimize=True,
    )
    anchor_vertex_indices, mapping_diagnostics = build_correspondences(
        mean_vertices,
        landmark_indices,
        landmark_regions,
        canonical_positions,
        names,
        groups,
    )
    anchor_template = template[anchor_vertex_indices]
    anchor_basis = identity_basis[:, anchor_vertex_indices, :]
    base_positions = anchor_template + np.einsum(
        "c,cad->ad", prior_weights, anchor_basis, optimize=True,
    )
    base_anchors = normalized_local_positions(base_positions, landmark_indices)
    canonical_anchors = normalized_local_positions(canonical_positions, landmark_indices)

    anchor_modes = np.empty(
        (LATENT_DIMENSIONS, len(landmark_indices), 3), dtype=np.float64,
    )
    for mode_index, mode in enumerate(weight_modes):
        plus = anchor_template + np.einsum(
            "c,cad->ad", prior_weights + mode, anchor_basis, optimize=True,
        )
        minus = anchor_template + np.einsum(
            "c,cad->ad", prior_weights - mode, anchor_basis, optimize=True,
        )
        anchor_modes[mode_index] = (
            normalized_local_positions(plus, landmark_indices)
            - normalized_local_positions(minus, landmark_indices)
        ) * 0.5

    oral_validation = validate_oral_subspace(
        template,
        identity_basis,
        names,
        groups,
        weights,
        prior_weights,
        weight_modes,
    )

    payload = {
        "version": 2,
        "model": "GNM Head v3",
        "sampleCount": SAMPLE_COUNT,
        "latentDimensions": LATENT_DIMENSIONS,
        "explainedVariance": round(explained_ratio, 8),
        "landmarkIndices": landmark_indices,
        "landmarkRegions": landmark_regions,
        "anchorVertexIndices": anchor_vertex_indices.tolist(),
        "pointWeights": [POINT_WEIGHTS[region] for region in landmark_regions],
        "canonicalAnchors": round_list(canonical_anchors.reshape(-1)),
        "baseAnchors": round_list(base_anchors.reshape(-1)),
        "anchorModes": [round_list(mode.reshape(-1)) for mode in anchor_modes],
        "priorWeights": round_list(prior_weights),
        "weightModes": [round_list(mode) for mode in weight_modes],
        "recommendedStrength": 0.90,
        "solver": {
            "iterations": 6,
            "regularization": 0.00001,
            "huberDelta": 0.018,
            "latentLimit": 2.80,
            "latentRmsLimit": 1.35,
            "targetDeltaLimits": [0.14, 0.14, 0.10],
            "frontCoordinateWeights": [1.00, 1.00, 0.32],
            "profileCoordinateWeights": [0.35, 0.35, 0.90],
        },
        "mappingDiagnostics": {
            region: {
                "meanDistanceMm": round(mean_distance * 1000.0, 3),
                "maxDistanceMm": round(max_distance * 1000.0, 3),
            }
            for region, (mean_distance, max_distance) in mapping_diagnostics.items()
        },
        "oralValidation": oral_validation,
        "source": {
            "gnm": "https://github.com/google/GNM",
            "mediaPipeCanonical": "https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj",
        },
    }
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {DESTINATION.relative_to(ROOT)} ({DESTINATION.stat().st_size:,} bytes)")
    print(
        f"  {len(landmark_indices)} correspondences · {LATENT_DIMENSIONS} modes · "
        f"{explained_ratio * 100.0:.2f}% sampled identity variance"
    )
    for region, (mean_distance, max_distance) in mapping_diagnostics.items():
        print(
            f"  {region:8} correspondence mean={mean_distance * 1000.0:5.2f} mm "
            f"max={max_distance * 1000.0:5.2f} mm"
        )
    print(
        "  oral containment validation: "
        f"{oral_validation['randomSamples']} bounded samples, "
        f"max outside-rate={oral_validation['maximumOutsideValidRangeRate']:.3%}"
    )


if __name__ == "__main__":
    main()
