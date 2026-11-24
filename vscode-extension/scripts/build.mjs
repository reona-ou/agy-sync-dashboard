import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(EXT_DIR, '..');
const RUNTIME_DIR = path.join(EXT_DIR, 'runtime');
const DIST_DIR = path.join(EXT_DIR, 'dist');

const COPY_ITEMS = [
  { src: path.join(REPO_ROOT, 'compat'), dst: path.join(RUNTIME_DIR, 'compat') },
  { src: path.join(REPO_ROOT, 'sidecars', 'dashboard'), dst: path.join(RUNTIME_DIR, 'sidecars', 'dashboard') },
  { src: path.join(REPO_ROOT, 'assets', 'logo.svg'), dst: path.join(RUNTIME_DIR, 'assets', 'logo.svg') },
];

async function copyRecursive(src, dst) {
  const st = await fsp.stat(src);
  if (st.isDirectory()) {
    await fsp.mkdir(dst, { recursive: true });
    const entries = await fsp.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '__pycache__' || entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue;
      await copyRecursive(path.join(src, entry.name), path.join(dst, entry.name));
    }
  } else {
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.copyFile(src, dst);
  }
}

// Pure-Node PNG generator for 128x128 extension icon matching assets/logo.svg palette.
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function generateExtensionIconPng(size = 128) {
  const rgba = Buffer.alloc(size * size * 4);
  const setPixel = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const idx = (y * size + x) * 4;
    const alpha = a / 255;
    const inv = 1 - alpha;
    rgba[idx] = Math.round(r * alpha + rgba[idx] * inv);
    rgba[idx + 1] = Math.round(g * alpha + rgba[idx + 1] * inv);
    rgba[idx + 2] = Math.round(b * alpha + rgba[idx + 2] * inv);
    rgba[idx + 3] = Math.min(255, rgba[idx + 3] + a);
  };

  const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
  const scale = size / 64;

  // Rounded dark card + prism border
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = x / scale;
      const gy = y / scale;
      const cx = Math.max(6 + 14, Math.min(58 - 14, gx));
      const cy = Math.max(6 + 14, Math.min(58 - 14, gy));
      const dx = gx - cx;
      const dy = gy - cy;
      const dist = Math.hypot(dx, dy) - 14;
      const t = (gx + gy - 12) / 100;
      const br = Math.round(lerp(56, 243, t));
      const bg = Math.round(lerp(189, 207, t));
      const bb = Math.round(lerp(248, 122, t));
      if (dist <= 0 && dist >= -2.8) {
        setPixel(x, y, br, bg, bb, 255);
      } else if (dist < -2.8) {
        setPixel(x, y, 14, 18, 41, 255);
      }
    }
  }

  // Gauge arc + needle + center dot + bottom dash + star
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = x / scale;
      const gy = y / scale;
      // Gauge arc (18..46, y=39..27)
      const normX = (gx - 32) / 14;
      if (Math.abs(normX) <= 1) {
        const arcY = 27 + 12 * (normX * normX);
        if (Math.abs(gy - arcY) <= 1.8) {
          const u = (gx - 18) / 28;
          const r = u < 0.5 ? lerp(56, 139, u * 2) : lerp(139, 244, (u - 0.5) * 2);
          const g = u < 0.5 ? lerp(189, 109, u * 2) : lerp(109, 114, (u - 0.5) * 2);
          const b = u < 0.5 ? lerp(248, 255, u * 2) : lerp(255, 182, (u - 0.5) * 2);
          setPixel(x, y, r, g, b, 255);
        }
      }
      // Needle (32,35) -> (39,24)
      const vx = 7;
      const vy = -11;
      const wx = gx - 32;
      const wy = gy - 35;
      const proj = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
      const dNeedle = Math.hypot(wx - proj * vx, wy - proj * vy);
      if (dNeedle <= 1.55) {
        setPixel(x, y, 243, 245, 255, 255);
      }
      // Center gold pivot (32, 36) r=3.4
      if (Math.hypot(gx - 32, gy - 36) <= 3.4) {
        setPixel(x, y, 243, 207, 122, 255);
      }
      // Dashed base line y=47, x=21..43
      if (gx >= 21 && gx <= 43 && Math.abs(gy - 47) <= 1.4 && Math.floor((gx - 21) / 4) % 2 === 0) {
        setPixel(x, y, 139, 109, 255, 255);
      }
      // Sparkle star at (18, 18)
      const sx = Math.abs(gx - 18);
      const sy = Math.abs(gy - 18);
      if (sx + sy <= 4.5 && (sx <= 1.1 || sy <= 1.1 || sx + sy <= 2.3)) {
        setPixel(x, y, 243, 207, 122, 255);
      }
    }
  }

  const rawRows = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    rawRows[rowStart] = 0;
    rgba.copy(rawRows, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const idat = zlib.deflateSync(rawRows, { level: 9 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const raw = entry.data;
    const comp = zlib.deflateRawSync(raw);
    const useStore = comp.length >= raw.length;
    const payload = useStore ? raw : comp;
    const method = useStore ? 0 : 8;
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x5421, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x5421, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildContentTypesXml() {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".cjs" ContentType="application/javascript" />
  <Default Extension=".mjs" ContentType="application/javascript" />
  <Default Extension=".html" ContentType="text/html" />
  <Default Extension=".css" ContentType="text/css" />
  <Default Extension=".svg" ContentType="image/svg+xml" />
  <Default Extension=".png" ContentType="image/png" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".txt" ContentType="text/plain" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
`;
}

function buildVsixManifest(pkg) {
  const id = escapeXml(pkg.name);
  const publisher = escapeXml(pkg.publisher);
  const version = escapeXml(pkg.version);
  const displayName = escapeXml(pkg.displayName);
  const description = escapeXml(pkg.description);
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${id}" Version="${version}" Publisher="${publisher}" />
    <DisplayName>${displayName}</DisplayName>
    <Description xml:space="preserve">${description}</Description>
    <Tags>${escapeXml((pkg.keywords || []).join(','))}</Tags>
    <Categories>${escapeXml((pkg.categories || []).join(','))}</Categories>
    <Icon>extension/assets/icon.png</Icon>
    <License>extension/LICENSE</License>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(pkg.engines?.vscode || '^1.85.0')}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/assets/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

async function collectFiles(dir, prefix, out) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name === 'dist' || entry.name === 'scripts' || entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }
    const full = path.join(dir, entry.name);
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await collectFiles(full, rel, out);
    } else if (entry.isFile()) {
      out.push({ name: rel, data: await fsp.readFile(full) });
    }
  }
}

export async function buildVsix() {
  await fsp.rm(RUNTIME_DIR, { recursive: true, force: true });
  for (const item of COPY_ITEMS) {
    await copyRecursive(item.src, item.dst);
  }

  const iconPath = path.join(EXT_DIR, 'assets', 'icon.png');
  await fsp.mkdir(path.dirname(iconPath), { recursive: true });
  await fsp.writeFile(iconPath, generateExtensionIconPng(128));

  const licenseSrc = path.join(REPO_ROOT, 'LICENSE');
  if (fs.existsSync(licenseSrc)) {
    await fsp.copyFile(licenseSrc, path.join(EXT_DIR, 'LICENSE'));
  }

  const pkg = JSON.parse(await fsp.readFile(path.join(EXT_DIR, 'package.json'), 'utf8'));
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(buildContentTypesXml(), 'utf8') },
    { name: 'extension.vsixmanifest', data: Buffer.from(buildVsixManifest(pkg), 'utf8') },
  ];
  await collectFiles(EXT_DIR, 'extension', entries);

  await fsp.mkdir(DIST_DIR, { recursive: true });
  const vsixName = `${pkg.name}-vscode-${pkg.version}.vsix`;
  const vsixPath = path.join(DIST_DIR, vsixName);
  await fsp.writeFile(vsixPath, buildZipBuffer(entries));

  return { vsixPath, fileCount: entries.length, version: pkg.version };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  buildVsix()
    .then((res) => {
      console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
