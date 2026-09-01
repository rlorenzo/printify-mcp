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

/**
 * Format an error response for tool output
 */
export function formatErrorResponse(
  error: any,
  step: string,
  context: Record<string, any> = {},
  tips: string[] = []
) {
  // Get error details
  const errorType = error.constructor.name;
  const errorMessage = error.message || 'Unknown error';
  const errorStack = error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : 'Not available';
  
  // Format the error message
  let text = `❌ **Error in ${step}**\n\n`;
  
  // Add context information
  text += formatFields(context);
  
  text += `- **Error**: ${errorMessage}\n\n`;
  
  // Add detailed diagnostic information
  text += `=== DETAILED DIAGNOSTIC INFORMATION ===\n\n`;
  text += `- **Error Type**: ${errorType}\n`;
  text += `- **Error Stack**: ${errorStack}\n`;
  
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
  if (error.response) {
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
    content: [{ type: "text", text }],
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
