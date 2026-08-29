import sharp from 'sharp';
import Replicate from 'replicate';
import axios from 'axios';
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
      // Convert camelCase options to snake_case for the API
      const apiOptions: any = {};

      // Map common options
      if (options.aspectRatio) apiOptions.aspect_ratio = options.aspectRatio;
      if (options.width) apiOptions.width = options.width;
      if (options.height) apiOptions.height = options.height;
      if (options.seed !== undefined) apiOptions.seed = options.seed;
      if (options.numInferenceSteps) apiOptions.num_inference_steps = options.numInferenceSteps;
      if (options.guidanceScale) apiOptions.guidance_scale = options.guidanceScale;
      if (options.negativePrompt) apiOptions.negative_prompt = options.negativePrompt;
      // Always set output_format, defaulting to png unless explicitly specified
      apiOptions.output_format = options.outputFormat || "png";
      if (options.safetyTolerance !== undefined) apiOptions.safety_tolerance = options.safetyTolerance;

      // Map model-specific options
      if (options.promptUpsampling !== undefined) apiOptions.prompt_upsampling = options.promptUpsampling;
      if (options.outputQuality !== undefined) apiOptions.output_quality = options.outputQuality;
      if (options.raw !== undefined) apiOptions.raw = options.raw;
      if (options.imagePromptStrength !== undefined) apiOptions.image_prompt_strength = options.imagePromptStrength;

      // Use the defaults manager to prepare the input with merged options
      const mergedOptions = { ...options, ...apiOptions };
      const { modelId: selectedModelId, input } = this.defaultsManager.prepareModelInput(prompt, mergedOptions);

      console.log(`Using model: ${selectedModelId}`);
      console.log(`Input parameters: ${JSON.stringify(input, null, 2)}`);

      // Run the model using the Replicate client
      const output = await this.client.run(selectedModelId as any, { input });

      console.log('Replicate output type:', output ? (output.constructor ? output.constructor.name : typeof output) : 'null');

      // Handle different output types from Replicate
      let imageData: Buffer;

      if (output === null || output === undefined) {
        throw new Error('Replicate returned null or undefined output');
      } else if (typeof output === 'string') {
        // If output is a URL, download the image
        console.log('Replicate returned a string (URL):', output);
        const response = await axios.get(output, { responseType: 'arraybuffer' });
        imageData = Buffer.from(response.data);
      } else if (Buffer.isBuffer(output)) {
        // If output is already a Buffer
        console.log('Replicate returned a Buffer');
        imageData = output;
      } else if (output instanceof Uint8Array) {
        // If output is a Uint8Array
        console.log('Replicate returned a Uint8Array');
        imageData = Buffer.from(output);
      } else if (output instanceof ArrayBuffer) {
        // If output is an ArrayBuffer
        console.log('Replicate returned an ArrayBuffer');
        imageData = Buffer.from(new Uint8Array(output));
      } else if (typeof output === 'object' && output !== null) {
        // If output is a FileOutput object or similar
        console.log('Replicate returned an object:', Object.keys(output));

        // Try to get the file content
        if ('file' in output && output.file) {
          console.log('Object has a file property');
          // Use type assertion to handle FileOutput object
          const fileContent = await (output.file as any).arrayBuffer();
          imageData = Buffer.from(fileContent);
        } else if ('arrayBuffer' in output && typeof output.arrayBuffer === 'function') {
          console.log('Object has an arrayBuffer method');
          // Use type assertion for the arrayBuffer method
          const arrayBuffer = await (output as any).arrayBuffer();
          imageData = Buffer.from(arrayBuffer);
        } else if ('blob' in output && typeof output.blob === 'function') {
          console.log('Object has a blob method');
          // Use type assertion for the blob method
          const blob = await (output as any).blob();
          const arrayBuffer = await (blob as any).arrayBuffer();
          imageData = Buffer.from(arrayBuffer);
        } else if ('text' in output && typeof output.text === 'function') {
          console.log('Object has a text method');
          // Use type assertion for the text method
          const text = await (output as any).text();
          // If the text is a URL, download the image
          if (text.startsWith('http')) {
            const response = await axios.get(text, { responseType: 'arraybuffer' });
            imageData = Buffer.from(response.data);
          } else {
            imageData = Buffer.from(text);
          }
        } else {
          // Last resort: try to stringify the object and see if it's a URL
          const str = output.toString();
          console.log('Object toString():', str);
          if (str.startsWith('http')) {
            const response = await axios.get(str, { responseType: 'arraybuffer' });
            imageData = Buffer.from(response.data);
          } else {
            throw new Error(`Unsupported Replicate output type: ${output.constructor ? output.constructor.name : typeof output}`);
          }
        }
      } else {
        throw new Error(`Unsupported Replicate output type: ${typeof output}`);
      }

      return imageData;
    } catch (error: any) {
      // Provide detailed error information
      const errorDetails = {
        message: error.message,
        prompt: prompt,
        options: JSON.stringify(options),
        modelId: modelId || this.getDefault('model')
      };

      throw new Error(`Replicate API error: ${error.message}\nDetails: ${JSON.stringify(errorDetails, null, 2)}`, { cause: error });
    }
  }

  /**
   * Process an image with Sharp to ensure it's a valid PNG for Printify
   * @param imageData The image data buffer from Replicate
   * @param outputFormat The desired output format (png, jpeg, webp)
   * @returns A buffer containing the processed image
   */
  async processImageForPrintify(imageData: Buffer, outputFormat: string = 'png'): Promise<Buffer> {
    // Ensure outputFormat is always defined and defaults to png
    outputFormat = outputFormat || 'png';
    try {
      console.log(`Processing image with Sharp to ${outputFormat} format`);

      // Process the image with Sharp to ensure it's valid for Printify
      let sharpInstance = sharp(imageData);

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
      console.log(`Image processed successfully, buffer size: ${processedBuffer.length} bytes`);

      return processedBuffer;
    } catch (error) {
      console.error('Error processing image for Printify:', error);
      throw error;
    }
  }

  // No need for cleanupTempFiles method anymore since we're not creating temporary files
}
