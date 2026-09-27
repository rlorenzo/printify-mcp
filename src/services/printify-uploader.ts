/**
 * Printify upload service.
 */
import * as fs from 'fs';
import * as path from 'path';
import { MAX_UPLOAD_BYTES, PrintifyAPI, requireShop } from '../printify-api.js';
import { describeError, formatErrorResponse, formatSuccessResponse, previewText, TIPS } from '../utils/error-handler.js';
import { fileTooLargeMessage, normalizeFileUri, openConfined, validateFilePath } from '../utils/file-utils.js';
import { saveDebugCopy } from './image-format.js';

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
    handle = openConfined(normalizeFileUri(source));
  } catch (error: any) {
    if (error?.cause?.code === 'ENOENT') {
      diagnosticInfo.FileExists = false;
      diagnosticInfo.FileSize = 'N/A';
    } else {
      diagnosticInfo.PathRejected = 'File could not be opened safely; file diagnostics were skipped';
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
async function verifyFileReadable(filePath: string, shown: string): Promise<void> {
  try {
    // Inspect through one confined descriptor rather than separate path
    // lookups, so the file cannot be swapped between check and use -- the
    // debug copy below writes its bytes out, so it must be the file checked.
    let fd: number;
    let stats: fs.Stats;
    try {
      ({ fd, stats } = openConfined(filePath));
    } catch (openError: any) {
      if (openError?.cause?.code === 'ENOENT') {
        console.error(`ERROR: File not found: ${filePath}`);
        throw new Error(`File not found: ${shown}`, { cause: openError });
      }
      console.error(`ERROR: File is not readable at upload time: ${filePath}`);
      throw new Error(`File is not readable at upload time: ${shown}`, { cause: openError });
    }

    try {
      // Same limit PrintifyAPI.uploadFile enforces, checked on the open file
      // before the debug copy below reads all of it into memory.
      if (stats.size > MAX_UPLOAD_BYTES) {
        throw new Error(fileTooLargeMessage(stats.size, MAX_UPLOAD_BYTES));
      }
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

      // Read from the open descriptor rather than re-opening by name. The
      // copy is best-effort: a failed read (EISDIR on a directory, say) must
      // not fail an upload that would go ahead with debugging off.
      if (process.env.PRINTIFY_MCP_DEBUG) {
        let data: Buffer | undefined;
        try {
          data = fs.readFileSync(fd);
        } catch (readError) {
          console.error('Skipping debug copy; the file could not be read:', describeError(readError));
        }
        if (data) {
          await saveDebugCopy(data, `upload_${path.basename(filePath)}`);
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
      const requested = normalizeFileUri(source);
      // Validated here to fail fast; every later step re-validates for itself.
      // Those steps get `requested`, not the resolved path: their errors quote
      // the path they were given and reach the model, and the resolved form
      // of a relative path reveals the server's working directory.
      const filePath = validateFilePath(requested, 'read');
      const shown = previewText(requested);

      console.error(`Uploading file to Printify: ${filePath}`);
      await verifyFileReadable(requested, shown);

      image = await printifyClient.uploadImage(fileName, requested);
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
      tips.push(`Maximum file size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`);
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
