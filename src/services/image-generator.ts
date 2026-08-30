/**
 * Image generation service for Printify MCP
 */
// No need to import fs anymore
import sharp from 'sharp';
import { ReplicateClient } from '../replicate-client.js';
import { formatErrorResponse } from '../utils/error-handler.js';
import { buildModelOptions, mimeTypeFor, withExtension, applyOutputFormat } from './image-format.js';

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
    const modelOptions = buildModelOptions(options);

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
    const mimeType = mimeTypeFor(outputFormat);
    const sharpInstance = applyOutputFormat(sharp(imageBuffer), outputFormat);

    // Get the processed image as a buffer
    const processedBuffer = await sharpInstance.toBuffer();
    console.error(`Image processed successfully, buffer size: ${processedBuffer.length} bytes`);

    const finalFileName = withExtension(fileName, outputFormat);

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
