/**
 * Printify upload service.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrintifyAPI, requireShop } from '../printify-api.js';
import { describeError, formatErrorResponse, formatSuccessResponse, previewText, TIPS } from '../utils/error-handler.js';
import { getFileInfo, openConfined, validateFilePath } from '../utils/file-utils.js';
import { saveDebugCopy } from './image-format.js';

/** Strip a file:// scheme (keeping the path's own leading slash). */
function normalizeFilePath(filePath: string): string {
  let normalizedPath = filePath;

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
 * Attach file diagnostics for a failed file upload. The file is inspected only
 * through openConfined's descriptor, so a rejected path's metadata is never
 * disclosed and a path swapped after validation is never followed. No
 * absolute path is reported: the details are returned to the model, and the
 * resolved path would reveal the server's working directory.
 */
async function addFileDiagnostics(diagnosticInfo: any, source: string): Promise<void> {
  let handle: ReturnType<typeof openConfined>;
  try {
    handle = openConfined(normalizeFilePath(source));
  } catch (error: any) {
    if (error?.cause?.code === 'ENOENT') {
      diagnosticInfo.FileExists = false;
      diagnosticInfo.FileSize = 'N/A';
    } else {
      diagnosticInfo.PathRejected = 'Path failed validation; file diagnostics were skipped';
    }
    return;
  }

  const { fd, stats } = handle;
  try {
    diagnosticInfo.FileExists = true;
    diagnosticInfo.FileSize = stats.size + ' bytes';
    diagnosticInfo.FileCreated = stats.birthtime;
    diagnosticInfo.FileModified = stats.mtime;
    diagnosticInfo.FilePermissions = stats.mode.toString(8);

    try {
      const buffer = Buffer.alloc(10);
      // Throws EISDIR on a directory; the descriptor is closed below either way.
      const bytesRead = fs.readSync(fd, buffer, 0, 10, 0);
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
  } finally {
    fs.closeSync(fd);
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

/** Classify an image source string. */
export function determineImageSourceType(source: string): 'url' | 'file' | 'base64' {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    return 'url';
  }
  // Base64 must arrive as a data: URL. Raw base64 is indistinguishable from a
  // relative path (JPEG base64 starts with /9j/), so everything else is a file
  // and goes through path validation.
  if (source.startsWith('data:')) {
    return 'base64';
  }
  return 'file';
}

/**
 * Confirm a file is present and readable before upload, logging what was seen,
 * so a file that vanished since validation fails with a clear message.
 */
async function verifyFileReadable(filePath: string): Promise<void> {
  try {
    // Inspect through one confined descriptor rather than separate path
    // lookups, so the file cannot be swapped between check and use -- the
    // debug copy below writes its bytes out, so it must be the file checked.
    let fd: number;
    try {
      ({ fd } = openConfined(filePath));
    } catch (openError: any) {
      if (openError?.cause?.code === 'ENOENT') {
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

      // Read from the open descriptor rather than re-opening by name.
      if (process.env.PRINTIFY_MCP_DEBUG) {
        await saveDebugCopy(fs.readFileSync(fd), `upload_${path.basename(filePath)}`);
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch (verifyError: any) {
    console.error('Error verifying file before upload:', verifyError);
    throw new Error(`Failed to verify file before upload: ${verifyError.message || verifyError}`, { cause: verifyError });
  }
}

/** Upload an image to Printify from a URL, local file, or base64 string. */
export async function uploadImageToPrintify(
  printifyClient: PrintifyAPI,
  fileName: string,
  source: string
) {
  try {
    requireShop(printifyClient);

    const sourceType = determineImageSourceType(source);
    console.error(`Uploading image to Printify from ${sourceType} source`);

    let image;

    if (sourceType === 'file') {
      const filePath = validateFilePath(normalizeFilePath(source), 'read');

      const fileInfo = getFileInfo(filePath);
      if (!fileInfo.exists) {
        throw new Error(`File not found: ${filePath}`);
      }

      console.error(`Uploading file to Printify: ${filePath}`);
      console.error(`File size: ${fileInfo.size} bytes`);

      if (fileInfo.size && fileInfo.size > 20 * 1024 * 1024) {
        throw new Error(`File is too large (${Math.round(fileInfo.size / (1024 * 1024))}MB). Maximum size is 20MB.`);
      }

      await verifyFileReadable(filePath);

      console.error(`Attempting to upload file to Printify: ${filePath}`);
      image = await printifyClient.uploadImage(fileName, filePath);
      console.error(`Upload successful! Image ID: ${image.id}`);
      console.error(`Preview URL: ${image.preview_url}`);
    } else {
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
    console.error('Error uploading image to Printify:', describeError(error));

    const sourceType = determineImageSourceType(source);
    const sourceTypeLabel = sourceType === 'url' ? 'URL' :
                           sourceType === 'file' ? 'file path' :
                           'base64 string';

    const tips: string[] = [TIPS.apiKey, TIPS.connected];

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
      tips.push('Make sure the data URL has the form data:<mime>;base64,<payload> and represents an image');
    }

    // Error type, message, and API status are added by formatErrorResponse.
    const diagnosticInfo: any = {
      FileName: fileName,
      SourceType: sourceTypeLabel,
      // Bounded here: the source can be an arbitrarily large payload.
      Source: previewText(source),
      CurrentShop: printifyClient.getCurrentShop(),
      NodeVersion: process.version,
      Platform: process.platform,
      PrintifyShopId: printifyClient.getCurrentShopId(),
      PrintifyAvailableShops: printifyClient.getAvailableShops().length
    };

    if (sourceType === 'file') {
      await addFileDiagnostics(diagnosticInfo, source);
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
