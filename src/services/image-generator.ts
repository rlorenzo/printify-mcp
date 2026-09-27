/**
 * Image generation service.
 */
import sharp from 'sharp';
import { ReplicateClient } from '../replicate-client.js';
import { describeError, formatErrorResponse } from '../utils/error-handler.js';
import { buildModelOptions, mimeTypeFor, withExtension } from './image-format.js';

/** Generate an image with Replicate and describe it with Sharp. */
export async function generateImage(
  replicateClient: ReplicateClient,
  prompt: string,
  fileName: string,
  options: any = {}
) {
  const usingModel: string = options.model || replicateClient.getDefaultModel();

  try {
    const modelOptions = buildModelOptions(options);
    console.error(`Using model: ${usingModel} (${options.model ? 'override' : 'default'})`);
    console.error(`Prompt: ${prompt}`);

    const imageBuffer = await replicateClient.generateImage(prompt, modelOptions);
    console.error(`Image generated successfully, buffer size: ${imageBuffer.length} bytes`);

    // ReplicateClient already encoded the buffer as outputFormat, so only read
    // metadata here rather than re-encoding.
    const outputFormat = modelOptions.outputFormat;
    const metadata = await sharp(imageBuffer).metadata();
    const dimensions = `${metadata.width}x${metadata.height}`;
    console.error(`Image ready (${dimensions})`);

    return {
      success: true as const,
      buffer: imageBuffer,
      mimeType: mimeTypeFor(outputFormat),
      fileName: withExtension(fileName, outputFormat),
      model: usingModel,
      dimensions
    };
  } catch (error: any) {
    console.error('Error generating or processing image:', describeError(error));

    const errorStep = error.message.includes('Sharp') ? 'Image Processing' : 'Image Generation';

    return {
      success: false as const,
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
          'Try a different model using set_default',
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
