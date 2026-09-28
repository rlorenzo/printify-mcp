/**
 * Printify upload library: finding, inspecting and archiving uploaded images.
 * (Uploading itself is printify-uploader.ts.)
 */
import { PrintifyAPI } from '../printify-api.js';
import { formatSuccessResponse, runService, TIPS } from '../utils/error-handler.js';

/** The fields that identify an upload; the preview URL is left to get_upload. */
function uploadSummary(upload: any) {
  return {
    id: upload.id,
    fileName: upload.file_name,
    size: upload.width && upload.height ? `${upload.width}x${upload.height}` : undefined,
    mimeType: upload.mime_type,
    uploadedAt: upload.upload_time
  };
}

export async function listUploads(
  printifyClient: PrintifyAPI,
  options: { page?: number; limit?: number } = {}
) {
  return runService(
    'List Uploads',
    { context: () => ({ Page: options.page, Limit: options.limit }), tips: [TIPS.apiKey, TIPS.connected] },
    async () => {
      const page = options.page || 1;
      const limit = options.limit || 10;
      const uploads: any = await printifyClient.listUploads(page, limit);
      // An empty library is `data: []`; a response without the array is not
      // an empty page and must not be reported as one.
      if (!Array.isArray(uploads?.data)) {
        throw new Error('Printify returned an upload list without a data array');
      }
      // An entry without an id can't be used or looked up, so it isn't listed.
      const data = uploads.data.filter((upload: any) => upload && typeof upload === 'object' && upload.id);

      return {
        uploads,
        response: formatSuccessResponse(
          'Uploaded Images',
          {
            Page: uploads?.current_page ?? page,
            ...(uploads?.last_page ? { PageCount: uploads.last_page } : {}),
            ...(typeof uploads?.total === 'number' ? { Total: uploads.total } : {}),
            Limit: limit,
            Count: data.length,
            Uploads: data.map(uploadSummary)
          },
          'Use an id as imageId in create_product or update_product print areas, or get_upload for its preview URL.'
        )
      };
    }
  );
}

export async function getUpload(printifyClient: PrintifyAPI, imageId: string) {
  return runService(
    'Get Upload',
    {
      context: () => ({ ImageId: imageId }),
      tips: ['Check that the image ID is valid (see list_uploads)', TIPS.apiKey, TIPS.connected]
    },
    async () => {
      const upload: any = await printifyClient.getUpload(imageId);
      if (!upload || typeof upload !== 'object' || !upload.id) {
        throw new Error(`Printify returned no upload record for image ${imageId}`);
      }
      return {
        upload,
        response: formatSuccessResponse(
          'Uploaded Image',
          {
            ...uploadSummary(upload ?? {}),
            ...(typeof upload?.size === 'number' ? { bytes: upload.size } : {}),
            previewUrl: upload?.preview_url
          }
        )
      };
    }
  );
}

export async function archiveUpload(printifyClient: PrintifyAPI, imageId: string) {
  return runService(
    'Archive Upload',
    {
      context: () => ({ ImageId: imageId }),
      tips: ['Check that the image ID is valid (see list_uploads)', TIPS.apiKey, TIPS.connected]
    },
    async () => {
      await printifyClient.archiveUpload(imageId);
      return {
        response: formatSuccessResponse(
          'Upload Archived',
          { ImageId: imageId },
          'The image is archived and no longer listed in the upload library.'
        )
      };
    }
  );
}
