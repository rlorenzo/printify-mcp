/**
 * File utilities for Printify MCP
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { describeError, previewText } from './error-handler.js';

/**
 * Ensure a directory exists, creating it if necessary
 */
export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.error(`Created directory: ${dirPath}`);
  }
}

/**
 * Generate a temporary file path
 */
export function generateTempFilePath(
  baseDir: string,
  fileName: string,
  extension: string = 'png'
): string {
  // Ensure the directory exists
  ensureDirectoryExists(baseDir);

  // Timestamp alone collides when two files are generated in the same
  // millisecond, so mix in a random suffix.
  const suffix = randomBytes(4).toString('hex');
  const uniqueFileName = `${Date.now()}_${suffix}_${fileName}.${extension}`;
  return path.resolve(path.join(baseDir, uniqueFileName));
}

/**
 * Clean up temporary files
 */
export function cleanupFiles(filePaths: string[]): void {
  filePaths.forEach(filePath => {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.error(`Cleaned up file: ${filePath}`);
      } catch (error) {
        console.error(`Error cleaning up file ${filePath}:`, describeError(error));
      }
    }
  });
}

/**
 * Get file information
 */
export function getFileInfo(filePath: string): { exists: boolean; size?: number; stats?: fs.Stats } {
  if (!filePath) {
    return { exists: false };
  }

  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    return {
      exists: true,
      size: stats.size,
      stats
    };
  }

  return { exists: false };
}

/**
 * realpath of `p`, resolved through its deepest existing ancestor so a file
 * that does not exist yet (a write target) still has symlinks above it
 * followed. Throws for a dangling symlink, or for a segment that exists but
 * cannot be inspected (EACCES/EPERM) -- only a genuinely missing segment is
 * walked past -- and callers treat either as a denial.
 */
function realpathNearest(p: string): string {
  let existing = p;
  for (;;) {
    try {
      fs.lstatSync(existing);
      break;
    } catch (error: any) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
  }
  return path.join(fs.realpathSync(existing), path.relative(existing, p));
}

let warnedDefaultDir = false;

/**
 * Resolve a path and confirm it stays inside an allowed base directory.
 *
 * Tool arguments reach this server from a model, so a path like
 * `../../.ssh/id_rsa` is reachable input rather than a hypothetical. Uploads are
 * confined to `ALLOWED_FILE_DIR` (default: the working directory). Both sides
 * are compared by realpath so a symlink inside the directory cannot escape it.
 */
export function validateFilePath(filePath: string, operation: 'read' | 'write'): string {
  if (!process.env.ALLOWED_FILE_DIR && !warnedDefaultDir) {
    warnedDefaultDir = true;
    console.error(`ALLOWED_FILE_DIR is not set; file access is confined to the working directory "${process.cwd()}".`);
  }
  const baseDir = path.resolve(process.env.ALLOWED_FILE_DIR || process.cwd());
  const resolved = path.resolve(filePath);

  let inside = false;
  try {
    const realBase = realpathNearest(baseDir);
    const realTarget = realpathNearest(resolved);
    const prefix = realBase.endsWith(path.sep) ? realBase : realBase + path.sep;
    inside = realTarget === realBase || realTarget.startsWith(prefix);
  } catch {
    // Dangling symlink or unreadable ancestor: deny.
  }

  if (!inside) {
    const usingDefaultDir = !process.env.ALLOWED_FILE_DIR;

    // The path is model-supplied and can be any length, so both messages
    // quote a preview: it cannot flood the log, and the reason after it
    // survives any cap on the reply.

    // Operator log: a preview of the resolved path plus the full base
    // directory, including the server's absolute working directory.
    console.error(describeError(new Error(
      `File ${operation} denied: "${previewText(resolved)}" is outside the allowed directory "${baseDir}".`
    )));

    // Model-facing message: leaves the base directory out when it defaults
    // to cwd, and names the path as the caller gave it rather than
    // `resolved`, which for a relative path is prefixed with the cwd. That
    // path is server-internal detail, and echoing it back through tool output
    // is exactly what this check exists to avoid doing with other paths.
    const shown = previewText(filePath);
    throw new Error(
      usingDefaultDir
        ? `File ${operation} denied: "${shown}" is outside the allowed directory ` +
          `(the working directory; set ALLOWED_FILE_DIR to change it).`
        : `File ${operation} denied: "${shown}" is outside the allowed directory "${baseDir}". ` +
          `Set ALLOWED_FILE_DIR to permit another location.`
    );
  }

  return resolved;
}

/**
 * Turn a caller-supplied file source into a path: strip a file:// scheme
 * (file:///Users/x is the absolute path /Users/x, so its own slash stays) and
 * the leading slash of a Windows drive path from a file:// URI (/C:/x -> C:/x).
 * One rule on every platform, so every caller accepts the same inputs.
 */
export function normalizeFileUri(source: string): string {
  const filePath = source.startsWith('file://') ? source.slice('file://'.length) : source;
  return /^\/[a-zA-Z]:[\\/]/.test(filePath) ? filePath.substring(1) : filePath;
}

/**
 * Open a file confined to ALLOWED_FILE_DIR, checking the file actually opened
 * rather than only the path. The caller owns the returned descriptor and must
 * close it.
 *
 * validateFilePath checks a path at one moment; opening that path again by
 * name later (sharp(path), readFileSync(path), openSync(path)) re-resolves it,
 * so a file or a parent directory swapped for a symlink in between would be
 * followed out of the sandbox. Here the file is opened once -- with
 * O_NOFOLLOW, which refuses a swapped final component on POSIX -- then the
 * path is re-validated and must still name the very file that was opened
 * (same device and inode), which catches a swapped parent directory. Anything
 * read afterwards goes through the descriptor, never the name again.
 *
 * On a filesystem that reports no inode numbers (0 for both sides) the
 * identity check cannot tell files apart and the re-validation is what
 * remains.
 *
 * Error messages quote `filePath` as the caller gave it, never `resolved`:
 * they can reach the model, and resolving a relative path prefixes the cwd.
 */
export function openConfined(filePath: string): { fd: number; resolved: string; stats: fs.Stats } {
  const resolved = validateFilePath(filePath, 'read');

  let fd: number;
  try {
    fd = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      throw new Error(`File not found: ${previewText(filePath)}`, { cause: error });
    }
    if (error?.code === 'ELOOP') {
      throw new Error(`File read denied: "${previewText(filePath)}" is a symbolic link.`, { cause: error });
    }
    throw error;
  }

  try {
    const stats = fs.fstatSync(fd);

    // The path must still pass the sandbox check and still name the file we
    // hold open; otherwise something was swapped between check and open.
    validateFilePath(filePath, 'read');
    const current = fs.statSync(resolved);
    if (current.dev !== stats.dev || current.ino !== stats.ino) {
      throw new Error(`File read denied: "${previewText(filePath)}" changed while it was being opened.`);
    }
    return { fd, resolved, stats };
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

/**
 * The "file too large" error. Exact byte counts on both sides: rounding to MB
 * turned a file 1 byte over a 10MB limit into "10MB. Maximum size is 10MB".
 */
export function fileTooLargeMessage(size: number, maxBytes: number): string {
  return `File is too large (${size} bytes). Maximum size is ${maxBytes} bytes ` +
    `(${(maxBytes / (1024 * 1024)).toFixed(0)}MB).`;
}

/** Read a whole file through openConfined, refusing non-files, empty files and files over maxBytes. */
export function readConfinedFile(filePath: string, maxBytes: number): { resolved: string; data: Buffer } {
  const { fd, resolved, stats } = openConfined(filePath);
  try {
    if (!stats.isFile()) {
      throw new Error(`Not a regular file: ${previewText(filePath)}`);
    }
    if (stats.size === 0) {
      throw new Error(`File is empty: ${previewText(filePath)}`);
    }
    if (stats.size > maxBytes) {
      throw new Error(fileTooLargeMessage(stats.size, maxBytes));
    }
    return { resolved, data: fs.readFileSync(fd) };
  } finally {
    fs.closeSync(fd);
  }
}
