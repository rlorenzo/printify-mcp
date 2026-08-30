import sharp from 'sharp';
import Replicate from 'replicate';
import { toApiOptions, coerceOutputToBuffer } from './replicate-output.js';
import { applyOutputFormat } from './services/image-format.js';
import { DefaultsManager } from './model-manager.js';

export class ReplicateClient {
  private client: Replicate;
  private defaultsManager: DefaultsManager;

  constructor(apiToken: string) {
    // Initialize the Replicate client with the API token
    this.client = new Replicate({
      auth: apiToken,
    });

    // Initialize the defaults manager
    this.defaultsManager = new DefaultsManager();
  }

  // No need for getTempDir method anymore

  /**
   * Get the defaults manager instance
   * @returns The defaults manager
   */
  getDefaultsManager(): DefaultsManager {
    return this.defaultsManager;
  }

  /**
   * Set a default value for any parameter
   * @param option The option name to set
   * @param value The value to set
   */
  setDefault(option: string, value: any): void {
    this.defaultsManager.setDefault(option, value);
  }

  /**
   * Get the current default value for an option
   * @param option The option name
   * @returns The current default value
   */
  getDefault(option: string): any {
    return this.defaultsManager.getDefault(option);
  }

  /**
   * Get all current defaults
   * @returns All current default values
   */
  getAllDefaults(): Record<string, any> {
    return this.defaultsManager.getAllDefaults();
  }

  /**
   * Get a list of available models with their capabilities
   * @returns Array of available models with details
   */
  getAvailableModels(): Array<{id: string, name: string, description: string, capabilities: string[]}> {
    return this.defaultsManager.getAvailableModels();
  }

  /**
   * Get the current default model
   * @returns The current default model ID
   */
  getDefaultModel(): string {
    return this.defaultsManager.getDefault('model');
  }

  /**
   * Generate an image using the appropriate Flux model and return it as a buffer
   * @param prompt The text prompt to generate an image from
   * @param options Additional options for the model
   * @param modelId Optional model ID override
   * @returns The image data as a Buffer
   */
  async generateImage(prompt: string, options: any = {}, modelId?: string): Promise<Buffer> {
    try {
      const apiOptions = toApiOptions(options);

      // Use the defaults manager to prepare the input with merged options
      const mergedOptions = { ...options, ...apiOptions };
      const { modelId: selectedModelId, input } = this.defaultsManager.prepareModelInput(prompt, mergedOptions);

      console.error(`Using model: ${selectedModelId}`);
      console.error(`Input parameters: ${JSON.stringify(input, null, 2)}`);

      // Run the model using the Replicate client
      const output = await this.client.run(selectedModelId as any, { input });

      console.error('Replicate output type:', output ? (output.constructor ? output.constructor.name : typeof output) : 'null');

      const imageData = await coerceOutputToBuffer(output);

      // Re-encode so Printify always receives a valid image in the requested
      // format. toApiOptions guarantees output_format is set.
      const outputFormat = apiOptions.output_format;
      const sharpInstance = applyOutputFormat(sharp(imageData), outputFormat);

      // Get the processed image as a buffer
      const processedBuffer = await sharpInstance.toBuffer();
      console.error(`Image processed successfully, buffer size: ${processedBuffer.length} bytes`);

      return processedBuffer;
    } catch (error: any) {
      // Surface what was asked for alongside the failure; the underlying error
      // stays attached as the cause.
      const errorDetails = {
        message: error.message,
        prompt,
        options: JSON.stringify(options),
        modelId: modelId || this.getDefault('model')
      };

      throw new Error(
        `Replicate API error: ${error.message}\nDetails: ${JSON.stringify(errorDetails, null, 2)}`,
        { cause: error }
      );
    }
  }

  // No need for cleanupTempFiles method anymore since we're not creating temporary files
}
