"""Build the lazy browser-only quantized 383-component GNM expression basis."""

from __future__ import annotations

import gzip
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src-tauri" / "resources" / "gnm_head.npz"
DESTINATION = ROOT / "webapp-assets" / "models" / "gnm_expression_basis.gne.gz"


def main() -> None:
    with np.load(SOURCE) as model:
        basis = np.asarray(model["expression_basis"], dtype=np.float32)

    components, vertices, axes = basis.shape
    if components != 383 or axes != 3:
        raise ValueError(f"Unexpected GNM expression dimensions: {basis.shape}")
    scales = np.maximum(np.max(np.abs(basis), axis=1) / 127.0, 1e-12).astype("<f4")
    quantized = np.clip(np.rint(basis / scales[:, None, :]), -127, 127).astype(np.int8)
    reconstructed = quantized.astype(np.float32) * scales[:, None, :]
    rms_error = float(np.sqrt(np.mean((reconstructed - basis) ** 2)))
    max_error = float(np.max(np.abs(reconstructed - basis)))
    payload = struct.pack("<4sIII", b"GNE1", components, vertices, axes) + scales.tobytes() + quantized.tobytes()
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    with DESTINATION.open("wb") as output:
        with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=6, mtime=0) as compressed:
            compressed.write(payload)
    print(
        f"Wrote {DESTINATION.relative_to(ROOT)}: {DESTINATION.stat().st_size:,} compressed bytes, "
        f"{components} components, {vertices} vertices, RMS {rms_error:.3e}, max {max_error:.3e}."
    )


if __name__ == "__main__":
    main()
