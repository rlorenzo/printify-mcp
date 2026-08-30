/**
 * Error handling utilities for Printify MCP
 */

/**
 * Format an error response for tool output
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
