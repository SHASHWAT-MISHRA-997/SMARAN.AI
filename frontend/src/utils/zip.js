/**
 * Zero-Dependency Pure JavaScript In-Browser ZIP Creator
 * Creates valid .zip files directly in memory using standard PKZip format.
 */

function createZip(files) {
  // files: [{ name: "index.html", content: "..." }, { name: "style.css", content: "..." }]
  const encoder = new TextEncoder();
  const fileEntries = [];
  let offset = 0;

  // Local File Headers & Data
  const parts = [];

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const contentBytes = typeof file.content === 'string' ? encoder.encode(file.content) : new Uint8Array(file.content);
    const crc = crc32(contentBytes);
    const size = contentBytes.length;

    // Local file header (30 bytes + name + content)
    const header = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(header.buffer);

    view.setUint32(0, 0x04034b50, true); // Local file header signature
    view.setUint16(4, 20, true);         // Version needed to extract (2.0)
    view.setUint16(6, 0, true);          // General purpose bit flag
    view.setUint16(8, 0, true);          // Compression method (0 = uncompressed / store)
    view.setUint16(10, 0, true);         // File last mod time
    view.setUint16(12, 0, true);         // File last mod date
    view.setUint32(14, crc, true);       // CRC-32
    view.setUint32(18, size, true);      // Compressed size
    view.setUint32(22, size, true);      // Uncompressed size
    view.setUint16(26, nameBytes.length, true); // File name length
    view.setUint16(28, 0, true);         // Extra field length

    header.set(nameBytes, 30);

    fileEntries.push({
      nameBytes,
      crc,
      size,
      offset
    });

    parts.push(header);
    parts.push(contentBytes);
    offset += header.length + contentBytes.length;
  }

  // Central Directory
  const cdOffset = offset;
  let cdSize = 0;

  for (const entry of fileEntries) {
    const cdHeader = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(cdHeader.buffer);

    view.setUint32(0, 0x02014b50, true); // Central directory file header signature
    view.setUint16(4, 20, true);         // Version made by
    view.setUint16(6, 20, true);         // Version needed to extract
    view.setUint16(8, 0, true);          // General purpose bit flag
    view.setUint16(10, 0, true);         // Compression method (0 = store)
    view.setUint16(12, 0, true);         // File last mod time
    view.setUint16(14, 0, true);         // File last mod date
    view.setUint32(16, entry.crc, true); // CRC-32
    view.setUint32(20, entry.size, true);// Compressed size
    view.setUint32(24, entry.size, true);// Uncompressed size
    view.setUint16(28, entry.nameBytes.length, true); // File name length
    view.setUint16(30, 0, true);         // Extra field length
    view.setUint16(32, 0, true);         // File comment length
    view.setUint16(34, 0, true);         // Disk number start
    view.setUint16(36, 0, true);         // Internal file attributes
    view.setUint32(38, 0, true);         // External file attributes
    view.setUint32(42, entry.offset, true); // Relative offset of local header

    cdHeader.set(entry.nameBytes, 46);

    parts.push(cdHeader);
    cdSize += cdHeader.length;
  }

  // End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const view = new DataView(eocd.buffer);

  view.setUint32(0, 0x06054b50, true); // EOCD signature
  view.setUint16(4, 0, true);          // Number of this disk
  view.setUint16(6, 0, true);          // Disk where central directory starts
  view.setUint16(8, fileEntries.length, true);  // Number of central directory records on this disk
  view.setUint16(10, fileEntries.length, true); // Total number of central directory records
  view.setUint32(12, cdSize, true);    // Size of central directory
  view.setUint32(16, cdOffset, true);  // Offset of start of central directory
  view.setUint16(20, 0, true);         // Comment length

  parts.push(eocd);

  return new Blob(parts, { type: 'application/zip' });
}

// Fast standard CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function downloadProjectZip(projectName = "project", files = []) {
  const blob = createZip(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadSingleFile(fileName, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
