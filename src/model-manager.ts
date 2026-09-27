
/** Supported Replicate models. */
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

/** Default image-generation settings, changeable at runtime via set_default. */
export class DefaultsManager {
  private defaults: Record<string, any> = {
    model: "black-forest-labs/flux-1.1-pro-ultra",
    width: 1024,
    height: 1024,
    aspectRatio: "1:1",
    outputFormat: "png",
    numInferenceSteps: 25,
    guidanceScale: 7.5,
    negativePrompt: "low quality, bad quality, sketches",
    safetyTolerance: 2,

    raw: false,                // Ultra only
    promptUpsampling: true,    // Pro only
    outputQuality: 90          // Pro only
  };

  getAvailableModels(): Array<{id: string, name: string, description: string, capabilities: string[]}> {
    return AVAILABLE_MODELS;
  }

  setDefault(option: string, value: any): void {
    this.validateOption(option, value);

    // Aspect ratio and explicit dimensions are mutually exclusive.
    if (option === 'aspectRatio') {
      delete this.defaults.width;
      delete this.defaults.height;
    } else if (option === 'width' || option === 'height') {
      delete this.defaults.aspectRatio;
    }

    this.defaults[option] = value;
    console.error(`Default ${option} set to: ${value}`);
  }

  getDefault(option: string): any {
    return this.defaults[option];
  }

  getAllDefaults(): Record<string, any> {
    return { ...this.defaults };
  }

  private validateOption(option: string, value: any): void {
    switch (option) {
      case 'model':
        if (!AVAILABLE_MODELS.some(model => model.id === value)) {
          throw new Error(`Invalid model ID: ${value}. Available models: ${AVAILABLE_MODELS.map(m => m.id).join(', ')}`);
        }
        break;

      case 'aspectRatio':
        if (typeof value === 'string' && !value.match(/^\d+:\d+$/)) {
          throw new Error(`Invalid aspect ratio format: ${value}. Expected format: "width:height" (e.g., "16:9")`);
        }
        break;

      case 'outputFormat':
        if (!['png', 'jpeg', 'jpg', 'webp'].includes(value)) {
          throw new Error(`Invalid output format: ${value}. Supported formats: png, jpeg, jpg, webp`);
        }
        break;

      case 'width':
      case 'height':
      case 'numInferenceSteps':
      case 'safetyTolerance':
      case 'outputQuality':
        if (typeof value !== 'number' || value <= 0) {
          throw new Error(`Invalid value for ${option}: ${value}. Expected a positive number.`);
        }
        break;

      case 'guidanceScale':
        if (typeof value !== 'number' || value < 1 || value > 20) {
          throw new Error(`Invalid guidance scale: ${value}. Expected a number between 1 and 20.`);
        }
        break;

      case 'raw':
      case 'promptUpsampling':
        if (typeof value !== 'boolean') {
          throw new Error(`Invalid value for ${option}: ${value}. Expected a boolean.`);
        }
        break;

      case 'negativePrompt':
        if (typeof value !== 'string') {
          throw new Error(`Invalid value for ${option}: ${value}. Expected a string.`);
        }
        break;

      default:
        break;
    }
  }

  /** Build the Replicate model id and snake_case input, filling gaps from the defaults. */
  prepareModelInput(prompt: string, options: any = {}): { modelId: string, input: any } {
    const selectedModelId = options.model || this.defaults.model;

    const input: any = { prompt };

    if (selectedModelId === "black-forest-labs/flux-1.1-pro-ultra") {
      input.raw = options.raw !== undefined ? options.raw : this.defaults.raw;

      if (options.imagePromptStrength !== undefined) {
        input.image_prompt_strength = options.imagePromptStrength;
      }
    } else {
      input.prompt_upsampling = options.promptUpsampling !== undefined ?
        options.promptUpsampling : this.defaults.promptUpsampling;

      input.output_quality = options.outputQuality !== undefined ?
        options.outputQuality : this.defaults.outputQuality;
    }

    // Aspect ratio or dimensions, never both: explicit options, then defaults, then 1:1.
    if (options.aspectRatio) {
      input.aspect_ratio = options.aspectRatio;
    } else if (options.width && options.height) {
      input.width = options.width;
      input.height = options.height;
    } else if (this.defaults.aspectRatio) {
      input.aspect_ratio = this.defaults.aspectRatio;
    } else if (this.defaults.width && this.defaults.height) {
      input.width = this.defaults.width;
      input.height = this.defaults.height;
    } else {
      input.aspect_ratio = "1:1";
    }

    if (options.seed !== undefined) input.seed = options.seed;

    // ?? rather than ||: an explicit falsy value (negativePrompt: "" to clear
    // the stored one) is the caller's choice, not a missing option.
    input.num_inference_steps = options.numInferenceSteps ?? this.defaults.numInferenceSteps;
    input.guidance_scale = options.guidanceScale ?? this.defaults.guidanceScale;
    input.negative_prompt = options.negativePrompt ?? this.defaults.negativePrompt;

    input.output_format = options.outputFormat ?? this.defaults.outputFormat;

    input.safety_tolerance = options.safetyTolerance !== undefined ?
      options.safetyTolerance : this.defaults.safetyTolerance;

    return { modelId: selectedModelId, input };
  }
}
