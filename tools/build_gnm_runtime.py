"""Build browser/runtime assets from Google's released GNM NPZ and H5 files.

Python is a development-only converter. The shipped Tauri application does not
embed Python, NumPy, h5py, TensorFlow, or the original GNM Python package.
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import h5py
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "gnm_source"
MODEL_SOURCE = ROOT / "src-tauri" / "resources" / "gnm_head.npz"
OUTPUT = ROOT / "public" / "models"

EXPRESSION_LABELS = (
    "surprise", "disgust", "suck", "compress_face", "stretch_face",
    "happy", "squint", "platysma", "blow", "funneler", "smile_wide",
    "corners_down", "pucker", "wink_left", "wink_right", "mouth_left",
    "mouth_right", "lips_roll_in", "snarl", "tongue_center",
)
RUNTIME_MORPH_LABELS = EXPRESSION_LABELS + ("jaw_open",)
POSE_MORPH_LABELS = tuple(
    f"pose_{joint}_{row}{column}"
    for joint in ("neck", "head", "left_eye", "right_eye")
    for row in range(3)
    for column in range(3)
)
ALL_MORPH_LABELS = RUNTIME_MORPH_LABELS + POSE_MORPH_LABELS


def dense_decoder(path: Path) -> list[tuple[np.ndarray, np.ndarray]]:
    layers: list[tuple[np.ndarray, np.ndarray]] = []
    with h5py.File(path, "r") as file:
        weights = file["model_weights"]
        dense_names = sorted(
            (name for name in weights if name.startswith("dense_")),
            key=lambda value: int(value.split("_")[-1]),
        )
        for name in dense_names:
            group = weights[name][name]
            layers.append((
                np.asarray(group["kernel:0"], dtype=np.float32),
                np.asarray(group["bias:0"], dtype=np.float32),
            ))
    return layers


def evaluate_decoder(
    layers: list[tuple[np.ndarray, np.ndarray]], inputs: np.ndarray
) -> np.ndarray:
    value = inputs.astype(np.float32)
    for index, (kernel, bias) in enumerate(layers):
        value = value @ kernel + bias
        if index != len(layers) - 1:
            value = np.maximum(value, 0)
    return value


def decode_expression_inputs(inputs: np.ndarray) -> np.ndarray:
    layers = dense_decoder(SOURCE / "expression_decoder_model.h5")
    return evaluate_decoder(layers, inputs)


def semantic_expressions() -> np.ndarray:
    # A zero latent code gives a stable representative for each semantic class.
    inputs = np.zeros((len(EXPRESSION_LABELS), 64 + len(EXPRESSION_LABELS)), dtype=np.float32)
    inputs[:, 64:] = np.eye(len(EXPRESSION_LABELS), dtype=np.float32)
    parameters = decode_expression_inputs(inputs)
    # Keep tracked brow/eye surprise independent from jaw opening. Mouth motion
    # uses its own canonical lower-face vector below, so one MediaPipe channel
    # can never apply two complete mouth-opening deformations at once.
    parameters[EXPRESSION_LABELS.index("surprise"), 200:] = 0.0
    return parameters


def canonical_mouth_open_expression() -> np.ndarray:
    """Return the deterministic lower-face opening shipped by v1.3.0.

    This released GNM expression-decoder sample was selected for a clear lip
    gap, stable upper dental arch, and bounded chin displacement. Eye, tongue,
    and iris regions stay zero so jaw tracking drives only the learned
    lower-face basis.
    """
    rng = np.random.default_rng(0x474E4D)
    latent = rng.normal(size=(303, 64)).astype(np.float32)[302]
    inputs = np.zeros((1, 64 + len(EXPRESSION_LABELS)), dtype=np.float32)
    inputs[0, :64] = latent
    inputs[0, 64 + EXPRESSION_LABELS.index("surprise")] = 1.0
    parameters = decode_expression_inputs(inputs)[0]
    parameters[:200] = 0.0
    parameters[350:] = 0.0
    return parameters


def vertex_normals(vertices: np.ndarray, triangles: np.ndarray) -> np.ndarray:
    p0, p1, p2 = vertices[triangles[:, 0]], vertices[triangles[:, 1]], vertices[triangles[:, 2]]
    face_normals = np.cross(p1 - p0, p2 - p0)
    normals = np.zeros_like(vertices, dtype=np.float32)
    for corner in range(3):
        np.add.at(normals, triangles[:, corner], face_normals)
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    return normals / np.maximum(lengths, 1e-8)


def cylindrical_uv(vertices: np.ndarray) -> np.ndarray:
    """Generate stable repeatable UVs for optional skin microtexture maps."""
    center_z = (vertices[:, 2].min() + vertices[:, 2].max()) * 0.5
    u = (np.arctan2(vertices[:, 0], vertices[:, 2] - center_z) / (2.0 * np.pi) + 0.5) % 1.0
    y_min, y_max = vertices[:, 1].min(), vertices[:, 1].max()
    v = (vertices[:, 1] - y_min) / max(float(y_max - y_min), 1e-8)
    return np.stack([u, v], axis=1).astype(np.float32)


def connected_vertex_components(vertex_count: int, triangles: np.ndarray) -> list[np.ndarray]:
    """Return topology islands for anatomy that is disconnected in GNM."""
    parent = np.arange(vertex_count, dtype=np.int32)
    sizes = np.ones(vertex_count, dtype=np.int32)

    def find(value: int) -> int:
        while parent[value] != value:
            parent[value] = parent[parent[value]]
            value = int(parent[value])
        return value

    def join(first: int, second: int) -> None:
        a, b = find(first), find(second)
        if a == b:
            return
        if sizes[a] < sizes[b]:
            a, b = b, a
        parent[b] = a
        sizes[a] += sizes[b]

    for first, second, third in triangles:
        join(int(first), int(second))
        join(int(second), int(third))
    groups: dict[int, list[int]] = {}
    for vertex in range(vertex_count):
        groups.setdefault(find(vertex), []).append(vertex)
    return [np.asarray(group, dtype=np.int32) for group in groups.values()]


def stabilize_mouth_open_delta(
    vertices: np.ndarray,
    triangles: np.ndarray,
    delta: np.ndarray,
    vertex_group_names: np.ndarray,
    vertex_groups: np.ndarray,
) -> np.ndarray:
    """Apply the v1.3.0 mouth scaling and dental collision limits."""
    source = np.asarray(delta, dtype=np.float32)
    result = source * np.float32(1.30)
    names = [str(name) for name in vertex_group_names]
    def members(name: str) -> np.ndarray:
        if name not in names:
            raise RuntimeError(f"GNM anatomy is missing required vertex group {name}")
        return np.flatnonzero(vertex_groups[names.index(name)] > 0.5)

    upper = members("upper_teeth_and_gums")
    lower = members("lower_teeth_and_gums")
    chin = members("chin_region")
    result[upper] = 0.0
    # Move the complete lower teeth/gum island by one translation so enamel is
    # never stretched, exactly matching the last known-good remote runtime.
    lower_translation = source[lower].mean(axis=0) * np.float32(1.80)
    chin_top = float(np.max(vertices[chin, 1] + result[chin, 1]))
    dental_bottom = float(np.min(vertices[lower, 1]))
    minimum_clearance = 0.0015
    lower_translation[1] = max(
        float(lower_translation[1]),
        chin_top + minimum_clearance - dental_bottom,
    )
    result[lower] = lower_translation
    return result


def write_anatomy(
    destination: Path,
    vertex_count: int,
    names: np.ndarray,
    groups: np.ndarray,
) -> None:
    """Write compact official GNM vertex groups for browser/runtime masking."""
    with destination.open("wb") as file:
        file.write(b"GNA1")
        file.write(struct.pack("<IH", vertex_count, len(names)))
        for name, weights in zip(names, groups):
            encoded = str(name).encode("utf-8")
            members = np.flatnonzero(weights > 0.5).astype(np.uint16)
            if len(encoded) > 255:
                raise RuntimeError(f"Vertex group name is too long: {name}")
            file.write(struct.pack("<B", len(encoded)))
            file.write(encoded)
            file.write(struct.pack("<I", len(members)))
            file.write(members.tobytes())


class GlbBuilder:
    def __init__(self) -> None:
        self.payload = bytearray()
        self.views: list[dict[str, int]] = []
        self.accessors: list[dict[str, object]] = []

    def add_array(
        self,
        array: np.ndarray,
        component_type: int,
        accessor_type: str,
        target: int | None = None,
        include_bounds: bool = False,
    ) -> int:
        while len(self.payload) % 4:
            self.payload.append(0)
        contiguous = np.ascontiguousarray(array)
        offset = len(self.payload)
        raw = contiguous.tobytes()
        self.payload.extend(raw)
        view: dict[str, int] = {
            "buffer": 0,
            "byteOffset": offset,
            "byteLength": len(raw),
        }
        if target is not None:
            view["target"] = target
        view_index = len(self.views)
        self.views.append(view)
        count = int(contiguous.shape[0])
        accessor: dict[str, object] = {
            "bufferView": view_index,
            "componentType": component_type,
            "count": count,
            "type": accessor_type,
        }
        if include_bounds:
            accessor["min"] = contiguous.min(axis=0).astype(float).tolist()
            accessor["max"] = contiguous.max(axis=0).astype(float).tolist()
        accessor_index = len(self.accessors)
        self.accessors.append(accessor)
        return accessor_index


def write_glb(
    destination: Path,
    vertices: np.ndarray,
    triangles: np.ndarray,
    morph_deltas: np.ndarray,
    template_joints: np.ndarray,
    skinning_weights: np.ndarray,
    parent_indices: np.ndarray,
    pose_correctives: np.ndarray,
    joint_names: np.ndarray,
) -> None:
    builder = GlbBuilder()
    position = builder.add_array(vertices, 5126, "VEC3", 34962, True)
    normal = builder.add_array(vertex_normals(vertices, triangles), 5126, "VEC3", 34962)
    texture_coordinates = builder.add_array(cylindrical_uv(vertices), 5126, "VEC2", 34962)
    indices = builder.add_array(triangles.reshape(-1).astype(np.uint32), 5125, "SCALAR", 34963)
    vertex_joint_indices = np.broadcast_to(
        np.arange(len(template_joints), dtype=np.uint16),
        (len(vertices), len(template_joints)),
    )
    joints = builder.add_array(vertex_joint_indices, 5123, "VEC4", 34962)
    weights = builder.add_array(
        np.asarray(skinning_weights.T, dtype=np.float32), 5126, "VEC4", 34962
    )
    pose_deltas = np.asarray(pose_correctives, dtype=np.float32).reshape(
        len(template_joints) * 9, len(vertices), 3
    )
    all_deltas = np.concatenate([morph_deltas, pose_deltas], axis=0)
    targets = [
        {"POSITION": builder.add_array(delta, 5126, "VEC3", 34962, True)}
        for delta in all_deltas
    ]

    inverse_bind_matrices = np.repeat(
        np.eye(4, dtype=np.float32)[None, :, :], len(template_joints), axis=0
    )
    inverse_bind_matrices[:, :3, 3] = -template_joints
    # glTF matrices are stored column-major.
    inverse_bind = builder.add_array(
        inverse_bind_matrices.transpose(0, 2, 1), 5126, "MAT4"
    )

    nodes: list[dict[str, object]] = [{
        "mesh": 0,
        "skin": 0,
        "name": "GNM_Head_v3",
        "children": [1 + index for index, parent in enumerate(parent_indices) if parent < 0],
    }]
    for joint, (name, parent) in enumerate(zip(joint_names, parent_indices)):
        translation = template_joints[joint] if parent < 0 else template_joints[joint] - template_joints[int(parent)]
        children = [1 + index for index, candidate_parent in enumerate(parent_indices) if candidate_parent == joint]
        node: dict[str, object] = {
            "name": str(name),
            "translation": np.asarray(translation, dtype=float).tolist(),
        }
        if children:
            node["children"] = children
        nodes.append(node)

    document = {
        "asset": {"version": "2.0", "generator": "GNM Studio runtime converter"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": nodes,
        "skins": [{
            "name": "GNM_Head_v3_Rig",
            "inverseBindMatrices": inverse_bind,
            "skeleton": 1,
            "joints": list(range(1, 1 + len(template_joints))),
        }],
        "meshes": [{
            "name": "GNM_Head_v3",
            "extras": {"targetNames": list(ALL_MORPH_LABELS)},
            "weights": [0.0] * len(ALL_MORPH_LABELS),
            "primitives": [{
                "attributes": {
                    "POSITION": position,
                    "NORMAL": normal,
                    "TEXCOORD_0": texture_coordinates,
                    "JOINTS_0": joints,
                    "WEIGHTS_0": weights,
                },
                "indices": indices,
                "material": 0,
                "mode": 4,
                "targets": targets,
            }],
        }],
        "materials": [{
            "name": "GNM Studio Clay",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.72, 0.76, 0.82, 1.0],
                "metallicFactor": 0.02,
                "roughnessFactor": 0.5,
            },
            "doubleSided": True,
        }],
        "buffers": [{"byteLength": len(builder.payload)}],
        "bufferViews": builder.views,
        "accessors": builder.accessors,
        "extras": {
            "gnmVersion": "3.0",
            "source": "https://github.com/google/GNM",
            "license": "Apache-2.0",
            "expressionLabels": list(EXPRESSION_LABELS),
            "runtimeMorphTargets": list(RUNTIME_MORPH_LABELS),
            "poseMorphTargets": list(POSE_MORPH_LABELS),
            "jointNames": [str(name) for name in joint_names],
        },
    }

    json_chunk = json.dumps(document, separators=(",", ":")).encode("utf-8")
    json_chunk += b" " * ((4 - len(json_chunk) % 4) % 4)
    binary_chunk = bytes(builder.payload)
    binary_chunk += b"\0" * ((4 - len(binary_chunk) % 4) % 4)
    total_length = 12 + 8 + len(json_chunk) + 8 + len(binary_chunk)
    with destination.open("wb") as file:
        file.write(struct.pack("<4sII", b"glTF", 2, total_length))
        file.write(struct.pack("<I4s", len(json_chunk), b"JSON"))
        file.write(json_chunk)
        file.write(struct.pack("<I4s", len(binary_chunk), b"BIN\0"))
        file.write(binary_chunk)


def write_decoder(destination: Path, layers: list[tuple[np.ndarray, np.ndarray]]) -> None:
    with destination.open("wb") as file:
        file.write(b"GND1")
        file.write(struct.pack("<I", len(layers)))
        for kernel, bias in layers:
            rows, columns = kernel.shape
            file.write(struct.pack("<II", rows, columns))
            file.write(np.ascontiguousarray(kernel, dtype=np.float32).tobytes())
            file.write(np.ascontiguousarray(bias, dtype=np.float32).tobytes())


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    model = np.load(MODEL_SOURCE, allow_pickle=False)
    vertices = np.asarray(model["template_vertex_positions"], dtype=np.float32)
    triangles = np.asarray(model["triangles"], dtype=np.uint32)
    expression_basis = np.asarray(model["expression_basis"], dtype=np.float32)
    semantic_parameters = semantic_expressions()
    semantic_deltas = np.einsum("se,evc->svc", semantic_parameters, expression_basis, optimize=True)
    mouth_open_delta = np.einsum(
        "e,evc->vc", canonical_mouth_open_expression(), expression_basis, optimize=True,
    )
    mouth_open_delta = stabilize_mouth_open_delta(
        vertices,
        triangles,
        mouth_open_delta,
        model["vertex_group_names"],
        model["vertex_groups"],
    )
    morph_deltas = np.concatenate(
        [semantic_deltas, mouth_open_delta[None, ...]],
        axis=0,
    )

    destination = OUTPUT / "gnm_head_runtime.glb"
    write_glb(
        destination,
        vertices,
        triangles,
        morph_deltas.astype(np.float32),
        np.asarray(model["template_joint_positions"], dtype=np.float32),
        np.asarray(model["skinning_weights"], dtype=np.float32),
        np.asarray(model["joint_parent_indices"], dtype=np.int32),
        np.asarray(model["pose_correctives_regressor"], dtype=np.float32),
        np.asarray(model["joint_names"]),
    )
    write_decoder(
        OUTPUT / "gnm_identity_decoder.bin",
        dense_decoder(SOURCE / "identity_decoder_model.h5"),
    )
    write_decoder(
        OUTPUT / "gnm_expression_decoder.bin",
        dense_decoder(SOURCE / "expression_decoder_model.h5"),
    )
    write_anatomy(
        OUTPUT / "gnm_anatomy.gna",
        len(vertices),
        model["vertex_group_names"],
        model["vertex_groups"],
    )
    metadata = {
        "version": "3.0",
        "vertices": int(vertices.shape[0]),
        "triangles": int(triangles.shape[0]),
        "identityDimensions": int(model["vertex_identity_basis"].shape[0]),
        "expressionDimensions": int(expression_basis.shape[0]),
        "semanticExpressions": list(EXPRESSION_LABELS),
        "runtimeMorphTargets": list(RUNTIME_MORPH_LABELS),
        "poseMorphTargets": list(POSE_MORPH_LABELS),
        "jointNames": [str(name) for name in model["joint_names"]],
        "anatomicalVertexGroups": [str(name) for name in model["vertex_group_names"]],
    }
    (OUTPUT / "gnm_head_runtime.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"Wrote {destination} ({destination.stat().st_size / 1_000_000:.1f} MB)")


if __name__ == "__main__":
    main()
