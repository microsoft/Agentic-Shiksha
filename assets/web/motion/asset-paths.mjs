import assert from "node:assert/strict";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const imageDir = resolve(here, "..", "..", "images", "motion");
const imageExtensions = new Set([
  ".png", ".svg", ".gif", ".jpg", ".jpeg", ".webp", ".avif", ".ico",
  ".bmp", ".tif", ".tiff", ".apng", ".heic", ".heif", ".jxl",
]);

function isImage(filename) {
  assert(filename.length > 0 && filename === basename(filename) && ![".", ".."].includes(filename),
    "Motion assets must use a single basename");
  return imageExtensions.has(extname(filename).toLowerCase());
}

export function assetPath(filename) {
  return join(isImage(filename) ? imageDir : here, filename);
}

export function assetUrl(filename) {
  return `${isImage(filename) ? "../../images/motion/" : ""}${filename}`;
}
