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
    outputQuality: defaults.outputQuality,
    imagePromptStrength: defaults.imagePromptStrength
  };

  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) merged[key] = value;
  }

  // Aspect ratio and explicit dimensions are mutually exclusive, and an
  // explicit argument must outrank a stored default. Without this, a saved
  // default aspectRatio silently swallowed a caller's width/height, because
  // downstream mapping prefers a ratio whenever one is present. This mirrors
  // the exclusivity DefaultsManager.setDefault already enforces.
  const askedForRatio = args.aspectRatio !== undefined;
  const askedForSize = args.width !== undefined || args.height !== undefined;

  if (askedForRatio && !askedForSize) {
    delete merged.width;
    delete merged.height;
  } else if (askedForSize && !askedForRatio) {
    delete merged.aspectRatio;
  }

  return merged;
}
