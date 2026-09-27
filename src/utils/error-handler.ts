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
  if (error === null || error === undefined || typeof error !== 'object') {
    return String(error);
  }

  const name = error.name || error.constructor?.name || 'Error';
  const parts = [`${name}: ${error.message || '(no message)'}`];

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

/** An error envelope for a tool result. */
export function formatErrorResponse(
  error: any,
  step: string,
  context: Record<string, any> = {},
  tips: string[] = []
) {
  const errorType = error.constructor.name;
  const errorMessage = error.message || 'Unknown error';
  const errorStack = error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : 'Not available';

  let text = `❌ **Error in ${step}**\n\n`;
  text += formatFields(context);
  text += `- **Error**: ${errorMessage}\n\n`;
  text += `=== DETAILED DIAGNOSTIC INFORMATION ===\n\n`;
  text += `- **Error Type**: ${errorType}\n`;
  text += `- **Error Stack**: ${errorStack}\n`;

  // The response body is deliberately omitted: it can carry account details,
  // and it reaches the model verbatim.
  if (error.response) {
    text += `- **API Response Status**: ${error.response.status}\n\n`;
  }

  if (tips.length > 0) {
    text += `\n🔄 Please try again with a different prompt or parameters.\n\n`;
    text += '💡 **Tips**:\n';
    text += tips.map(tip => `• ${tip}\n`).join('');
  }

  return {
    content: [{ type: "text" as const, text }],
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
export async function runService<T extends { response: any }>(
  step: string,
  onError: { context?: () => Record<string, any>; tips?: string[] },
  fn: () => Promise<T>
): Promise<({ success: true } & T) | { success: false; error: any; errorResponse: ReturnType<typeof formatErrorResponse> }> {
  try {
    return { success: true, ...(await fn()) };
  } catch (error: any) {
    console.error(`Error in ${step}:`, describeError(error));
    return {
      success: false,
      error,
      errorResponse: formatErrorResponse(error, step, onError.context?.() ?? {}, onError.tips ?? [])
    };
  }
}
