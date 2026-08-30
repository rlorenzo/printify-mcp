/**
 * Printify upload service for Printify MCP
 */
// No need for fs and path imports
import { PrintifyAPI } from '../printify-api.js';
import { formatErrorResponse, formatSuccessResponse } from '../utils/error-handler.js';
import { getFileInfo, validateFilePath } from '../utils/file-utils.js';

/**
 * Normalize a file path
 */
function normalizeFilePath(filePath: string): string {
  let normalizedPath = filePath;

  // Handle file:// URLs. Strip only the scheme: file:///Users/x is the
  // absolute path /Users/x, so the third slash must survive.
  if (normalizedPath.startsWith('file://')) {
    normalizedPath = normalizedPath.slice('file://'.length);
  }

  // Handle leading slash on Windows
  if (process.platform === 'win32' && normalizedPath.startsWith('/')) {
    normalizedPath = normalizedPath.substring(1);
  }

  return normalizedPath;
}

/**
 * Attach file diagnostics for a failed file upload.
 *
 * Only a path that passes read validation is inspected. Statting or reading a
 * rejected path would let a caller-supplied source such as `/etc/passwd`
 * disclose file metadata and leading bytes through the error report, so a
 * refusal is recorded and nothing is touched on disk.
 */
async function addFileDiagnostics(diagnosticInfo: any, source: string): Promise<void> {
  let filePath: string;
  try {
    filePath = validateFilePath(normalizeFilePath(source), 'read');
  } catch {
    diagnosticInfo.PathRejected = 'Path failed validation; file diagnostics were skipped';
    return;
  }

  const fileInfo = getFileInfo(filePath);
  diagnosticInfo.FileExists = fileInfo.exists;
  diagnosticInfo.FileSize = fileInfo.exists ? fileInfo.size + ' bytes' : 'N/A';
  if (!fileInfo.exists) return;

  try {
    const [fsModule, pathModule] = await Promise.all([import('fs'), import('path')]);
    const fs = fsModule.default || fsModule;
    const path = pathModule.default || pathModule;

    const stats = fs.statSync(filePath);
    diagnosticInfo.FileCreated = stats.birthtime;
    diagnosticInfo.FileModified = stats.mtime;
    diagnosticInfo.FilePermissions = stats.mode.toString(8);
    diagnosticInfo.AbsolutePath = path.resolve(filePath);

    try {
      const buffer = Buffer.alloc(10);
      // The descriptor is closed in `finally`: readSync throws EISDIR on a
      // directory, and leaking a descriptor on every such upload would
      // eventually exhaust the process's limit.
      const fd = fs.openSync(filePath, 'r');
      let bytesRead: number;
      try {
        bytesRead = fs.readSync(fd, buffer, 0, 10, 0);
      } finally {
        fs.closeSync(fd);
      }
      diagnosticInfo.FileReadable = true;
      diagnosticInfo.BytesRead = bytesRead;
      diagnosticInfo.FileFirstBytes = buffer.toString('hex').substring(0, 20);

      const hexSignature = buffer.toString('hex').substring(0, 8).toLowerCase();
      diagnosticInfo.DetectedFileType = detectImageType(hexSignature);
      diagnosticInfo.FileSignature = hexSignature;
    } catch (readError: any) {
      diagnosticInfo.FileReadable = false;
      diagnosticInfo.FileReadError = readError.message || String(readError);
    }
  } catch (statError: any) {
    diagnosticInfo.FileStatError = statError.message || String(statError);
  }
}

/** Name the image format behind a file's leading magic bytes. */
function detectImageType(hexSignature: string): string {
  if (hexSignature.startsWith('89504e47')) return 'PNG';
  if (hexSignature.startsWith('ffd8ffe')) return 'JPEG';
  if (hexSignature.startsWith('52494646')) return 'WEBP';
  if (hexSignature.startsWith('3c737667')) return 'SVG';
  return 'unknown';
}

/**
 * Determine the source type of an image input
 */
export function determineImageSourceType(source: string): 'url' | 'file' | 'base64' {
  // Check if it's a URL
  if (source.startsWith('http://') || source.startsWith('https://')) {
    return 'url';
  }

  // Check if it's a file path
  if (source.includes(':\\') || source.includes(':/') || source.startsWith('/') || source.includes('\\')) {
    return 'file';
  }

  // Otherwise assume it's base64
  return 'base64';
}

/**
 * Confirm a file is present and readable before handing it to the SDK, logging
 * what was observed.
 *
 * Diagnostics only, plus the one throw that matters: an upload of a file that
 * vanished between validation and use fails here with a clear message rather
 * than inside the SDK.
 */
async function verifyFileReadable(filePath: string): Promise<void> {
  try {
    const fs = await import('fs');
    const path = await import('path');

    // Open once and inspect through the descriptor. Checking existence,
    // permissions and readability as separate path lookups re-resolves the name
    // each time, so the file could be swapped between the check and the use
    // (TOCTOU). A single open gives one handle to one inode: a missing file
    // raises ENOENT and an unreadable one EACCES, which is the same information
    // the separate checks produced.
    let fd: number;
    try {
      fd = fs.openSync(filePath, 'r');
    } catch (openError: any) {
      if (openError?.code === 'ENOENT') {
        console.error(`ERROR: File does not exist at upload time: ${filePath}`);
        throw new Error(`File does not exist at upload time: ${filePath}`, { cause: openError });
      }
      console.error(`ERROR: File is not readable at upload time: ${filePath}`);
      throw new Error(`File is not readable at upload time: ${filePath}`, { cause: openError });
    }

    try {
      const stats = fs.fstatSync(fd);
      console.error(`File verification before upload:`);
      console.error(`- Path: ${filePath}`);
      console.error(`- Absolute path: ${path.resolve(filePath)}`);
      console.error(`- Size: ${stats.size} bytes`);
      console.error(`- Created: ${stats.birthtime}`);
      console.error(`- Permissions: ${stats.mode.toString(8)}`);

      try {
        const buffer = Buffer.alloc(10);
        const bytesRead = fs.readSync(fd, buffer, 0, 10, 0);
        console.error(`- Readable: Yes`);
        console.error(`- Read test: Successfully read ${bytesRead} bytes`);
      } catch (readError: any) {
        console.error(`- Read test failed: ${readError.message || readError}`);
      }

      // Copy of every uploaded file, written only when explicitly enabled.
      if (process.env.PRINTIFY_MCP_DEBUG) {
        try {
          const debugDir = path.join(process.cwd(), 'debug');
          // recursive:true is idempotent, so no existence check is needed.
          fs.mkdirSync(debugDir, { recursive: true });
          const debugFilePath = path.join(debugDir, `upload_${Date.now()}_${path.basename(filePath)}`);
          // Written from the open descriptor rather than re-opening by name.
          fs.writeFileSync(debugFilePath, fs.readFileSync(fd));
          console.error(`- Debug copy: ${debugFilePath}`);
        } catch (copyError: any) {
          console.error(`- Debug copy failed: ${copyError.message || copyError}`);
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch (verifyError: any) {
    console.error('Error verifying file before upload:', verifyError);
    throw new Error(`Failed to verify file before upload: ${verifyError.message || verifyError}`, { cause: verifyError });
  }
}

/**
 * Upload an image to Printify from various sources
 */
export async function uploadImageToPrintify(
  printifyClient: PrintifyAPI,
  fileName: string,
  source: string
) {
  try {
    // Validate shop is selected
    const currentShop = printifyClient.getCurrentShop();
    if (!currentShop) {
      throw new Error('No shop is currently selected. Use the list-shops and switch-shop tools to select a shop.');
    }

    // Determine the source type
    const sourceType = determineImageSourceType(source);
    console.error(`Uploading image to Printify from ${sourceType} source`);

    let image;

    if (sourceType === 'file') {
      // Handle file upload
      const filePath = validateFilePath(normalizeFilePath(source), 'read');

      // Validate file exists
      const fileInfo = getFileInfo(filePath);
      if (!fileInfo.exists) {
        throw new Error(`File not found: ${filePath}`);
      }

      console.error(`Uploading file to Printify: ${filePath}`);
      console.error(`File size: ${fileInfo.size} bytes`);

      // Check file size limits
      if (fileInfo.size && fileInfo.size > 20 * 1024 * 1024) { // 20MB limit
        throw new Error(`File is too large (${Math.round(fileInfo.size / (1024 * 1024))}MB). Maximum size is 20MB.`);
      }

      await verifyFileReadable(filePath);

      // Upload to Printify
      console.error(`Attempting to upload file to Printify: ${filePath}`);
      image = await printifyClient.uploadImage(fileName, filePath);
      console.error(`Upload successful! Image ID: ${image.id}`);
      console.error(`Preview URL: ${image.preview_url}`);
    } else {
      // For URLs and base64 strings, upload directly
      image = await printifyClient.uploadImage(fileName, source);
    }

    console.error(`Image uploaded successfully! ID: ${image.id}`);

    return {
      success: true,
      image,
      response: formatSuccessResponse(
        'Image Uploaded Successfully',
        {
          'Image ID': image.id,
          'File Name': image.file_name,
          'Dimensions': `${image.width}x${image.height}`,
          'Preview URL': image.preview_url
        },
        `You can now use this image ID (${image.id}) when creating a product.\n\n` +
        `**Example:**\n` +
        `\`\`\`json\n` +
        `"print_areas": {\n` +
        `  "front": { "position": "front", "imageId": "${image.id}" }\n` +
        `}\n` +
        `\`\`\``
      )
    };
  } catch (error: any) {
    console.error('Error uploading image to Printify:', error);

    // Determine source type for better error messages
    const sourceType = determineImageSourceType(source);
    const sourceTypeLabel = sourceType === 'url' ? 'URL' :
                           sourceType === 'file' ? 'file path' :
                           'base64 string';

    // Create appropriate troubleshooting tips based on source type
    const tips = [
      'Check that your Printify API key is valid',
      'Ensure your Printify account is properly connected'
    ];

    if (sourceType === 'url') {
      tips.push('Make sure the URL is publicly accessible and points directly to an image file');
      tips.push('The URL must start with http:// or https://');
    } else if (sourceType === 'file') {
      tips.push('Make sure the file exists and is readable');
      tips.push('Check that the path is correct and includes the full path to the file');
      tips.push('The file must be a valid image format (PNG, JPEG, SVG)');
      tips.push('Recommended resolution for JPEG/PNG files is 300 DPI');
      tips.push('Maximum file size is 20MB');
    } else {
      tips.push('Make sure the base64 string is valid and represents an image');
    }

    // Gather as much diagnostic information as possible
    const diagnosticInfo: any = {
      FileName: fileName,
      SourceType: sourceTypeLabel,
      Source: sourceType === 'url' ? source : (sourceType === 'file' ? source : `${source.substring(0, 30)}...`),
      CurrentShop: printifyClient.getCurrentShop(),
      ErrorType: error.constructor.name,
      ErrorStack: error.stack,
      ErrorMessage: error.message,
      CurrentWorkingDirectory: process.cwd(),
      NodeVersion: process.version,
      Platform: process.platform,
      // Add Printify client information
      PrintifyClientInitialized: !!printifyClient,
      PrintifyShopId: printifyClient.getCurrentShopId(),
      PrintifyAvailableShops: printifyClient.getAvailableShops().length
    };

    // Add file-specific diagnostics if it's a file
    if (sourceType === 'file') {
      await addFileDiagnostics(diagnosticInfo, source);
    }

    // Add error details if available
    if (error.response) {
      diagnosticInfo.PrintifyResponseStatus = error.response.status;
      diagnosticInfo.PrintifyResponseStatusText = error.response.statusText;
      diagnosticInfo.PrintifyResponseData = error.response.data;
      diagnosticInfo.PrintifyResponseHeaders = error.response.headers;
    }

    return {
      success: false,
      error,
      errorResponse: formatErrorResponse(
        error,
        `Printify Upload (${sourceTypeLabel})`,
        diagnosticInfo,
        tips
      )
    };
  }
}
