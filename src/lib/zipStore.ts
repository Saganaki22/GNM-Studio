const encoder = new TextEncoder();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function u16(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true); }
function u32(view: DataView, offset: number, value: number) { view.setUint32(offset, value, true); }

export type ZipEntry = { name: string; bytes: Uint8Array; modified?: Date };

/** Builds a standards-compliant store-only ZIP. PNG data is already compressed, so deflate adds cost with negligible gain. */
export function createStoredZip(entries: ZipEntry[]) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name.replaceAll("\\", "/"));
    if (!name.length || name.length > 0xffff) throw new Error(`ZIP entry name is invalid: ${entry.name}`);
    const checksum = crc32(entry.bytes);
    const stamp = dosDateTime(entry.modified ?? new Date());
    const local = new Uint8Array(30 + name.length + entry.bytes.length);
    const localView = new DataView(local.buffer);
    u32(localView, 0, 0x04034b50);
    u16(localView, 4, 20);
    u16(localView, 6, 0x0800);
    u16(localView, 8, 0);
    u16(localView, 10, stamp.time);
    u16(localView, 12, stamp.date);
    u32(localView, 14, checksum);
    u32(localView, 18, entry.bytes.length);
    u32(localView, 22, entry.bytes.length);
    u16(localView, 26, name.length);
    u16(localView, 28, 0);
    local.set(name, 30);
    local.set(entry.bytes, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    u32(centralView, 0, 0x02014b50);
    u16(centralView, 4, 20);
    u16(centralView, 6, 20);
    u16(centralView, 8, 0x0800);
    u16(centralView, 10, 0);
    u16(centralView, 12, stamp.time);
    u16(centralView, 14, stamp.date);
    u32(centralView, 16, checksum);
    u32(centralView, 20, entry.bytes.length);
    u32(centralView, 24, entry.bytes.length);
    u16(centralView, 28, name.length);
    u16(centralView, 30, 0);
    u16(centralView, 32, 0);
    u16(centralView, 34, 0);
    u16(centralView, 36, 0);
    u32(centralView, 38, 0);
    u32(centralView, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  u32(endView, 0, 0x06054b50);
  u16(endView, 4, 0);
  u16(endView, 6, 0);
  u16(endView, 8, entries.length);
  u16(endView, 10, entries.length);
  u32(endView, 12, centralSize);
  u32(endView, 16, localOffset);
  u16(endView, 20, 0);

  const result = new Uint8Array(localOffset + centralSize + end.length);
  let offset = 0;
  for (const part of [...localParts, ...centralParts, end]) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
