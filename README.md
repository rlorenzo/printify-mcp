# Printify MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI
assistants such as Claude manage a [Printify](https://printify.com) shop: browse
the catalog, create and publish products, and generate designs with Replicate's
Flux models.

## Features

- **Shops:** list shops and switch the active one
- **Products:** list, get, create, update, delete, and publish
- **Catalog:** browse blueprints, print providers, and variants
- **Images:** upload from a URL, local file, or base64 `data:` URL; generate with Flux and
  upload in one step
- **Built-in guides:** the `how_to_use` tool serves step-by-step workflow docs
- **Prompt:** `generate_product_description`

## Requirements

- Node.js 24+
- A Printify API token (Printify → My Profile → Connections)
- Optional: a [Replicate](https://replicate.com) API token for image generation
- Optional: an [ImgBB](https://api.imgbb.com) API key, required by
  `generate_and_upload_image` when using Flux 1.1 Pro Ultra (the default model),
  whose images are too large for direct upload

## Configuration

Set these in the environment or in a `.env` file in the working directory
(`cp .env.example .env`):

| Variable | Required | Purpose |
| --- | --- | --- |
| `PRINTIFY_API_KEY` | Yes | Printify API token |
| `PRINTIFY_SHOP_ID` | No | Default shop; otherwise the first shop is used |
| `REPLICATE_API_TOKEN` | No | Enables image generation |
| `IMGBB_API_KEY` | For Flux Ultra | Stages large images for upload to Printify |
| `ALLOWED_FILE_DIR` | No | Directory that local uploads and `generate_image` output are confined to (default: working directory) |
| `PRINTIFY_MCP_DEBUG` | No | Any value saves each generated/uploaded image under `./debug` |

## Using with Claude Desktop

Add the server to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "printify": {
      "command": "npx",
      "args": ["-y", "@rlorenzo/printify-mcp"],
      "env": {
        "PRINTIFY_API_KEY": "your_printify_api_key",
        "REPLICATE_API_TOKEN": "your_replicate_api_token",
        "IMGBB_API_KEY": "your_imgbb_api_key"
      }
    }
  }
}
```

Alternatives for `command`/`args`:

- **Global install:** `npm install -g @rlorenzo/printify-mcp`, then use
  `"command": "printify-mcp"` with no args. Upgrade with
  `npm update -g @rlorenzo/printify-mcp`.
- **From source:** `git clone`, `npm install`, `npm run build`, then use
  `"command": "node"` and the absolute path to `dist/index.js` as the arg.
- **Docker:** `docker build -t printify-mcp .`, then use `"command": "docker"`
  with args `["run", "-i", "--rm", "-e", "PRINTIFY_API_KEY", "printify-mcp"]`
  (`-e NAME` forwards the value from `env`). `docker-compose.yml` is also
  provided.

To check the connection, ask Claude: *"Can you check the status of my Printify
connection?"* The server reports its version in the MCP handshake; releases are
listed on the [GitHub Releases page](https://github.com/rlorenzo/printify-mcp/releases).

## Tools

| Tool | Description |
| --- | --- |
| `get_printify_status` | Connection status and current shop |
| `list_shops` | List shops; the current one is marked |
| `switch_shop` | Set the active shop (`shopId`) |
| `list_products` | List products (`page`, `limit`) |
| `get_product` | Get a product (`productId`) |
| `create_product` | Create a product (`title`, `description`, `blueprintId`, `printProviderId`, `variants`, `printAreas`) |
| `update_product` | Update a product (`productId` plus any of `title`, `description`, `variants`, `printAreas`) |
| `delete_product` | Delete a product (`productId`) |
| `publish_product` | Publish to the connected sales channel (`productId`, `publishDetails`) |
| `set_publish_succeeded` / `set_publish_failed` | Report a publish result for a custom (API) sales channel, unlocking the product (`productId`, plus `externalId` and `handle`, or `reason`) |
| `notify_unpublished` | Report that a custom channel took the product down (`productId`) |
| `get_blueprints` | List catalog blueprints (`page`, `limit`) |
| `get_blueprint` | Get a blueprint (`blueprintId`) |
| `get_print_providers` | Print providers for a blueprint (`blueprintId`) |
| `get_variants` | Variants for a blueprint and provider (`blueprintId`, `printProviderId`) |
| `upload_image` | Upload from a URL, a local file in `ALLOWED_FILE_DIR`, or a `data:<mime>;base64,...` URL (`fileName`, `url`) |
| `generate_and_upload_image` | Generate with Flux and upload to Printify (`prompt`, `fileName`, generation options) |
| `generate_image` | Generate with Flux and save locally (`prompt`, `outputPath`, generation options) |
| `get_defaults` / `set_default` | View or change default generation options (model, size, aspect ratio, etc.) |
| `how_to_use` | Workflow guides: `product_creation`, `blueprints`, `print_providers`, `variants`, `images`, `publishing`, `image_generation` |

**Generation options:** `model`, `width`, `height`, `aspectRatio` (overrides
width/height), `outputFormat`, `numInferenceSteps`, `guidanceScale`,
`negativePrompt`, `seed`, `raw`, and model-specific options. Unset options fall
back to the values from `get_defaults`.

**Print areas:** `printAreas` is either an object keyed by placement
(`{ "front": { position, imageId } }`), applied to every variant, or an array of
variant groups (`[{ variantIds, placeholders }]`) for per-colorway artwork. In
`update_product`, the object form is merged into the existing print areas: named
placements are replaced and others are kept. The array form replaces all print
areas, and an empty object or array clears them.

## Example: a t-shirt with a generated design

```javascript
get_blueprints()                                    // pick 12: Unisex Jersey Short Sleeve Tee
get_print_providers({ blueprintId: "12" })          // pick 29
get_variants({ blueprintId: "12", printProviderId: "29" })

generate_and_upload_image({
  prompt: "A futuristic neon cityscape, logo design",
  fileName: "horizon-city-front"
})                                                  // → image ID 68032b22...

create_product({
  title: "Horizon City Skyline T-Shirt",
  description: "A neon cityscape on a premium unisex tee.",
  blueprintId: 12,
  printProviderId: 29,
  variants: [{ variantId: 18100, price: 2499 }, { variantId: 18101, price: 2499 }],
  printAreas: { front: { position: "front", imageId: "68032b22..." } }
})

publish_product({ productId: "68032b43..." })
```

## Using as a library

Importing the package does not start a server, touch stdio, or load `.env`:

```js
import { createPrintifyMcpServer } from '@rlorenzo/printify-mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const { server, initialize } = createPrintifyMcpServer({
  printifyApiKey: process.env.PRINTIFY_API_KEY,
});

await initialize();                 // fetch shops, select the default
await server.connect(new StdioServerTransport());
```

Omitted options fall back to `PRINTIFY_API_KEY`, `PRINTIFY_SHOP_ID`, and
`REPLICATE_API_TOKEN` from `process.env`. Call `dotenv.config()` yourself if
you use a `.env` file. `createPrintifyMcpServer()` also returns
`printifyClient` and `replicateClient`, and the `PrintifyAPI` and
`ReplicateClient` classes are exported for direct use.

## Development

```bash
npm install
npm run build     # compile to dist/
npm run dev       # rebuild and restart on change
npm run verify    # build, lint, and test
```

Source layout: `src/index.ts` (executable entry), `src/exports.ts` (library
entry), `src/tools.ts` (tool registration), `src/printify-api.ts` (Printify
client), `src/services/` (uploads, products, catalog, image generation),
`src/docs/` (guides served by `how_to_use`).

## Troubleshooting

- **"Printify API client is not initialized":** check that `PRINTIFY_API_KEY`
  is set and valid.
- **"Replicate API client is not initialized":** set `REPLICATE_API_TOKEN`.
- **Ultra model upload errors:** set `IMGBB_API_KEY`, or switch models with
  `set_default({ option: "model", value: "black-forest-labs/flux-1.1-pro" })`.
- **Local file refused:** upload sources and `generate_image` output paths must be inside `ALLOWED_FILE_DIR`.
- **Product creation fails:** confirm the variant IDs belong to the chosen
  blueprint and print provider, and that the image IDs exist.
- Server logs go to stderr. For Docker, use `docker logs printify-mcp`.

## Contributing

Pull requests are welcome.

## License

ISC
