import { createRequire } from "node:module";

/** Package version, read from package.json so the MCP `initialize` handshake matches what npm installed. */
export const VERSION: string = createRequire(import.meta.url)("../package.json").version;
