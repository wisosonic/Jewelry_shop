import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { authenticate, authorize } from "../../middleware/auth";
import { AppError } from "../../utils/AppError";
import { asyncHandler } from "../../utils/asyncHandler";

/** Route for admin-only image uploads, storing files on local disk. */

const UPLOAD_DIR = path.join(__dirname, "../../../uploads");
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Detects an image's real format from its magic bytes, independent of
 * whatever `Content-Type`/filename the client claims. This is the
 * *authoritative* check - the stored file's extension is derived from this
 * result, never from `file.originalname` - because a client-declared
 * `mimetype` is just a request header an attacker fully controls. Without
 * this, an admin session (compromised or malicious) could upload a file
 * named `x.png` with a spoofed `image/png` header whose actual content is
 * an SVG carrying a `<script>` tag; stored with a `.svg` extension (taken
 * from the filename) and served directly by `express.static` with
 * `crossOriginResourcePolicy: cross-origin` (see app.ts), that would
 * execute as script for anyone who opens the uploaded URL directly - a
 * stored-XSS path the MIME allowlist below was supposed to prevent
 * entirely but didn't, since it never inspected actual content.
 */
function detectImageExtension(buffer: Buffer): "jpg" | "png" | "webp" | "gif" | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }
  if (buffer.length >= 6 && buffer.toString("ascii", 0, 3) === "GIF" && ["7", "9"].includes(buffer.toString("ascii", 4, 5))) {
    return "gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

// Buffered in memory (not multer's diskStorage) since the file's content
// has to be inspected - via detectImageExtension() above - before it's
// written to disk at all; diskStorage would already have streamed an
// unvalidated file to disk by the time a handler could inspect it. Capped
// by the same 5MB limit either way, so this isn't a meaningfully bigger
// memory footprint for images this size.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Cheap, early, non-authoritative rejection of an obviously-wrong
    // declared type, before even buffering the upload - the real check is
    // detectImageExtension() below, once the content is available.
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error("Only JPEG, PNG, WEBP or GIF images are allowed"));
    }
    cb(null, true);
  },
});

export const uploadsRouter = Router();

uploadsRouter.post(
  "/image",
  authenticate,
  authorize("ADMIN"),
  // Wraps multer's callback-style error (e.g. disallowed MIME type, file too
  // large) into an AppError so it flows through the standard error handler.
  (req, res, next) => {
    upload.single("image")(req, res, (err) => {
      if (err) return next(AppError.badRequest(err.message));
      next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest("No image file provided");

    const extension = detectImageExtension(req.file.buffer);
    if (!extension) {
      throw AppError.badRequest("The file's content doesn't match a supported image format (JPEG, PNG, WEBP, or GIF).");
    }

    const filename = `${crypto.randomUUID()}.${extension}`;
    await fs.writeFile(path.join(UPLOAD_DIR, filename), req.file.buffer);
    res.status(201).json({ url: `/uploads/${filename}` });
  })
);
