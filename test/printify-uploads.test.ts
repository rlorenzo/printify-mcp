import { describe, it, expect } from 'vitest';
import { listUploads, getUpload, archiveUpload } from '../src/services/printify-uploads.js';

const UPLOAD = {
  id: '5e16d66791287a0006e522b2',
  file_name: 'logo.png',
  height: 5979,
  width: 17045,
  size: 1138575,
  mime_type: 'image/png',
  preview_url: 'https://images.test/preview/5e16',
  upload_time: '2020-01-09 07:29:43'
};

function fakeClient(overrides: Record<string, any> = {}) {
  return {
    listUploads: async () => ({ current_page: 1, last_page: 3, total: 25, data: [UPLOAD] }),
    getUpload: async () => UPLOAD,
    archiveUpload: async () => undefined,
    ...overrides
  } as any;
}

describe('listUploads', () => {
  it('summarizes each image and reports the paging', async () => {
    const text = (await listUploads(fakeClient())).response!.content[0].text;
    expect(text).toContain('"id":"5e16d66791287a0006e522b2"');
    expect(text).toContain('"size":"17045x5979"');
    expect(text).toContain('**PageCount**: "3"');
    expect(text).toContain('**Total**: "25"');
    // The preview URL is for get_upload, one image at a time.
    expect(text).not.toContain('preview/5e16');
  });

  it('asks for the requested page and limit', async () => {
    let seen: any[] = [];
    const client = fakeClient({ listUploads: async (...args: any[]) => { seen = args; return { data: [] }; } });
    await listUploads(client, { page: 2, limit: 5 });
    expect(seen).toEqual([2, 5]);
  });

  it('reports a failure without throwing', async () => {
    const client = fakeClient({ listUploads: async () => { throw new Error('uploads down'); } });
    const result = await listUploads(client);
    expect(result.success).toBe(false);
    expect(result.errorResponse!.content[0].text).toMatch(/uploads down/);
  });
});

describe('getUpload and archiveUpload', () => {
  it('returns one image with its preview URL and byte size', async () => {
    const text = (await getUpload(fakeClient(), UPLOAD.id)).response!.content[0].text;
    expect(text).toContain('**previewUrl**: "https://images.test/preview/5e16"');
    expect(text).toContain('**bytes**: "1138575"');
  });

  it('archives an image by id', async () => {
    let archived = '';
    const client = fakeClient({ archiveUpload: async (id: string) => { archived = id; } });
    const text = (await archiveUpload(client, UPLOAD.id)).response!.content[0].text;
    expect(archived).toBe(UPLOAD.id);
    expect(text).toContain('no longer listed in the upload library');
  });
});
