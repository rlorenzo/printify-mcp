/**
 * Image generation service for Printify MCP
 */
// No need to import fs anymore
import sharp from 'sharp';
import { ReplicateClient } from '../replicate-client.js';
import { formatErrorResponse } from '../utils/error-handler.js';

/**
 * Generate an image using Replicate and process it with Sharp
 */
export async function generateImage(
  replicateClient: ReplicateClient,
  prompt: string,
  fileName: string,
  options: any = {}
) {
  // No need to track files anymore since we're keeping everything in memory

  try {
    // Prepare options with proper naming for the API
    const modelOptions: any = {};

    // Set aspect ratio or dimensions
    if (options.aspectRatio) {
      modelOptions.aspectRatio = options.aspectRatio;
    } else {
      // If no aspect ratio is provided, use width and height
      // These will be overridden by the defaults in the DefaultsManager if not provided
      modelOptions.width = options.width || 1024;
      modelOptions.height = options.height || 1024;
    }

    // Add common parameters
    if (options.numInferenceSteps) modelOptions.numInferenceSteps = options.numInferenceSteps;
    if (options.guidanceScale) modelOptions.guidanceScale = options.guidanceScale;
    if (options.negativePrompt) modelOptions.negativePrompt = options.negativePrompt;
    if (options.seed !== undefined) modelOptions.seed = options.seed;
    // Always set outputFormat, defaulting to png unless explicitly specified
    modelOptions.outputFormat = options.outputFormat || "png";
    if (options.safetyTolerance !== undefined) modelOptions.safetyTolerance = options.safetyTolerance;

    // Add model-specific parameters if provided
    if (options.promptUpsampling !== undefined) modelOptions.promptUpsampling = options.promptUpsampling;
    if (options.outputQuality !== undefined) modelOptions.outputQuality = options.outputQuality;
    if (options.raw !== undefined) modelOptions.raw = options.raw;
    if (options.imagePromptStrength !== undefined) modelOptions.imagePromptStrength = options.imagePromptStrength;

    // Add model override if provided
    if (options.model) modelOptions.model = options.model;

    // Get the current default model for informational purposes
    const defaultModel = replicateClient.getDefaultModel();
    const usingModel = options.model || defaultModel;
    console.error(`Using model: ${usingModel} (${options.model ? 'override' : 'default'})`);
    console.error(`Prompt: ${prompt}`);

    // STEP 1: Generate the image with Replicate
    console.error('Generating image with Replicate...');
    const imageBuffer = await replicateClient.generateImage(prompt, modelOptions);
    console.error(`Image generated successfully, buffer size: ${imageBuffer.length} bytes`);

    // STEP 2: Process the image with Sharp
    console.error('Processing image with Sharp...');

    // Get the output format from options (already defaulted to png earlier)
    const outputFormat = modelOptions.outputFormat;
    let mimeType: string;

    if (outputFormat === 'jpeg' || outputFormat === 'jpg') {
      mimeType = 'image/jpeg';
    } else if (outputFormat === 'webp') {
      mimeType = 'image/webp';
    } else {
      // Default to PNG
      mimeType = 'image/png';
    }

    // Process with Sharp and get buffer directly
    let sharpInstance = sharp(imageBuffer);

    // Apply format-specific options
    if (outputFormat === 'png') {
      sharpInstance = sharpInstance.png({ quality: 100 });
    } else if (outputFormat === 'jpeg' || outputFormat === 'jpg') {
      sharpInstance = sharpInstance.jpeg({ quality: 100 });
    } else if (outputFormat === 'webp') {
      sharpInstance = sharpInstance.webp({ quality: 100 });
    }

    // Get the processed image as a buffer
    const processedBuffer = await sharpInstance.toBuffer();
    console.error(`Image processed successfully, buffer size: ${processedBuffer.length} bytes`);

    // Determine the final filename with extension
    const fileExtension = outputFormat === 'jpeg' ? 'jpg' : outputFormat;
    const finalFileName = fileName.endsWith(`.${fileExtension}`) ? fileName : `${fileName}.${fileExtension}`;

    // No need to clean up files since we're keeping everything in memory

    // Get dimensions from the Sharp metadata
    const metadata = await sharpInstance.metadata();
    const dimensions = `${metadata.width}x${metadata.height}`;

    return {
      success: true,
      buffer: processedBuffer,
      mimeType,
      fileName: finalFileName,
      model: usingModel,
      dimensions
    };
  } catch (error: any) {
    console.error('Error generating or processing image:', error);

    // No need to clean up files since we're keeping everything in memory

    // Get the current default model for informational purposes
    const defaultModel = replicateClient.getDefaultModel();
    const usingModel = options.model || defaultModel;

    // Determine which step failed
    const errorStep = error.message.includes('Sharp') ? 'Image Processing' : 'Image Generation';

    return {
      success: false,
      error,
      errorResponse: formatErrorResponse(
        error,
        errorStep,
        {
          Prompt: prompt,
          Model: usingModel.split('/')[1],
          Step: errorStep
        },
        [
          'Check that your REPLICATE_API_TOKEN is valid',
          'Try a different model using set-model',
          'Try a more descriptive prompt',
          'Try a different aspect ratio',
          ...(errorStep === 'Image Processing' ? [
            'Make sure Sharp is properly installed'
          ] : [])
        ]
      )
    };
  }
}
