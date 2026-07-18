import { assetUrl } from "./assets.ts";

export type GnmAnatomy = {
  vertexCount: number;
  groups: ReadonlyMap<string, Uint16Array>;
};

export function parseGnmAnatomy(buffer: ArrayBuffer): GnmAnatomy {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10 || new TextDecoder().decode(bytes.subarray(0, 4)) !== "GNA1") {
    throw new Error("The bundled GNM anatomy asset has an invalid header.");
  }
  const view = new DataView(buffer);
  const vertexCount = view.getUint32(4, true);
  const groupCount = view.getUint16(8, true);
  const groups = new Map<string, Uint16Array>();
  const decoder = new TextDecoder();
  let offset = 10;
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    if (offset >= bytes.length) throw new Error("The bundled GNM anatomy asset ended inside a group header.");
    const nameLength = bytes[offset];
    offset += 1;
    if (!nameLength || offset + nameLength + 4 > bytes.length) throw new Error("The bundled GNM anatomy asset contains an invalid group name.");
    const name = decoder.decode(bytes.subarray(offset, offset + nameLength));
    offset += nameLength;
    const memberCount = view.getUint32(offset, true);
    offset += 4;
    const byteLength = memberCount * 2;
    if (offset + byteLength > bytes.length) throw new Error(`The bundled GNM anatomy group ${name} is truncated.`);
    const members = new Uint16Array(memberCount);
    for (let index = 0; index < memberCount; index += 1) members[index] = view.getUint16(offset + index * 2, true);
    if (members.some((vertex) => vertex >= vertexCount)) throw new Error(`The bundled GNM anatomy group ${name} contains an out-of-range vertex.`);
    groups.set(name, members);
    offset += byteLength;
  }
  if (offset !== bytes.length) throw new Error("The bundled GNM anatomy asset has unexpected trailing bytes.");
  return { vertexCount, groups };
}

let anatomyPromise: Promise<GnmAnatomy> | null = null;

export function loadGnmAnatomy() {
  anatomyPromise ??= fetch(assetUrl("models/gnm_anatomy.gna"))
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then(parseGnmAnatomy);
  return anatomyPromise;
}

export function anatomyMembership(anatomy: GnmAnatomy, name: string) {
  const result = new Uint8Array(anatomy.vertexCount);
  const members = anatomy.groups.get(name);
  if (!members) throw new Error(`The bundled GNM anatomy is missing ${name}.`);
  for (const vertex of members) result[vertex] = 1;
  return result;
}
