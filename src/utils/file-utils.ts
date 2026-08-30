/**
 * File utilities for Printify MCP
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

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
        console.error(`Error cleaning up file ${filePath}:`, error);
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
 * Resolve a path and confirm it stays inside an allowed base directory.
 *
 * Tool arguments reach this server from a model, so a path like
 * `../../.ssh/id_rsa` is reachable input rather than a hypothetical. Uploads are
 * confined to `ALLOWED_FILE_DIR` (default: the working directory).
 */
export function validateFilePath(filePath: string, operation: 'read' | 'write'): string {
  const baseDir = path.resolve(process.env.ALLOWED_FILE_DIR || process.cwd());
  const resolved = path.resolve(filePath);

  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
    throw new Error(
      `File ${operation} denied: "${resolved}" is outside the allowed directory "${baseDir}". ` +
      `Set ALLOWED_FILE_DIR to permit another location.`
    );
  }

  return resolved;
}
