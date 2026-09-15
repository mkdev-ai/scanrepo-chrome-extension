// Bundle dist/ into a zip that can be uploaded to the Chrome Web Store or loaded
// as an unpacked extension. Run `npm run build` first.
import { createWriteStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const out = path.join(root, `scanrepo-github-extension-${packageJson.version}.zip`);

/** @param {string} dir @param {string} [prefix] @returns {Promise<Array<{abs: string, rel: string}>>} */
async function walk(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await walk(abs, rel)));
    } else if (entry.isFile()) {
      files.push({ abs, rel });
    }
  }
  return files;
}

const files = await walk(dist);
if (files.length === 0) {
  console.error('dist/ is empty — run `npm run build` first.');
  process.exit(1);
}

// Minimal ZIP writer: the build needs no dependency for a handful of small files.
/** @type {Buffer[]} */
const chunks = [];
/** @type {Array<{name: Buffer, crc: number, size: number, offset: number}>} */
const central = [];
let offset = 0;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

/** @param {Buffer} buffer */
function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

for (const { abs, rel } of files) {
  const content = await readFile(abs);
  const compressed = deflateRawSync(content, { level: 9 });
  const name = Buffer.from(rel, 'utf8');
  const crc = crc32(content);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(0, 10); // time
  local.writeUInt16LE(0, 12); // date
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28); // extra length

  chunks.push(local, name, compressed);
  central.push({ name, crc, size: content.length, offset, compressedSize: compressed.length });
  offset += local.length + name.length + compressed.length;
}

const centralStart = offset;
for (const entry of central) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);
  chunks.push(header, entry.name);
  offset += header.length + entry.name.length;
}

const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(central.length, 8);
end.writeUInt16LE(central.length, 10);
end.writeUInt32LE(offset - centralStart, 12);
end.writeUInt32LE(centralStart, 16);
end.writeUInt16LE(0, 20);
chunks.push(end);

await new Promise((resolve, reject) => {
  const stream = createWriteStream(out);
  stream.on('error', reject);
  stream.on('finish', resolve);
  for (const chunk of chunks) stream.write(chunk);
  stream.end();
});

const { size } = await stat(out);
console.log(`packaged ${central.length} files → ${path.basename(out)} (${(size / 1024).toFixed(1)} kb)`);