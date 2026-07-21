"""Build the compact two-view GNM identity fitting runtime.

The browser does not try to infer GNM coefficients directly from an untrained
image embedding. Instead, it measures stable front/profile proportions with
MediaPipe and maps those measurements into the released 253-component GNM
identity space using a regularized prior sampled from Google's identity
decoder. DINOv3 is used at runtime for view feature extraction and cross-view
validation.

The MediaPipe reference ratios below were measured from the canonical face
model published by google-ai-edge/mediapipe. Keeping the values here makes the
runtime build deterministic and offline.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MODEL_SOURCE = ROOT / "src-tauri" / "resources" / "gnm_head.npz"
DECODER_SOURCE = ROOT / "public" / "models" / "gnm_identity_decoder.bin"
DESTINATION = ROOT / "public" / "models" / "gnm_custom_head_fit.json"

FEATURE_NAMES = [
    "face_width_height",
    "jaw_width",
    "chin_width",
    "eye_span",
    "eye_gap",
    "eye_width",
    "nose_width",
    "mouth_width",
    "lower_face",
    "nose_length",
    "eye_height",
    "profile_nose",
    "profile_brow",
    "profile_chin",
    "profile_lip",
    "profile_nose_lip",
]

# Ratios from MediaPipe's canonical_face_model.obj using the same landmark
# pairs as src/features/customHead/customHeadMeasurements.ts.
MEDIAPIPE_CANONICAL = np.asarray([
    0.867717,
    0.775102,
    0.418916,
    0.580083,
    0.242222,
    0.168930,
    0.183402,
    0.320479,
    0.414055,
    0.303425,
    0.037920,
    0.561075,
    0.434295,
    0.379298,
    0.476383,
    0.084692,
], dtype=np.float64)


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
        kernel = np.frombuffer(data, dtype="<f4", count=rows * columns, offset=offset).reshape(rows, columns)
        offset += rows * columns * 4
        bias = np.frombuffer(data, dtype="<f4", count=columns, offset=offset)
        offset += columns * 4
        layers.append((np.asarray(kernel, dtype=np.float64), np.asarray(bias, dtype=np.float64)))
    if offset != len(data):
        raise RuntimeError("The GNM identity decoder has trailing data")
    return layers


def sample_identity_weights(sample_count: int) -> np.ndarray:
    rng = np.random.default_rng(0x474E4D)
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


def extreme(vertices: np.ndarray, members: np.ndarray, axis: int, maximum: bool) -> int:
    values = vertices[members, axis]
    return int(members[np.argmax(values) if maximum else np.argmin(values)])


def fitting_anchors(vertices: np.ndarray, names: list[str], groups: np.ndarray) -> dict[str, int]:
    members = lambda name: group_members(names, groups, name)
    return {
        "face_top": extreme(vertices, members("hockey_mask"), 1, True),
        "face_bottom": extreme(vertices, members("chin_region"), 1, False),
        "face_positive": extreme(vertices, members("left_temple_region"), 0, True),
        "face_negative": extreme(vertices, members("right_temple_region"), 0, False),
        "jaw_positive": extreme(vertices, members("left_parotid_region"), 0, True),
        "jaw_negative": extreme(vertices, members("right_parotid_region"), 0, False),
        "chin_positive": extreme(vertices, members("chin_region"), 0, True),
        "chin_negative": extreme(vertices, members("chin_region"), 0, False),
        "eye_positive_outer": extreme(vertices, members("left_eye"), 0, True),
        "eye_positive_inner": extreme(vertices, members("left_eye"), 0, False),
        "eye_negative_inner": extreme(vertices, members("right_eye"), 0, True),
        "eye_negative_outer": extreme(vertices, members("right_eye"), 0, False),
        "eye_top": extreme(vertices, members("eyes"), 1, True),
        "eye_bottom": extreme(vertices, members("eyes"), 1, False),
        "nose_positive": extreme(vertices, members("nose_region"), 0, True),
        "nose_negative": extreme(vertices, members("nose_region"), 0, False),
        "nose_top": extreme(vertices, members("nose_region"), 1, True),
        "nose_bottom": extreme(vertices, members("nose_region"), 1, False),
        "nose_front": extreme(vertices, members("nose_region"), 2, True),
        "mouth_positive": extreme(vertices, members("upper_lip_region"), 0, True),
        "mouth_negative": extreme(vertices, members("upper_lip_region"), 0, False),
        "lip_front": extreme(vertices, members("upper_lip_region"), 2, True),
        "brow_front": extreme(vertices, members("middle_brow_region"), 2, True),
        "chin_front": extreme(vertices, members("chin_region"), 2, True),
        "temple_positive_back": extreme(vertices, members("left_temple_region"), 2, False),
        "temple_negative_back": extreme(vertices, members("right_temple_region"), 2, False),
    }


def measure(positions: np.ndarray, anchors: dict[str, int]) -> np.ndarray:
    point = lambda name: positions[:, anchors[name], :]
    face_height = np.maximum(1e-6, point("face_top")[:, 1] - point("face_bottom")[:, 1])
    face_width = np.maximum(1e-6, point("face_positive")[:, 0] - point("face_negative")[:, 0])
    temple_depth = (point("temple_positive_back")[:, 2] + point("temple_negative_back")[:, 2]) * 0.5
    eye_width = (
        point("eye_positive_outer")[:, 0] - point("eye_positive_inner")[:, 0]
        + point("eye_negative_inner")[:, 0] - point("eye_negative_outer")[:, 0]
    ) * 0.5
    values = np.column_stack([
        face_width / face_height,
        (point("jaw_positive")[:, 0] - point("jaw_negative")[:, 0]) / face_width,
        (point("chin_positive")[:, 0] - point("chin_negative")[:, 0]) / face_width,
        (point("eye_positive_outer")[:, 0] - point("eye_negative_outer")[:, 0]) / face_width,
        (point("eye_positive_inner")[:, 0] - point("eye_negative_inner")[:, 0]) / face_width,
        eye_width / face_width,
        (point("nose_positive")[:, 0] - point("nose_negative")[:, 0]) / face_width,
        (point("mouth_positive")[:, 0] - point("mouth_negative")[:, 0]) / face_width,
        (point("nose_bottom")[:, 1] - point("face_bottom")[:, 1]) / face_height,
        (point("nose_top")[:, 1] - point("nose_bottom")[:, 1]) / face_height,
        (point("eye_top")[:, 1] - point("eye_bottom")[:, 1]) / face_height,
        (point("nose_front")[:, 2] - temple_depth) / face_height,
        (point("brow_front")[:, 2] - temple_depth) / face_height,
        (point("chin_front")[:, 2] - temple_depth) / face_height,
        (point("lip_front")[:, 2] - temple_depth) / face_height,
        (point("nose_front")[:, 2] - point("lip_front")[:, 2]) / face_height,
    ])
    if not np.isfinite(values).all():
        raise RuntimeError("Non-finite custom-head measurements were generated")
    return values


def main() -> None:
    sample_count = 12_000
    with np.load(MODEL_SOURCE) as model:
        template = np.asarray(model["template_vertex_positions"], dtype=np.float64)
        basis = np.asarray(model["vertex_identity_basis"], dtype=np.float64)
        names = [str(name) for name in model["vertex_group_names"]]
        groups = np.asarray(model["vertex_groups"])

    anchors = fitting_anchors(template, names, groups)
    anchor_indices = np.asarray(sorted(set(anchors.values())), dtype=np.int32)
    local_index = {int(vertex): index for index, vertex in enumerate(anchor_indices)}
    local_anchors = {name: local_index[vertex] for name, vertex in anchors.items()}
    weights = sample_identity_weights(sample_count)
    anchor_positions = template[anchor_indices][None, :, :] + np.einsum(
        "sc,cad->sad", weights, basis[:, anchor_indices, :], optimize=True,
    )
    ratios = measure(anchor_positions, local_anchors)

    weight_mean = weights.mean(axis=0)
    weight_std = np.maximum(weights.std(axis=0), 1e-5)
    ratio_mean = ratios.mean(axis=0)
    centered_weights = weights - weight_mean
    centered_ratios = ratios - ratio_mean
    covariance_wy = centered_weights.T @ centered_ratios / (sample_count - 1)
    covariance_yy = centered_ratios.T @ centered_ratios / (sample_count - 1)
    ratio_std = np.maximum(ratios.std(axis=0), 1e-5)
    # Treat roughly one fifth of the decoder population spread as measurement
    # noise. This prevents a single imperfect photo landmark from producing an
    # implausible identity while retaining visible, identity-specific changes.
    noise = np.diag(np.square(ratio_std * 0.22))
    gain = covariance_wy @ np.linalg.inv(covariance_yy + noise)

    payload = {
        "version": 1,
        "model": "GNM Head v3",
        "sampleCount": sample_count,
        "featureNames": FEATURE_NAMES,
        "mediaPipeCanonical": MEDIAPIPE_CANONICAL.round(8).tolist(),
        "gnmRatioMean": ratio_mean.round(8).tolist(),
        "gnmRatioStd": ratio_std.round(8).tolist(),
        "priorWeights": weight_mean.round(8).tolist(),
        "weightStd": weight_std.round(8).tolist(),
        # Stored component-major: 253 rows, one coefficient per image feature.
        "gain": gain.astype(np.float32).round(8).tolist(),
        "targetScaleLimits": [0.72, 1.32],
        "recommendedStrength": 0.82,
        "source": {
            "gnm": "https://github.com/google/GNM",
            "mediaPipeCanonical": "https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj",
        },
    }
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {DESTINATION.relative_to(ROOT)} ({DESTINATION.stat().st_size:,} bytes)")
    for name, mean, std in zip(FEATURE_NAMES, ratio_mean, ratio_std):
        print(f"  {name:20} mean={mean:.5f} std={std:.5f}")


if __name__ == "__main__":
    main()
