/**
 * Image generation service for Printify MCP
 */
// No need to import fs anymore
import sharp from 'sharp';
import { ReplicateClient } from '../replicate-client.js';
import { describeError, formatErrorResponse } from '../utils/error-handler.js';
import { buildModelOptions, mimeTypeFor, withExtension } from './image-format.js';

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

    // STEP 2: Describe the image with Sharp.
    //
    // ReplicateClient.generateImage already re-encoded the buffer into
    // modelOptions.outputFormat, so this only reads metadata. Re-encoding here
    // as well would push every image through Sharp twice and cost a second
    // lossy pass for jpeg and webp.
    console.error('Reading image metadata with Sharp...');

    // Get the output format from options (already defaulted to png earlier)
    const outputFormat = modelOptions.outputFormat;
    const mimeType = mimeTypeFor(outputFormat);
    const finalFileName = withExtension(fileName, outputFormat);

    // No need to clean up files since we're keeping everything in memory

    const metadata = await sharp(imageBuffer).metadata();
    const dimensions = `${metadata.width}x${metadata.height}`;
    console.error(`Image ready, buffer size: ${imageBuffer.length} bytes (${dimensions})`);

    return {
      success: true,
      buffer: imageBuffer,
      mimeType,
      fileName: finalFileName,
      model: usingModel,
      dimensions
    };
  } catch (error: any) {
    console.error('Error generating or processing image:', describeError(error));

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
