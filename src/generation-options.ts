/**
 * Merge configured defaults with the arguments of an image-generation tool call.
 *
 * Both generation tools build their Replicate options the same way: start from
 * the stored defaults, then let any explicitly-provided argument win. An
 * argument left undefined must not clobber its default, which is why this is a
 * key-by-key merge rather than a plain object spread.
 *
 * `seed` is deliberately absent from the defaults: it only takes effect when a
 * caller asks for a reproducible run.
 */
export function mergeGenerationOptions(
  defaults: Record<string, any>,
  args: Record<string, any>
): Record<string, any> {
  const merged: Record<string, any> = {
    model: defaults.model,
    width: defaults.width,
    height: defaults.height,
    aspectRatio: defaults.aspectRatio,
    outputFormat: defaults.outputFormat,
    safetyTolerance: defaults.safetyTolerance,
    numInferenceSteps: defaults.numInferenceSteps,
    guidanceScale: defaults.guidanceScale,
    negativePrompt: defaults.negativePrompt,
    raw: defaults.raw,
    promptUpsampling: defaults.promptUpsampling,
    outputQuality: defaults.outputQuality
  };

  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) merged[key] = value;
  }

  return merged;
}
