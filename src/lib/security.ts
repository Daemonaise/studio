/**
 * Security utilities for Karaslice.
 *
 * Upload validation, rate limiting, and input sanitization.
 */

// ─── Upload Validation ───────────────────────────────────────────────────────

/** Allowed file extensions for mesh uploads. */
const ALLOWED_EXTENSIONS = new Set([".stl", ".obj", ".3mf", ".ply", ".off"]);

/** Maximum upload size in bytes (200 MB). */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Maximum filename length. */
const MAX_FILENAME_LENGTH = 255;

/** Magic bytes for known mesh formats. */
const MAGIC_BYTES: { ext: string; magic: number[]; offset?: number }[] = [
  // STL binary starts with 80-byte header then 4-byte triangle count — no fixed magic
  // 3MF is a ZIP file
  { ext: ".3mf", magic: [0x50, 0x4b, 0x03, 0x04] }, // PK\x03\x04
];

export interface UploadValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validate an uploaded file before processing or storage.
 */
export function validateUpload(file: File): UploadValidation {
  // 1. Check file size
  if (file.size === 0) {
    return { valid: false, error: "File is empty" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { valid: false, error: `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit` };
  }

  // 2. Check filename length
  if (file.name.length > MAX_FILENAME_LENGTH) {
    return { valid: false, error: "Filename is too long" };
  }

  // 3. Check extension
  const ext = getExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File type "${ext}" is not supported. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}` };
  }

  // 4. Check for path traversal in filename
  if (file.name.includes("..") || file.name.includes("/") || file.name.includes("\\")) {
    return { valid: false, error: "Invalid filename" };
  }

  return { valid: true };
}

/**
 * Validate file content bytes (magic byte check for known formats).
 */
export function validateFileContent(buffer: ArrayBuffer, fileName: string): UploadValidation {
  const ext = getExtension(fileName);
  const bytes = new Uint8Array(buffer);

  // For 3MF, verify ZIP magic bytes
  if (ext === ".3mf") {
    const entry = MAGIC_BYTES.find((m) => m.ext === ".3mf");
    if (entry && !matchMagic(bytes, entry.magic, entry.offset ?? 0)) {
      return { valid: false, error: "File does not appear to be a valid 3MF archive" };
    }
  }

  // For STL, check if it's ASCII STL (starts with "solid") or binary STL (80-byte header + face count)
  if (ext === ".stl") {
    if (bytes.length < 84) {
      return { valid: false, error: "STL file is too small to be valid" };
    }
    // ASCII STL check
    const header = String.fromCharCode(...bytes.slice(0, 6));
    if (!header.startsWith("solid")) {
      // Binary STL: verify face count matches file size
      const view = new DataView(buffer);
      const faceCount = view.getUint32(80, true);
      const expectedSize = 84 + faceCount * 50;
      // Allow some tolerance for padding
      if (Math.abs(bytes.length - expectedSize) > 100 && faceCount > 0) {
        return { valid: false, error: "Binary STL face count does not match file size" };
      }
    }
  }

  // For OBJ, check for at least one vertex line
  if (ext === ".obj") {
    // Quick check: file should contain "v " somewhere in first 10KB
    const sample = String.fromCharCode(...bytes.slice(0, Math.min(10240, bytes.length)));
    if (!sample.includes("v ") && !sample.includes("v\t")) {
      return { valid: false, error: "OBJ file does not appear to contain vertex data" };
    }
  }

  return { valid: true };
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

function matchMagic(bytes: Uint8Array, magic: number[], offset: number): boolean {
  for (let i = 0; i < magic.length; i++) {
    if (bytes[offset + i] !== magic[i]) return false;
  }
  return true;
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory rate limiter.
 * For production, use Redis or Upstash — this handles single-instance protection.
 */
class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(windowMs: number, maxRequests: number) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  /**
   * Check if a request from the given key should be allowed.
   * Returns { allowed: true } or { allowed: false, retryAfterMs }.
   */
  check(key: string): { allowed: boolean; retryAfterMs?: number } {
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
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now >= entry.resetAt) this.store.delete(key);
    }
  }
}

// Pre-configured limiters for different endpoints
export const uploadLimiter = new RateLimiter(60_000, 20);       // 20 uploads per minute
export const repairLimiter = new RateLimiter(300_000, 10);      // 10 repair jobs per 5 minutes
export const analysisLimiter = new RateLimiter(60_000, 30);     // 30 analysis requests per minute
export const apiLimiter = new RateLimiter(60_000, 100);         // 100 API calls per minute
export const nameUpdateLimiter = new RateLimiter(60_000, 5);    // 5 name updates per minute

// Clean up every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    uploadLimiter.cleanup();
    repairLimiter.cleanup();
    analysisLimiter.cleanup();
    apiLimiter.cleanup();
    nameUpdateLimiter.cleanup();
  }, 300_000);
}

// ─── Input Sanitization ──────────────────────────────────────────────────────

/**
 * Sanitize a storage path to prevent path traversal attacks.
 * Rejects paths with "..", absolute paths, and null bytes.
 */
export function sanitizeStoragePath(path: string): { valid: boolean; error?: string } {
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
  // Must start with expected prefix
  if (!path.startsWith("Karaslice/")) {
    return { valid: false, error: "Invalid storage path prefix" };
  }
  return { valid: true };
}

/**
 * Sanitize user-provided name input.
 */
export function sanitizeName(name: string): { valid: boolean; sanitized: string; error?: string } {
  if (!name || typeof name !== "string") {
    return { valid: false, sanitized: "", error: "Name is required" };
  }
  // Strip HTML tags and control characters
  const cleaned = name
    .replace(/<[^>]*>/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();

  if (cleaned.length < 2) {
    return { valid: false, sanitized: cleaned, error: "Name must be at least 2 characters" };
  }
  if (cleaned.length > 100) {
    return { valid: false, sanitized: cleaned.slice(0, 100), error: "Name is too long" };
  }
  return { valid: true, sanitized: cleaned };
}
