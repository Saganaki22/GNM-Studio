export async function readMaybeGzippedRuntime(response: Response, magic: string) {
  if (!response.ok) throw new Error(`Could not load the web runtime (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const expected = new TextEncoder().encode(magic);
  const hasMagic = expected.every((value, index) => bytes[index] === value);
  if (hasMagic) return bytes.buffer;
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new Error(`The downloaded web runtime is neither ${magic} data nor gzip data.`);
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser does not support local gzip decompression. Use a current Chromium, Firefox, or Safari release.");
  }
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}
