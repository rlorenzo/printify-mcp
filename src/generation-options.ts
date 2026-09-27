/**
 * Merge stored defaults with a generation tool's arguments. Explicit arguments
 * win; undefined ones do not clobber a default. `seed` has no default.
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

  // Aspect ratio and dimensions are exclusive, and an explicit argument must
  // outrank a stored default (downstream mapping prefers a ratio when present).
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
