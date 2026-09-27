# Images

Every uploaded image gets an ID, which you use in a product's `printAreas`.

## Uploading

```javascript
upload_image({ fileName: "front.png", url: "https://example.com/image.png" })   // public URL
upload_image({ fileName: "front.png", url: "/path/to/image.png" })              // local file
upload_image({ fileName: "front.png", url: "data:image/png;base64,iVBOR..." })  // base64 data URL
generate_and_upload_image({ prompt: "blue t-shirt design", fileName: "front.png" })
```

- Local files must be inside the server's `ALLOWED_FILE_DIR` (by default, its working directory).
- Use PNG or JPEG, ideally at 300 DPI. Large items such as blankets and leggings are fine at 120-150 DPI.
- For large files, prefer a URL over base64.

Example response:

```json
{ "id": "680325163d2a2ac0a2d2937c", "file_name": "front.png", "width": 1200, "height": 1200,
  "preview_url": "https://images.printify.com/mockup/680325163d2a2ac0a2d2937c/12.png" }
```

## Using images in a product

```javascript
printAreas: {
  front: { position: "front", imageId: "680325163d2a2ac0a2d2937c" },
  back:  { position: "back",  imageId: "680325163d2a2ac0a2d2938d" }
}
```

Available positions depend on the blueprint (see `get_variants`). For per-colorway artwork, see `how_to_use({ topic: "product_creation" })`.

## AI-generated images

`generate_and_upload_image` uses the defaults from `get_defaults`/`set_default`, and any option can be overridden per call. The default Flux 1.1 Pro Ultra model requires `IMGBB_API_KEY`. See `how_to_use({ topic: "image_generation" })` for all options and prompt tips.

## Reusing uploads

Every upload stays in the account's library, so earlier artwork can be reused instead of uploaded again:

```javascript
list_uploads({ page: 1, limit: 10 })   // id, file name, dimensions, upload time
get_upload({ imageId: "5e16d66791287a0006e522b2" })   // adds the preview URL
archive_upload({ imageId: "5e16d66791287a0006e522b2" })   // archives it, removing it from the library
```
