/**
 * Option mapping and output coercion for the Replicate client.
 *
 * Both are branch-heavy by nature; keeping them here means the branching is
 * unit-testable instead of buried inside generateImage's network call.
 */
import axios from 'axios';

/** Fetch a URL and return its bytes. */
async function download(url: string): Promise<Buffer> {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}

/**
 * Translate camelCase tool options to the snake_case names the API expects.
 *
 * Options with a meaningful zero or false (seed, safetyTolerance and the
 * model-specific flags) use a defined check; the rest use a truthy check.
 */
export function toApiOptions(options: any = {}): Record<string, any> {
  const api: Record<string, any> = {};

  const truthy: Array<[string, string]> = [
    ['aspectRatio', 'aspect_ratio'],
    ['width', 'width'],
    ['height', 'height'],
    ['numInferenceSteps', 'num_inference_steps'],
    ['guidanceScale', 'guidance_scale'],
    ['negativePrompt', 'negative_prompt']
  ];
  for (const [from, to] of truthy) {
    if (options[from]) api[to] = options[from];
  }

  const defined: Array<[string, string]> = [
    ['seed', 'seed'],
    ['safetyTolerance', 'safety_tolerance'],
    ['promptUpsampling', 'prompt_upsampling'],
    ['outputQuality', 'output_quality'],
    ['raw', 'raw'],
    ['imagePromptStrength', 'image_prompt_strength']
  ];
  for (const [from, to] of defined) {
    if (options[from] !== undefined) api[to] = options[from];
  }

  api.output_format = options.outputFormat || 'png';

  return api;
}

/**
 * Reduce whatever Replicate returned to image bytes.
 *
 * The client's return type varies by model and SDK version: a URL string, a
 * Buffer, a typed array, or a FileOutput-like object exposing file/arrayBuffer/
 * blob/text. Unknown objects get one last chance to be a URL via toString().
 */
export async function coerceOutputToBuffer(output: unknown): Promise<Buffer> {
  if (output === null || output === undefined) {
    throw new Error('Replicate returned null or undefined output');
  }
  if (typeof output === 'string') return download(output);
  if (Buffer.isBuffer(output)) return output;
  if (output instanceof Uint8Array) return Buffer.from(output);
  if (output instanceof ArrayBuffer) return Buffer.from(new Uint8Array(output));

  if (typeof output === 'object') {
    const o = output as any;
    if (o.file) return Buffer.from(await o.file.arrayBuffer());
    if (typeof o.arrayBuffer === 'function') return Buffer.from(await o.arrayBuffer());
    if (typeof o.blob === 'function') return Buffer.from(await (await o.blob()).arrayBuffer());
    if (typeof o.text === 'function') {
      const text = await o.text();
      return text.startsWith('http') ? download(text) : Buffer.from(text);
    }

    const str = o.toString();
    if (str.startsWith('http')) return download(str);
    throw new Error(`Unsupported Replicate output type: ${o.constructor ? o.constructor.name : typeof output}`);
  }

  throw new Error(`Unsupported Replicate output type: ${typeof output}`);
}
