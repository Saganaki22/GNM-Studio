export type SaveResult =
  | { status: "saved"; path?: string }
  | { status: "cancelled" };

export async function saveBytes(
  bytes: Uint8Array,
  suggestedName: string,
  mimeType: string,
): Promise<SaveResult> {
  if ("__TAURI_INTERNALS__" in window) {
    const [{ save }, { writeFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const path = await save({ defaultPath: suggestedName });
    if (!path) return { status: "cancelled" };
    await writeFile(path, bytes);
    return { status: "saved", path };
  }

  const blob = new Blob([bytes.slice().buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return { status: "saved" };
}

export async function saveBlob(blob: Blob, suggestedName: string): Promise<SaveResult> {
  return saveBytes(new Uint8Array(await blob.arrayBuffer()), suggestedName, blob.type);
}
