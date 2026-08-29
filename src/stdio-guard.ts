/**
 * Import this first from the CLI entrypoint, before any other local module.
 *
 * MCP stdio transports reserve **stdout** exclusively for JSON-RPC frames. Any
 * stray byte written there corrupts the protocol stream and the client drops the
 * connection. Our own code logs to stderr, but dependencies cannot be trusted to,
 * so anything written to stdout is redirected to stderr.
 *
 * StdioServerTransport captures the `process.stdout` *stream object* and calls
 * `.write()` on it, so it would be caught by the redirect as well. Pass
 * {@link protocolStdout} to the transport to give it the real, unpatched writer.
 */
const realWrite = process.stdout.write.bind(process.stdout);

/**
 * A stdout handle that still reaches the real stdout, for the MCP transport.
 * Everything except `write` is forwarded to the underlying stream, so event
 * handling (notably the `drain` backpressure signal) behaves normally.
 */
export const protocolStdout = new Proxy(process.stdout, {
  get(target, prop) {
    if (prop === 'write') return realWrite;
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }
}) as NodeJS.WriteStream;

// Route console methods that default to stdout over to stderr.
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);
console.debug = (...args: unknown[]) => console.error(...args);

// Catch dependencies that write to stdout directly, bypassing console.
process.stdout.write = ((
  chunk: any,
  encoding?: any,
  callback?: any
): boolean => process.stderr.write(chunk, encoding, callback)) as typeof process.stdout.write;
