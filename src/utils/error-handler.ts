/**
 * Error handling utilities for Printify MCP
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

/**
 * Cap on a serialized response body in a log line. A failing request should not
 * be able to flood the operator's log the way the catalog tools once flooded a
 * tool response.
 */
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
 * Render an error as a single safe string for the operator log.
 *
 * Never hand an error object straight to `console.error`. An axios error
 * carries `config` as an own enumerable property, so Node's inspector prints
 * `headers: { Authorization: 'Bearer <the real token>' }` in full -- and
 * stderr here is where the MCP client keeps its log file.
 *
 * printify-sdk-js@1.4 wraps axios errors in a plain Error before they reach
 * us, so no Printify token is reaching the log today. That is the SDK's
 * implementation detail rather than a contract, `axios` is a direct dependency
 * of this package and already used in replicate-output.ts, and the
 * `if (error.response)` branches in printify-api.ts are written for axios
 * errors. This keeps the guarantee independent of all three.
 *
 * What is kept is what actually helps: the error name and message, the error
 * code, the HTTP status, and the response body -- which is where Printify
 * returns its validation errors.
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
    errorMessage: e.message ? String(e.message) : String(error)
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

/**
 * Format an error response for tool output
 */
export function formatErrorResponse(
  error: any,
  step: string,
  context: Record<string, any> = {},
  tips: string[] = []
) {
  const { errorType, errorMessage } = describeThrownValue(error);

  // Format the error message
  let text = `❌ **Error in ${step}**\n\n`;

  // Add context information
  text += formatFields(context);

  text += `- **Error**: ${errorMessage}\n\n`;

  // Add detailed diagnostic information. The stack trace is deliberately
  // left out here, same as the API response body below: it reaches the
  // model verbatim and can carry local file paths and internal call
  // structure. Callers already log it to stderr via describeError.
  text += `=== DETAILED DIAGNOSTIC INFORMATION ===\n\n`;
  text += `- **Error Type**: ${errorType}\n`;

  // Add additional context details
  Object.entries(context).forEach(([key, value]) => {
    if (key !== 'Prompt' && key !== 'Model' && key !== 'Error') {
      if (typeof value === 'object' && value !== null) {
        text += `- **${key}**: ${JSON.stringify(value, null, 2)}\n`;
      } else if (value !== undefined && value !== null) {
        text += `- **${key}**: ${value}\n`;
      }
    }
  });
  
  // Add API response status if available. The response body is deliberately
  // omitted: it can carry account details, and it reaches the model verbatim.
  if (error?.response) {
    text += `- **API Response Status**: ${error.response.status}\n\n`;
  }
  
  // Add tips if provided
  if (tips.length > 0) {
    text += `\n🔄 Please try again with a different prompt or parameters.\n\n`;
    text += '💡 **Tips**:\n';
    tips.forEach(tip => {
      text += `• ${tip}\n`;
    });
  }
  
  return {
    content: [{ type: "text", text: boundErrorText(text) }],
    isError: true
  };
}

/**
 * Format a success response for tool output
 */
export function formatSuccessResponse(
  title: string,
  data: Record<string, any> = {},
  additionalText: string = ''
) {
  let text = `✅ **${title}**\n\n`;
  
  // Add data information
  text += formatFields(data);
  
  // Add additional text if provided
  if (additionalText) {
    text += `\n${additionalText}`;
  }
  
  return {
    content: [{ type: "text", text }]
  };
}
