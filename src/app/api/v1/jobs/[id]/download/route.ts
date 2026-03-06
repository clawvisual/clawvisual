import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { NextResponse } from "next/server";
import { getJob } from "@/lib/queue/job-store";

export const runtime = "nodejs";

type ZipEntry = {
  name: string;
  data: Buffer;
};

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < input.length; i += 1) {
    crc = (CRC32_TABLE[(crc ^ input[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date = new Date()): { dosDate: number; dosTime: number } {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { dosDate, dosTime };
}

function createZipBuffer(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf-8");
    const { dosDate, dosTime } = toDosDateTime();
    const fileCrc = crc32(entry.data);
    const size = entry.data.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(fileCrc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(fileCrc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + size;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

function sanitizeName(input: string, fallback: string): string {
  const normalized = String(input ?? "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/_+/g, "_")
    .slice(0, 64);
  return normalized || fallback;
}

function buildTxtContent(params: { title: string; caption: string; tags: string[] }): string {
  const normalize = (value: string) => String(value ?? "").replace(/\r\n/g, "\n").trim();
  const title = normalize(params.title);
  const caption = normalize(params.caption);
  const tags = params.tags.map((item) => normalize(item)).filter(Boolean).join(", ");
  return `title: ${title}\n\ncaption: ${caption}\n\ntag: ${tags}\n`;
}

function parseDataUrl(url: string): { buffer: Buffer; mimeType: string } | null {
  const matched = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!matched) return null;

  const mimeType = matched[1] || "application/octet-stream";
  const isBase64 = Boolean(matched[2]);
  const payload = matched[3] ?? "";
  try {
    const buffer = isBase64
      ? Buffer.from(payload.replace(/\s+/g, ""), "base64")
      : Buffer.from(decodeURIComponent(payload), "utf-8");
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

function extFromMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("svg")) return "svg";
  return "png";
}

function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = extname(pathname).replace(".", "").toLowerCase();
    if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return ext;
  } catch {
    // ignore invalid url and use fallback
  }
  return "png";
}

async function readImageAsBuffer(imageUrl: string): Promise<{ buffer: Buffer; ext: string } | null> {
  if (!imageUrl) return null;

  if (imageUrl.startsWith("data:")) {
    const parsed = parseDataUrl(imageUrl);
    if (!parsed) return null;
    return { buffer: parsed.buffer, ext: extFromMimeType(parsed.mimeType) };
  }

  if (!/^https?:\/\//i.test(imageUrl)) {
    return null;
  }

  const response = await fetch(imageUrl, { cache: "no-store" });
  if (!response.ok) return null;
  const arrayBuffer = await response.arrayBuffer();
  const mimeType = response.headers.get("content-type") || "";
  const ext = mimeType ? extFromMimeType(mimeType) : extFromUrl(imageUrl);
  return { buffer: Buffer.from(arrayBuffer), ext };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!job.result) {
    return NextResponse.json({ error: "Job result is not ready yet" }, { status: 409 });
  }

  const result = job.result;
  const bundleBase = sanitizeName(result.post_title || `job_${id}`, `job_${id.slice(0, 8)}`);
  const rootDir = mkdtempSync(join(tmpdir(), "clawvisual-download-"));
  const bundleDir = join(rootDir, bundleBase);

  try {
    mkdirSync(bundleDir, { recursive: true });

    const txtContent = buildTxtContent({
      title: result.post_title,
      caption: result.post_caption,
      tags: result.hashtags
    });
    const txtPath = join(bundleDir, "post.txt");
    writeFileSync(txtPath, txtContent, "utf-8");

    const entries: ZipEntry[] = [
      {
        name: `${bundleBase}/post.txt`,
        data: Buffer.from(txtContent, "utf-8")
      }
    ];

    const imageErrors: string[] = [];
    const slides = [...result.slides].sort((a, b) => a.slide_id - b.slide_id);
    for (const slide of slides) {
      const image = await readImageAsBuffer(slide.image_url);
      if (!image) {
        imageErrors.push(`slide-${slide.slide_id}: image unavailable`);
        continue;
      }

      const fileBase = `slide-${String(slide.slide_id).padStart(2, "0")}${slide.is_cover ? "-cover" : ""}`;
      const ext = sanitizeName(image.ext, "png");
      const imageName = `${fileBase}.${ext}`;
      const imagePath = join(bundleDir, imageName);
      writeFileSync(imagePath, image.buffer);

      entries.push({
        name: `${bundleBase}/${basename(imageName)}`,
        data: image.buffer
      });
    }

    if (imageErrors.length) {
      const errorContent = `${imageErrors.join("\n")}\n`;
      const errorPath = join(bundleDir, "download-errors.txt");
      writeFileSync(errorPath, errorContent, "utf-8");
      entries.push({
        name: `${bundleBase}/download-errors.txt`,
        data: Buffer.from(errorContent, "utf-8")
      });
    }

    const zipBuffer = createZipBuffer(entries);
    const zipName = `${bundleBase}.zip`;
    const zipPath = join(rootDir, zipName);
    writeFileSync(zipPath, zipBuffer);

    return new Response(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename=\"${zipName}\"`,
        "Cache-Control": "no-store"
      }
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}
