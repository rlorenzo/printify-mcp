/**
 * Error and response formatting for tool output.
 */

/**
 * Render a key/value map as markdown bullets.
 *
 * Strings that already contain quotes are emitted verbatim so pre-quoted values
 * are not double-quoted; objects are JSON-encoded; everything else is quoted.
 */
function formatFields(fields: Record<string, any>): string {
  return Object.entries(fields).map(([key, value]) => {
    if (typeof value === 'string' && value.includes('"')) {
      return `- **${key}**: ${value}\n`;
    }
    if (typeof value === 'object') {
      return `- **${key}**: ${JSON.stringify(value)}\n`;
    }
    return `- **${key}**: "${value}"\n`;
  }).join('');
}

/** Cap on a serialized response body in a log line. */
const MAX_LOGGED_BODY = 2000;

/**
 * `text` whole if it is at most `max` chars, else a short head plus its
 * length. For echoing caller-supplied strings (a path, a source, a message)
 * into a log line or reply, where they can be arbitrarily large.
 */
export function previewText(text: string, max = 200): string {
  return text.length > max
    ? `${text.slice(0, Math.floor(max / 2))}... (${text.length} chars)`
    : text;
}

function safeJson(value: any): string {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return String(value);
    return text.length > MAX_LOGGED_BODY
      ? `${text.slice(0, MAX_LOGGED_BODY)}... (${text.length} chars total)`
      : text;
  } catch {
    return '[unserializable]';
  }
}

/**
 * Render an error as one safe log line: name, message, code, HTTP status,
 * response body (capped), and the top stack frames.
 *
 * Never pass an error object straight to `console.error`: axios errors carry
 * `config.headers.Authorization`, which Node's inspector would print in full to
 * stderr, the MCP client's log file.
 */
export function describeError(error: any): string {
  // Messages routinely quote caller-supplied input, so they are bounded
  // like the response body below.
  if (error === null || error === undefined || typeof error !== 'object') {
    return previewText(String(error), MAX_LOGGED_BODY);
  }

  const name = error.name || error.constructor?.name || 'Error';
  const parts = [`${name}: ${previewText(String(error.message || '(no message)'), MAX_LOGGED_BODY)}`];

  if (error.code) {
    parts.push(`code=${error.code}`);
  }

  if (error.response) {
    const { status, statusText, data } = error.response;
    parts.push(`status=${status}${statusText ? ` ${statusText}` : ''}`);
    if (data !== undefined) {
      parts.push(`body=${safeJson(data)}`);
    }
  }

  if (typeof error.stack === 'string') {
    const frames = error.stack
      .split('\n')
      .filter((line: string) => line.trim().startsWith('at '))
      .slice(0, 3);
    if (frames.length > 0) {
      parts.push(`\n${frames.join('\n')}`);
    }
  }

  return parts.join(' ');
}

/**
 * Type name and message of a caught value. `error` is whatever was thrown, not
 * necessarily an Error -- a thrown string/null/undefined has no
 * .constructor/.message to read, which would otherwise crash the caller
 * instead of reporting the original failure.
 */
export function describeThrownValue(error: unknown): { errorType: string; errorMessage: string } {
  if (error === null) {
    return { errorType: 'null', errorMessage: 'null' };
  }
  if (typeof error !== 'object') {
    return { errorType: typeof error, errorMessage: String(error) };
  }
  const e = error as { constructor?: { name?: string }; message?: unknown };
  return {
    errorType: e.constructor?.name || 'Object',
    // An Error with an empty message still stringifies to its name
    // ("TypeError"); any other object would stringify to "[object Object]".
    errorMessage: e.message
      ? String(e.message)
      : error instanceof Error ? String(error) : 'Unknown error'
  };
}

/**
 * Longest unbroken run of non-whitespace an error response passes through
 * whole. A caller-supplied source (a raw base64 payload taken for a file path,
 * say) is echoed by several messages on the way here; collapsing overlong runs
 * at this one choke point keeps every echo from flooding the model's context.
 */
const MAX_UNBROKEN_RUN = 200;
const RUN_PREVIEW = 60;

/**
 * Hard cap on a whole model-facing error text. Collapsing long runs alone does
 * not bound it: caller-supplied text with whitespace in it (a long prompt, a
 * path full of spaces) passes that check at any length.
 */
const MAX_ERROR_TEXT = 4000;

/**
 * How much of the input the collapsing pass looks at. Enough that collapsed
 * runs still leave MAX_ERROR_TEXT worth of real content, without scanning an
 * arbitrarily large caller-supplied string just to throw most of it away.
 */
const MAX_SCANNED_TEXT = 64_000;

/**
 * Bound error text before it is returned to the model: collapse overlong
 * unbroken runs, then cap the total length.
 */
export function boundErrorText(text: string): string {
  const collapsed = text.slice(0, MAX_SCANNED_TEXT).replace(new RegExp(`\\S{${MAX_UNBROKEN_RUN + 1},}`, 'g'),
    run => `${run.slice(0, RUN_PREVIEW)}... (${run.length} chars)`);
  if (collapsed.length <= MAX_ERROR_TEXT && text.length <= MAX_SCANNED_TEXT) {
    return collapsed;
  }
  // The note counts toward the cap, so the result never exceeds it.
  const note = `\n... (truncated, ${text.length} chars total)`;
  return collapsed.slice(0, MAX_ERROR_TEXT - note.length) + note;
}

/** An error envelope for a tool result, bounded for the model. */
export function formatErrorResponse(
  error: any,
  step: string,
  context: Record<string, any> = {},
  tips: string[] = []
) {
  const { errorType, errorMessage } = describeThrownValue(error);

  let text = `❌ **Error in ${step}**\n\n`;
  text += formatFields(context);
  text += `- **Error**: ${errorMessage}\n\n`;
  text += `=== DETAILED DIAGNOSTIC INFORMATION ===\n\n`;
  text += `- **Error Type**: ${errorType}\n`;

  // The stack and response body are deliberately omitted: they reach the model
  // verbatim and can carry local paths or account details. describeError logs
  // them to stderr instead.
  if (error?.response) {
    text += `- **API Response Status**: ${error.response.status}\n\n`;
  }

  if (tips.length > 0) {
    text += `\n🔄 Please try again with a different prompt or parameters.\n\n`;
    text += '💡 **Tips**:\n';
    text += tips.map(tip => `• ${tip}\n`).join('');
  }

  return {
    content: [{ type: "text" as const, text: boundErrorText(text) }],
    isError: true
  };
}

/** A success envelope for a tool result. */
export function formatSuccessResponse(
  title: string,
  data: Record<string, any> = {},
  additionalText: string = ''
) {
  let text = `✅ **${title}**\n\n` + formatFields(data);
  if (additionalText) {
    text += `\n${additionalText}`;
  }
  return {
    content: [{ type: "text" as const, text }]
  };
}

/** A plain-text tool result. */
export function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/** Troubleshooting tips shared by most Printify services. */
export const TIPS = {
  apiKey: 'Check that your Printify API key is valid',
  connected: 'Ensure your Printify account is properly connected',
  shop: 'Make sure you have selected a shop'
} as const;

/**
 * Run a service step and wrap the outcome.
 *
 * On success, the fields `fn` returns (including its `response` envelope) are
 * spread into `{ success: true, ... }`. On a throw, the error is logged safely
 * and returned as `{ success: false, error, errorResponse }`. `context` is lazy
 * so it can read state that only exists once the step has failed.
 */
export async function runService<T extends { response: any; success?: never }>(
  step: string,
  onError: { context?: () => Record<string, any>; tips?: string[] },
  fn: () => Promise<T>
): Promise<({ success: true } & T) | { success: false; error: any; errorResponse: ReturnType<typeof formatErrorResponse> }> {
  try {
    // `success` last: the wrapper owns the envelope, and a stray `success`
    // from the service must not be able to flip it.
    return { ...(await fn()), success: true };
  } catch (error: any) {
    console.error(`Error in ${step}:`, describeError(error));
    // The context builder reads live state that the failure may have left
    // broken; if it throws, report the original error without context rather
    // than losing it.
    let context: Record<string, any> = {};
    try {
      context = onError.context?.() ?? {};
    } catch (contextError) {
      console.error(`Error building context for ${step}:`, describeError(contextError));
    }
    return {
      success: false,
      error,
      errorResponse: formatErrorResponse(error, step, context, onError.tips ?? [])
    };
  }
}
