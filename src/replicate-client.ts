import sharp from 'sharp';
import Replicate from 'replicate';
import { toApiOptions, coerceOutputToBuffer } from './replicate-output.js';
import { applyOutputFormat } from './services/image-format.js';
import { DefaultsManager } from './model-manager.js';

export class ReplicateClient {
  private client: Replicate;
  private defaultsManager: DefaultsManager;

  /**
   * `defaultsManager` is injected so the caller owns it: the defaults tools
   * work before (or without) this client existing.
   */
  constructor(apiToken: string, defaultsManager: DefaultsManager = new DefaultsManager()) {
    this.client = new Replicate({ auth: apiToken });
    this.defaultsManager = defaultsManager;
  }

  getDefaultsManager(): DefaultsManager {
    return this.defaultsManager;
  }

  // Pass-throughs to the DefaultsManager, kept for library callers.
  setDefault(option: string, value: any): void {
    this.defaultsManager.setDefault(option, value);
  }

  getDefault(option: string): any {
    return this.defaultsManager.getDefault(option);
  }

  getAllDefaults(): Record<string, any> {
    return this.defaultsManager.getAllDefaults();
  }

  getAvailableModels(): Array<{id: string, name: string, description: string, capabilities: string[]}> {
    return this.defaultsManager.getAvailableModels();
  }

  getDefaultModel(): string {
    return this.defaultsManager.getDefault('model');
  }

  /** Generate an image with a Flux model, re-encoded to the requested format. */
  async generateImage(prompt: string, options: any = {}, modelId?: string): Promise<Buffer> {
    try {
      const apiOptions = toApiOptions(options);

      const mergedOptions = { ...options, ...apiOptions };
      const { modelId: selectedModelId, input } = this.defaultsManager.prepareModelInput(prompt, mergedOptions);

      console.error(`Using model: ${selectedModelId}`);
      console.error(`Input parameters: ${JSON.stringify(input, null, 2)}`);

      const output = await this.client.run(selectedModelId as any, { input });

      console.error('Replicate output type:', output ? (output.constructor ? output.constructor.name : typeof output) : 'null');

      const imageData = await coerceOutputToBuffer(output);

      // Re-encode so Printify always gets a valid image in the requested format.
      const processedBuffer = await applyOutputFormat(sharp(imageData), apiOptions.output_format).toBuffer();
      console.error(`Image processed successfully, buffer size: ${processedBuffer.length} bytes`);

      return processedBuffer;
    } catch (error: any) {
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
}
