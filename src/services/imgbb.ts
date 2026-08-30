/**
 * ImgBB staging for Printify uploads.
 *
 * The Flux Ultra model produces images too large for Printify's direct base64
 * upload, so they are staged on ImgBB and handed over as a URL. Smaller models
 * fall back to direct upload when ImgBB is unavailable.
 */

export type ImgbbOutcome =
  | { method: 'imgbb'; imageUrl: string }
  | { method: 'direct' }
  | { method: 'failed'; message: string };

/** Whether a model id needs the ImgBB path rather than direct base64 upload. */
export function requiresImgbb(modelId: string): boolean {
  return modelId.includes('flux-1.1-pro-ultra');
}

/** Whether a usable ImgBB key is configured (the placeholder does not count). */
export function hasImgbbKey(key: string | undefined): boolean {
  return !!key && key !== 'your-imgbb-api-key';
}

/**
 * Stage an image on ImgBB.
 *
 * Returns 'direct' when no key is configured, or when an upload fails for a
 * model that can fall back. For a model that requires ImgBB, a failure is
 * terminal and returns 'failed' with the reason.
 */
export async function stageOnImgbb(
  imageBuffer: Buffer,
  modelId: string,
  deps: { axios: any; FormData: any; apiKey?: string }
): Promise<ImgbbOutcome> {
  const { axios, FormData, apiKey } = deps;
  const mustUseImgbb = requiresImgbb(modelId);

  if (!hasImgbbKey(apiKey)) {
    if (mustUseImgbb) {
      return {
        method: 'failed',
        message:
          'The Flux 1.1 Pro Ultra model generates high-resolution images that are too large ' +
          'for direct base64 upload.\n\nYou MUST set the IMGBB_API_KEY environment variable ' +
          'when using this model.\n\nGet a free API key from https://api.imgbb.com/'
      };
    }
    console.error('No ImgBB API key found. Using direct base64 upload.');
    return { method: 'direct' };
  }

  try {
    const formData = new FormData();
    formData.append('image', imageBuffer.toString('base64'));

    const response = await axios.post(`https://api.imgbb.com/1/upload?key=${apiKey}`, formData);
    const imageUrl = response.data.data.url;
    console.error(`Successfully uploaded image to ImgBB. URL: ${imageUrl}`);
    return { method: 'imgbb', imageUrl };
  } catch (error: any) {
    const detail = error.message || String(error);
    if (mustUseImgbb) {
      return {
        method: 'failed',
        message:
          `Error uploading to ImgBB: ${detail}\n\n` +
          'When using the Ultra model, ImgBB upload is required and cannot be bypassed.'
      };
    }
    console.error(`Error uploading to ImgBB: ${detail}. Falling back to direct base64 upload.`);
    return { method: 'direct' };
  }
}
