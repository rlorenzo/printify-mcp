/**
 * File utilities for Printify MCP
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { describeError } from './error-handler.js';

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

    // Full detail, including the server's absolute working directory, is
    // logged for the operator. The model-facing message below leaves the
    // path out when it defaults to cwd: that path is server-internal detail,
    // not something a tool caller needs, and echoing it back through tool
    // output is exactly what this whole check exists to avoid doing with
    // other paths. For the same reason it names the path as the caller gave
    // it, not `resolved`: resolving a relative path prefixes the cwd.
    console.error(describeError(new Error(
      `File ${operation} denied: "${resolved}" is outside the allowed directory "${baseDir}".`
    )));

    throw new Error(
      usingDefaultDir
        ? `File ${operation} denied: "${filePath}" is outside the allowed directory ` +
          `(the working directory; set ALLOWED_FILE_DIR to change it).`
        : `File ${operation} denied: "${filePath}" is outside the allowed directory "${baseDir}". ` +
          `Set ALLOWED_FILE_DIR to permit another location.`
    );
  }

  return resolved;
}
