/**
 * Pure helpers for image generation: option mapping and output-format rules.
 *
 * Extracted from generateImage so the branching lives in small testable units
 * rather than inflating one function's cyclomatic complexity.
 */

/**
 * Map tool options onto the names the Replicate client expects.
 *
 * Aspect ratio and explicit dimensions are mutually exclusive: when a ratio is
 * given, width and height are omitted so the model receives only one.
 * `seed`, `safetyTolerance` and the model-specific flags use an explicit
 * undefined check so a deliberate 0 or false is not dropped.
 */
export function buildModelOptions(options: any = {}): Record<string, any> {
  const modelOptions: Record<string, any> = {};

  if (options.aspectRatio) {
    modelOptions.aspectRatio = options.aspectRatio;
  } else {
    modelOptions.width = options.width || 1024;
    modelOptions.height = options.height || 1024;
  }

  // Truthy checks: these have no meaningful zero value.
  for (const key of ['numInferenceSteps', 'guidanceScale', 'negativePrompt', 'model'] as const) {
    if (options[key]) modelOptions[key] = options[key];
  }

  // Defined checks: 0 and false are meaningful here.
  for (const key of ['seed', 'safetyTolerance', 'promptUpsampling', 'outputQuality', 'raw', 'imagePromptStrength'] as const) {
    if (options[key] !== undefined) modelOptions[key] = options[key];
  }

  modelOptions.outputFormat = options.outputFormat || 'png';

  return modelOptions;
}

/** The MIME type Printify should receive for a generated output format. */
export function mimeTypeFor(outputFormat: string): string {
  if (outputFormat === 'jpeg' || outputFormat === 'jpg') return 'image/jpeg';
  if (outputFormat === 'webp') return 'image/webp';
  return 'image/png';
}

/** The file extension for an output format; jpeg is stored as .jpg. */
export function extensionFor(outputFormat: string): string {
  return outputFormat === 'jpeg' ? 'jpg' : outputFormat;
}

/**
 * Append the format's extension unless the name already carries it.
 *
 * Matching is case-insensitive and treats .jpg and .jpeg as the same extension,
 * so a caller's `photo.JPEG` is left alone rather than becoming `photo.JPEG.jpg`.
 */
export function withExtension(fileName: string, outputFormat: string): string {
  const ext = extensionFor(outputFormat);
  const equivalents = ext === 'jpg' ? ['jpg', 'jpeg'] : [ext];
  const current = fileName.toLowerCase();
  return equivalents.some((e) => current.endsWith(`.${e}`)) ? fileName : `${fileName}.${ext}`;
}

/** Re-encode at full quality in the requested format, leaving others untouched. */
export function applyOutputFormat<T extends { png: any; jpeg: any; webp: any }>(
  sharpInstance: T,
  outputFormat: string
): T {
  if (outputFormat === 'png') return sharpInstance.png({ quality: 100 });
  if (outputFormat === 'jpeg' || outputFormat === 'jpg') return sharpInstance.jpeg({ quality: 100 });
  if (outputFormat === 'webp') return sharpInstance.webp({ quality: 100 });
  return sharpInstance;
}

/**
 * Write a copy of a generated image under ./debug for troubleshooting.
 *
 * A no-op unless PRINTIFY_MCP_DEBUG is set, and never throws: a failed debug
 * write must not abort the upload it was meant to help diagnose.
 */
export async function saveDebugCopy(buffer: Buffer | undefined, fileName: string | undefined): Promise<void> {
  if (!process.env.PRINTIFY_MCP_DEBUG) return;
  try {
    const fs = await import('fs');
    const path = await import('path');
    const debugDir = path.join(process.cwd(), 'debug');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    if (!buffer) {
      console.error('No image data to save for debugging');
      return;
    }
    // basename only: fileName reaches here from tool arguments, and `../`
    // segments would otherwise let a caller write outside debugDir.
    const safeName = path.basename(fileName ?? 'image') || 'image';
    const debugFilePath = path.join(debugDir, `debug_${Date.now()}_${safeName}`);
    fs.writeFileSync(debugFilePath, buffer);
    console.error(`Saved image data to debug file: ${debugFilePath} (${buffer.length} bytes)`);
  } catch (debugError) {
    console.error('Error saving debug file:', debugError);
  }
}
