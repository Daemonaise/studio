import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const ALLOWED_EXTENSIONS = /* @__PURE__ */ new Set([".stl", ".obj", ".3mf", ".ply", ".off"]);
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 255;
const MAGIC_BYTES = [
  // STL binary starts with 80-byte header then 4-byte triangle count — no fixed magic
  // 3MF is a ZIP file
  { ext: ".3mf", magic: [80, 75, 3, 4] }
  // PK\x03\x04
];
function validateUpload(file) {
  if (file.size === 0) {
    return { valid: false, error: "File is empty" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { valid: false, error: `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit` };
  }
  if (file.name.length > MAX_FILENAME_LENGTH) {
    return { valid: false, error: "Filename is too long" };
  }
  const ext = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File type "${ext}" is not supported. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}` };
  }
  if (file.name.includes("..") || file.name.includes("/") || file.name.includes("\\")) {
    return { valid: false, error: "Invalid filename" };
  }
  return { valid: true };
}
function validateFileContent(buffer, fileName) {
  const ext = getExtension(fileName);
  const bytes = new Uint8Array(buffer);
  if (ext === ".3mf") {
    const entry = MAGIC_BYTES.find((m) => m.ext === ".3mf");
    if (entry && !matchMagic(bytes, entry.magic, entry.offset ?? 0)) {
      return { valid: false, error: "File does not appear to be a valid 3MF archive" };
    }
  }
  if (ext === ".stl") {
    if (bytes.length < 84) {
      return { valid: false, error: "STL file is too small to be valid" };
    }
    const header = String.fromCharCode(...bytes.slice(0, 6));
    if (!header.startsWith("solid")) {
      const view = new DataView(buffer);
      const faceCount = view.getUint32(80, true);
      const expectedSize = 84 + faceCount * 50;
      if (Math.abs(bytes.length - expectedSize) > 100 && faceCount > 0) {
        return { valid: false, error: "Binary STL face count does not match file size" };
      }
    }
  }
  if (ext === ".obj") {
    const sample = String.fromCharCode(...bytes.slice(0, Math.min(10240, bytes.length)));
    if (!sample.includes("v ") && !sample.includes("v	")) {
      return { valid: false, error: "OBJ file does not appear to contain vertex data" };
    }
  }
  return { valid: true };
}
function getExtension(filename) {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}
function matchMagic(bytes, magic, offset) {
  for (let i = 0; i < magic.length; i++) {
    if (bytes[offset + i] !== magic[i]) return false;
  }
  return true;
}
class RateLimiter {
  constructor(windowMs, maxRequests) {
    __publicField(this, "store", /* @__PURE__ */ new Map());
    __publicField(this, "windowMs");
    __publicField(this, "maxRequests");
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }
  /**
   * Check if a request from the given key should be allowed.
   * Returns { allowed: true } or { allowed: false, retryAfterMs }.
   */
  check(key) {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || now >= entry.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true };
    }
    if (entry.count >= this.maxRequests) {
      return { allowed: false, retryAfterMs: entry.resetAt - now };
    }
    entry.count++;
    return { allowed: true };
  }
  /** Periodic cleanup of expired entries. */
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now >= entry.resetAt) this.store.delete(key);
    }
  }
}
const uploadLimiter = new RateLimiter(6e4, 20);
const repairLimiter = new RateLimiter(3e5, 10);
const analysisLimiter = new RateLimiter(6e4, 30);
const apiLimiter = new RateLimiter(6e4, 100);
const nameUpdateLimiter = new RateLimiter(6e4, 5);
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    uploadLimiter.cleanup();
    repairLimiter.cleanup();
    analysisLimiter.cleanup();
    apiLimiter.cleanup();
    nameUpdateLimiter.cleanup();
  }, 3e5);
}
function sanitizeStoragePath(path) {
  if (!path || path.length === 0) {
    return { valid: false, error: "Empty path" };
  }
  if (path.length > 1024) {
    return { valid: false, error: "Path too long" };
  }
  if (path.includes("..")) {
    return { valid: false, error: "Path traversal detected" };
  }
  if (path.includes("\0")) {
    return { valid: false, error: "Null byte in path" };
  }
  if (path.startsWith("/") || path.startsWith("\\")) {
    return { valid: false, error: "Absolute path not allowed" };
  }
  if (!path.startsWith("Karaslice/")) {
    return { valid: false, error: "Invalid storage path prefix" };
  }
  return { valid: true };
}
function sanitizeName(name) {
  if (!name || typeof name !== "string") {
    return { valid: false, sanitized: "", error: "Name is required" };
  }
  const cleaned = name.replace(/<[^>]*>/g, "").replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (cleaned.length < 2) {
    return { valid: false, sanitized: cleaned, error: "Name must be at least 2 characters" };
  }
  if (cleaned.length > 100) {
    return { valid: false, sanitized: cleaned.slice(0, 100), error: "Name is too long" };
  }
  return { valid: true, sanitized: cleaned };
}
export {
  MAX_UPLOAD_BYTES,
  analysisLimiter,
  apiLimiter,
  nameUpdateLimiter,
  repairLimiter,
  sanitizeName,
  sanitizeStoragePath,
  uploadLimiter,
  validateFileContent,
  validateUpload
};
