# Image Generation

## Tools

- `generate_and_upload_image({ prompt, fileName, ...options })`: generates an image and uploads it to Printify, returning an image ID.
- `generate_image({ prompt, outputPath, ...options })`: generates an image and saves it to a local file.

Any option left out uses the current default.

```javascript
generate_and_upload_image({
  prompt: "A beautiful mountain landscape",
  fileName: "mountain.png",
  aspectRatio: "4:3",   // overrides the default for this call only
  raw: true
})
```

## Defaults

`get_defaults()` shows the selected model and every default. `set_default({ option, value })` changes one for the rest of the session:

```javascript
set_default({ option: "model", value: "black-forest-labs/flux-1.1-pro" })
set_default({ option: "aspectRatio", value: "16:9" })
set_default({ option: "negativePrompt", value: "low quality, blurry, distorted" })
```

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| model | string | `black-forest-labs/flux-1.1-pro-ultra` | or `black-forest-labs/flux-1.1-pro` |
| aspectRatio | string | `1:1` | `width:height`; setting it clears width/height |
| width / height | number | 1024 | setting either clears aspectRatio |
| outputFormat | string | `png` | `png`, `jpeg`, `webp` |
| numInferenceSteps | number | 25 | 30-50 for more detail |
| guidanceScale | number | 7.5 | 1-20; higher follows the prompt more literally |
| negativePrompt | string | `low quality, bad quality, sketches` | |
| safetyTolerance | number | 2 | 0-6 |
| seed | number | random | reuse for reproducible results (not a default) |
| raw | boolean | false | Ultra only: less processed, more natural images |
| imagePromptStrength | number | none | Ultra only: 0-1 |
| promptUpsampling | boolean | true | Pro only |
| outputQuality | number | 90 | Pro only: 1-100 |

## Upload path

`generate_and_upload_image` sends the image to Printify one of two ways:

- **ImgBB URL** (when `IMGBB_API_KEY` is set): the image is hosted on ImgBB and Printify fetches it. **Required for the Ultra model**, whose images are too large for direct upload.
- **Direct base64** (no ImgBB key): works for the Pro model only.

Without `IMGBB_API_KEY`, either switch to the Pro model or get a free key at https://api.imgbb.com/.

## Tips

- Photorealistic: Ultra with `raw: true`. Illustrations: Ultra with `raw: false`.
- Smaller files: the Pro model.
- Variations: keep the prompt and change `seed`. Consistency: keep the same `seed`.
- Be specific about style, lighting, and composition, and put unwanted traits in `negativePrompt`.
- Prefer `aspectRatio` over width/height.
