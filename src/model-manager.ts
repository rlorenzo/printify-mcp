
/**
 * Available models with their capabilities
 */
const AVAILABLE_MODELS = [
  {
    id: "black-forest-labs/flux-1.1-pro",
    name: "Flux 1.1 Pro",
    description: "Standard quality image generation with prompt upsampling",
    capabilities: ["prompt_upsampling", "output_quality"]
  },
  {
    id: "black-forest-labs/flux-1.1-pro-ultra",
    name: "Flux 1.1 Pro Ultra",
    description: "High resolution image generation (up to 4MP) with raw mode option",
    capabilities: ["raw_mode", "high_resolution", "image_prompt_strength"]
  }
];

/**
 * Class to manage default settings for image generation
 */
export class DefaultsManager {
  // Default settings storage
  private defaults: Record<string, any> = {
    // Default model is Ultra
    model: "black-forest-labs/flux-1.1-pro-ultra",

    // Image dimensions and format
    width: 1024,
    height: 1024,
    aspectRatio: "1:1", // Default to square aspect ratio
    outputFormat: "png",

    // Generation parameters
    numInferenceSteps: 25,
    guidanceScale: 7.5,
    negativePrompt: "low quality, bad quality, sketches",
    safetyTolerance: 2,

    // Model-specific parameters
    raw: false,                // Default to false for Ultra model
    promptUpsampling: true,    // Default to true for Pro model
    outputQuality: 90          // Default for Pro model
  };

  /**
   * Get a list of available models with their capabilities
   * @returns Array of available models with details
   */
  getAvailableModels(): Array<{id: string, name: string, description: string, capabilities: string[]}> {
    return AVAILABLE_MODELS;
  }

  /**
   * Set a default value for any parameter
   * @param option The option name to set
   * @param value The value to set
   */
  setDefault(option: string, value: any): void {
    // Validate the option and value
    this.validateOption(option, value);

    // Special handling for aspectRatio, width, and height
    if (option === 'aspectRatio') {
      // When setting aspectRatio, clear width and height
      delete this.defaults.width;
      delete this.defaults.height;
    } else if (option === 'width' || option === 'height') {
      // When setting width or height, clear aspectRatio
      delete this.defaults.aspectRatio;
    }

    // Set the default value
    this.defaults[option] = value;
    console.error(`Default ${option} set to: ${value}`);
  }

  /**
   * Get the current default value for an option
   * @param option The option name
   * @returns The current default value
   */
  getDefault(option: string): any {
    return this.defaults[option];
  }

  /**
   * Get all current defaults
   * @returns All current default values
   */
  getAllDefaults(): Record<string, any> {
    return { ...this.defaults };
  }

  /**
   * Validate an option and its value
   * @param option The option name
   * @param value The value to validate
   */
  private validateOption(option: string, value: any): void {
    switch (option) {
      case 'model':
        if (!AVAILABLE_MODELS.some(model => model.id === value)) {
          throw new Error(`Invalid model ID: ${value}. Available models: ${AVAILABLE_MODELS.map(m => m.id).join(', ')}`);
        }
        break;

      case 'aspectRatio':
        // Validate aspect ratio format (e.g., "16:9")
        if (typeof value === 'string' && !value.match(/^\d+:\d+$/)) {
          throw new Error(`Invalid aspect ratio format: ${value}. Expected format: "width:height" (e.g., "16:9")`);
        }
        break;

      case 'outputFormat':
        // Validate output format
        if (!['png', 'jpeg', 'jpg', 'webp'].includes(value)) {
          throw new Error(`Invalid output format: ${value}. Supported formats: png, jpeg, jpg, webp`);
        }
        break;

      case 'width':
      case 'height':
      case 'numInferenceSteps':
      case 'safetyTolerance':
      case 'outputQuality':
        // Validate numeric values
        if (typeof value !== 'number' || value <= 0) {
          throw new Error(`Invalid value for ${option}: ${value}. Expected a positive number.`);
        }
        break;

      case 'guidanceScale':
        // Validate guidance scale
        if (typeof value !== 'number' || value < 1 || value > 20) {
          throw new Error(`Invalid guidance scale: ${value}. Expected a number between 1 and 20.`);
        }
        break;

      case 'raw':
      case 'promptUpsampling':
        // Validate boolean values
        if (typeof value !== 'boolean') {
          throw new Error(`Invalid value for ${option}: ${value}. Expected a boolean.`);
        }
        break;

      case 'negativePrompt':
        // Validate string values
        if (typeof value !== 'string') {
          throw new Error(`Invalid value for ${option}: ${value}. Expected a string.`);
        }
        break;

      default:
        // Allow any other options without validation
        break;
    }
  }

  /**
   * Prepare input parameters for a specific model
   * @param prompt The text prompt
   * @param options All options including model-specific ones
   * @returns Properly formatted input parameters for the model
   */
  prepareModelInput(prompt: string, options: any = {}): { modelId: string, input: any } {
    // Get the model to use (user-specified or default)
    const selectedModelId = options.model || this.defaults.model;

    // Set up the appropriate input parameters based on model
    const input: any = { prompt };

    // Apply defaults first, then override with user-specified options
    if (selectedModelId === "black-forest-labs/flux-1.1-pro-ultra") {
      // Ultra-specific parameters
      input.raw = options.raw !== undefined ? options.raw : this.defaults.raw;

      if (options.imagePromptStrength !== undefined) {
        input.image_prompt_strength = options.imagePromptStrength;
      }
    } else {
      // Pro-specific parameters
      input.prompt_upsampling = options.promptUpsampling !== undefined ?
        options.promptUpsampling : this.defaults.promptUpsampling;

      input.output_quality = options.outputQuality !== undefined ?
        options.outputQuality : this.defaults.outputQuality;
    }

    // Common parameters for both models - apply defaults then override with options

    // Handle aspect ratio or dimensions - only set one or the other, never both
    if (options.aspectRatio) {
      // If aspect ratio is explicitly provided, use it and don't set width/height
      input.aspect_ratio = options.aspectRatio;
    } else if (options.width && options.height) {
      // If width and height are explicitly provided, use them and don't set aspect ratio
      input.width = options.width;
      input.height = options.height;
    } else if (this.defaults.aspectRatio) {
      // If no explicit dimensions are provided but we have a default aspect ratio, use it
      input.aspect_ratio = this.defaults.aspectRatio;
    } else if (this.defaults.width && this.defaults.height) {
      // Last resort: use default width and height if they exist
      input.width = this.defaults.width;
      input.height = this.defaults.height;
    } else {
      // Absolute fallback: use 1:1 aspect ratio
      input.aspect_ratio = "1:1";
    }

    // Other common parameters
    if (options.seed !== undefined) input.seed = options.seed;

    input.num_inference_steps = options.numInferenceSteps || this.defaults.numInferenceSteps;
    input.guidance_scale = options.guidanceScale || this.defaults.guidanceScale;
    input.negative_prompt = options.negativePrompt || this.defaults.negativePrompt;

    // Always set output_format, defaulting to png unless explicitly specified
    input.output_format = options.outputFormat || this.defaults.outputFormat;

    input.safety_tolerance = options.safetyTolerance !== undefined ?
      options.safetyTolerance : this.defaults.safetyTolerance;

    return { modelId: selectedModelId, input };
  }
}
