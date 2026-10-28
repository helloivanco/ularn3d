// Bakes the generated item art for the game: strips each sprite's pale card,
// bleeds its edge colors into the cleared pixels (so mipmaps don't darken the
// outline) and writes WebP with lossless alpha. The lemming illustration is
// scaled to the 256 px the game draws it at.
//
//   node scripts/bake-item-art.mjs
//
// Reads docs/art/items/*.png and docs/art/lemming.png, the generated originals
// beside their prompts; writes public/art/items/*.webp and
// public/art/monsters/lemming.webp. Needs cwebp (brew install webp).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { inflateSync } from "node:zlib";
import { bleedTransparentEdges, stripPaleSpriteBackground } from "./sprite-cleanup.mjs";

const ITEMS = "docs/art/items", ITEMS_OUT = "public/art/items";
const LEMMING = "docs/art/lemming.png", LEMMING_OUT = "public/art/monsters/lemming.webp";
// Shown at 30–90 px, quality 90 is indistinguishable from the PNG. -exact
// keeps the bled colors under transparent pixels, which cwebp would otherwise drop.
const WEBP = ["-quiet", "-q", "90", "-m", "6", "-alpha_q", "100", "-sharp_yuv", "-exact"];

/** 8-bit RGBA, non-interlaced PNG (what the generator writes) to image data. */
function decodePng(bytes) {
  let offset = 8, width = 0, height = 0;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString("latin1", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12]) throw new Error("expected an 8-bit RGBA, non-interlaced PNG");
    } else if (type === "iCCP") throw new Error("embedded color profile; convert to plain sRGB first");
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * 4, data = new Uint8ClampedArray(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = y * (stride + 1) + 1, row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? data[row + x - 4] : 0, b = y ? data[row - stride + x] : 0, c = x >= 4 && y ? data[row - stride + x - 4] : 0;
      let value = raw[line + x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      data[row + x] = value & 255;
    }
  }
  return { data, width, height };
}

const pam = ({ data, width, height }) => Buffer.concat([
  Buffer.from(`P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`),
  Buffer.from(data.buffer, data.byteOffset, data.byteLength),
]);

function bake(image, out, extra = []) {
  const work = mkdtempSync(join(tmpdir(), "item-art-")), input = join(work, "art.pam");
  try {
    writeFileSync(input, pam(image));
    execFileSync("cwebp", [...WEBP, ...extra, input, "-o", out]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return statSync(out).size;
}

mkdirSync(ITEMS_OUT, { recursive: true });
let before = 0, after = 0;
for (const name of readdirSync(ITEMS).filter((file) => file.endsWith(".png")).sort()) {
  const source = join(ITEMS, name), image = decodePng(readFileSync(source));
  stripPaleSpriteBackground(image);
  bleedTransparentEdges(image);
  before += statSync(source).size;
  after += bake(image, join(ITEMS_OUT, basename(name, ".png") + ".webp"));
}
before += statSync(LEMMING).size;
after += bake(decodePng(readFileSync(LEMMING)), LEMMING_OUT, ["-resize", "256", "256"]);
console.log(`item art: ${(before / 1048576).toFixed(1)} MB of PNG -> ${(after / 1048576).toFixed(1)} MB of WebP`);
