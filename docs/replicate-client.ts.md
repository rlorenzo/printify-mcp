# `replicate-client.ts` Documentation

## Overview

`replicate-client.ts` implements a client for interacting with the Replicate API to generate images using AI models. It provides methods for generating images, processing them for Printify, and cleaning up temporary files.

## Dependencies

- `fs`: File system module for reading and writing files
- `path`: Path manipulation module
- `sharp`: Image processing library
- `replicate`: Official Replicate SDK
- `fs/promises`: Promise-based file system module

## ReplicateClient Class

The main class for interacting with the Replicate API.

### Constructor

```typescript
constructor(apiToken: string)
```

- `apiToken`: The Replicate API token

The constructor:

1. Initializes the Replicate client with the API token
2. Creates a temporary directory for downloaded images if it doesn't exist

### Properties

- `private client`: The Replicate client
- `private tempDir`: The path to the temporary directory

### Methods

#### generateImage

Generates an image using the Flux 1.1 Pro model and saves it to a file.

```typescript
async generateImage(prompt: string, options: any = {}): Promise<string>
```

- `prompt`: The text prompt to generate an image from
- `options`: Additional options for the model
- Returns: A promise that resolves to the path of the generated image file

This method:

1. Sets up the input parameters for the model, including:
   - `prompt`: The text prompt
   - `prompt_upsampling`: Always set to true
   - `aspect_ratio`: Optional aspect ratio
   - `width` and `height`: Optional dimensions
   - `seed`: Optional seed for reproducible generation
   - `num_inference_steps`: Optional number of inference steps
   - `guidance_scale`: Optional guidance scale
   - `negative_prompt`: Optional negative prompt
2. Generates a temporary file path for the output image
3. Runs the Flux 1.1 Pro model using the Replicate client
4. Saves the output directly to a file
5. Returns the path to the generated image file

#### processImageForPrintify

Processes an image with Sharp to ensure it's a valid PNG for Printify.

```typescript
async processImageForPrintify(inputPath: string, outputFilename: string): Promise<string>
```

- `inputPath`: The path to the input image from Replicate
- `outputFilename`: The filename to save the processed image as
- Returns: A promise that resolves to the path of the processed image ready for Printify upload

This method:

1. Generates a temporary file path for the output
2. Processes the image with Sharp to ensure it's a valid PNG for Printify
3. Returns the path to the processed image

#### cleanupTempFiles

Cleans up temporary files.

```typescript
async cleanupTempFiles(filePaths: string[]): Promise<void>
```

- `filePaths`: Array of file paths to delete
- Returns: A promise that resolves when all files are deleted

This method:

1. Iterates through the file paths
2. Deletes each file if it exists
3. Logs errors but continues with other files even if one fails

## Error Handling

The class includes robust error handling for all methods, with detailed error messages to help troubleshoot issues. For example:

```typescript
catch (error: any) {
  // Provide detailed error information
  const errorDetails = {
    message: error.message,
    prompt: prompt,
    options: JSON.stringify(options)
  };

  throw new Error(`Replicate API error: ${error.message}\nDetails: ${JSON.stringify(errorDetails, null, 2)}`);
}
```

## Conclusion

`replicate-client.ts` provides a client for generating images using the Replicate API, specifically the Flux 1.1 Pro model. It includes methods for processing the generated images for Printify and cleaning up temporary files. The class includes robust error handling and detailed logging to help troubleshoot issues.
