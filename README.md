# Brim

Brim is a tool for making all kinds of things. Start with an idea, shape it, and turn it into something you can make.

The current prototype focuses on 3D-printable objects: describe a part, refine its shape, and export files for printing—all in your browser.

## Getting started

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

## Make something

1. **Design:** describe a part, or import an existing STL.
2. **Refine:** ask for changes like “make it taller,” “thicker walls,” or “scale to 80%.” Preview the result in 3D and undo changes as needed.
3. **Print files:** export an STL, or choose a printer and material, slice the model, inspect its layers, and download G-code.

Try:

- `twisted vase 120 tall, 70 wide, 2mm walls, 12 ribs`
- `gear with 24 teeth, 50mm diameter, 6mm thick, 5mm hole`
- `box 80 x 50 x 30 with 2mm walls and 6mm corners`

Dimensions default to millimeters; centimeters and inches also work.

## Development

An npm workspace:

- `apps/web`: the React app.
- `packages/core` (`@brim/core`): geometry, ops, intent and slicer. Pure TypeScript, runs in the browser and Node.

The domain vocabulary is in [docs/domain.md](docs/domain.md). Run the commands below from the repo root.

Built with React, TypeScript, Vite, Three.js, and Elanor UI components. Model generation and slicing run locally in the browser.

### AI prompts (optional)

With a key in the repo-root `.env` (see `.env.sample`), the dev server sends each prompt to an LLM through [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai). The LLM returns a typed `Spec` or an `Op[]` edit list, never mesh data, and the resolved ops are shown in the history. The default model is `opencode-go/deepseek-v4.1-flash` (`OPENCODE_API_KEY`). Set `BRIM_MODEL=provider/model-id` to use any pi-ai provider, with that provider's usual key variable. Without a key, or when a call fails, Brim uses the built-in rule-based parser.

```sh
npm run record -w packages/core   # re-run the paraphrase set against the real LLM and save replies for npm test
```

```sh
npm test         # Run self-checks
npm run build    # Type-check and build for production
npm run preview  # Serve the production build locally
```

## Prototype limits

Without an LLM key, descriptions are interpreted by a rule-based parser. Supported shapes and edits are limited; imported meshes support scale, stretch, flip, and rotation edits.

The built-in slicer is experimental. Review generated G-code and verify printer settings before running it on hardware. Export STL to use your usual slicer instead.
