import { describe, it, expect, vi, afterEach } from 'vitest';
import { format } from 'node:util';
import { AxiosError, AxiosHeaders } from 'axios';
import { describeError } from '../src/utils/error-handler.js';
import { PrintifyAPI } from '../src/printify-api.js';

const TOKEN = 'super-secret-printify-token';

/**
 * A real axios error: the request config, headers included, hangs off it as an
 * own enumerable property.
 *
 * printify-sdk-js currently wraps its axios errors in a plain Error, so this
 * shape does not reach the logger through the SDK today. It reaches it through
 * replicate-output.ts, which calls axios directly, and it would reach it from
 * Printify the moment the SDK stops wrapping or a direct call is added here.
 */
function axiosFailure(status = 401): AxiosError {
  const headers = new AxiosHeaders({
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json'
  });
  const config: any = { url: 'https://api.printify.com/v1/shops.json', method: 'get', headers };
  const error = new AxiosError('Request failed with status code ' + status, 'ERR_BAD_REQUEST', config, {}, {
    status,
    statusText: 'Unauthorized',
    data: { errors: { reason: 'Invalid token' } },
    headers: {},
    config
  } as any);
  return error;
}

/**
 * Capture what `run` would put on stderr.
 *
 * Vitest intercepts `console`, so spying on `process.stderr.write` sees
 * nothing. `console.error(...args)` writes `util.format(...args)`, so
 * formatting the captured arguments the same way reproduces the real bytes --
 * including Node's inspection of an error's own enumerable properties, which
 * is the whole mechanism under test.
 */
async function captureStderr(run: () => Promise<void> | void): Promise<string> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    lines.push(format(...args));
  });
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('why describeError exists', () => {
  it('logging an axios error directly writes the bearer token to stderr', async () => {
    const error = axiosFailure();

    const output = await captureStderr(() => {
      console.error('Error fetching shops:', error);
    });

    // Not an assertion about our code -- it pins why describeError exists.
    expect(output).toContain(TOKEN);
  });
});

describe('describeError', () => {
  it('keeps the token out of the rendered string', () => {
    const rendered = describeError(axiosFailure());

    expect(rendered).not.toContain(TOKEN);
    expect(rendered).not.toContain('Authorization');
  });

  it('still reports what a reader needs to debug', () => {
    const rendered = describeError(axiosFailure(422));

    expect(rendered).toContain('AxiosError');
    expect(rendered).toContain('Request failed with status code 422');
    expect(rendered).toContain('code=ERR_BAD_REQUEST');
    expect(rendered).toContain('status=422 Unauthorized');
    expect(rendered).toContain('Invalid token');
  });

  it('reports a plain error with its stack frames', () => {
    const rendered = describeError(new TypeError('nope'));

    expect(rendered).toContain('TypeError: nope');
    expect(rendered).toContain('at ');
    expect(rendered).not.toContain('status=');
  });

  it('caps a large response body rather than dumping it whole', () => {
    const error: any = new Error('too big');
    error.response = { status: 500, data: { blob: 'x'.repeat(50_000) } };

    const rendered = describeError(error);

    expect(rendered.length).toBeLessThan(3000);
    expect(rendered).toContain('chars total');
  });

  it('survives a circular response body', () => {
    const error: any = new Error('cycle');
    const data: any = { name: 'loop' };
    data.self = data;
    error.response = { status: 500, data };

    expect(describeError(error)).toContain('[unserializable]');
  });

  it('handles values that are not errors', () => {
    expect(describeError(null)).toBe('null');
    expect(describeError(undefined)).toBe('undefined');
    expect(describeError('just a string')).toBe('just a string');
  });

  it('names an error that has no message', () => {
    expect(describeError(new Error())).toContain('Error: (no message)');
  });
});

describe('PrintifyAPI logging', () => {
  it('never writes the token, at construction or on failure', async () => {
    const output = await captureStderr(async () => {
      const instance = new PrintifyAPI(TOKEN, '42');
      (instance as any).client = {
        shops: { list: vi.fn().mockRejectedValue(axiosFailure()) },
        products: {},
        uploads: {}
      };
      await expect(instance.getShops()).rejects.toThrow();
    });

    expect(output).not.toContain(TOKEN);
    expect(output).toContain('API token present');
  });

  it('says so when no token was supplied', async () => {
    // The SDK rejects an empty token; the log line lands first and explains why.
    const output = await captureStderr(() => {
      expect(() => new PrintifyAPI('', '42')).toThrow(/accessToken/);
    });

    expect(output).toContain('API token MISSING');
  });

  it('logs shops as ids and titles, not whole records', async () => {
    const shops = [
      { id: 26981565, title: 'Rex Renders', sales_channel: 'disconnected', address: { zip: '90210' } }
    ];

    const output = await captureStderr(async () => {
      const instance = new PrintifyAPI(TOKEN, '42');
      (instance as any).client = { shops: { list: vi.fn().mockResolvedValue(shops) }, products: {}, uploads: {} };
      await instance.getShops();
    });

    expect(output).toContain('26981565 (Rex Renders)');
    expect(output).not.toContain('90210');
  });
});
