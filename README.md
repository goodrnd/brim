# Brim

Brim is a tool for making all kinds of things. Start with an idea, shape it, and turn it into something you can make.

The current prototype focuses on 3D-printable objects: describe a part, refine its shape, and export files for printing—all in your browser.

## Getting started

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

Without Node installed: `dagger call dev up --ports 5173:5173` serves the app with the printer simulator beside it.

## Make something

1. **Design:** describe a part, or import an existing STL, 3MF or OBJ file.
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
- `packages/printer` (`@brim/printer`): Brim's connection to Bambu printers. It runs [bambu-printer-mcp](https://github.com/DMontgomery40/bambu-printer-mcp) as a child process and calls its tools: discover, slice, print, progress, filaments, pause, resume, cancel. `api.ts` is the dev server's `/api/printers` (discover, connect, live status). Node only.
- `packages/store` (`@brim/store`): the server's storage. A SQLite database through [Kysely](https://kysely.dev) on Node's built-in `node:sqlite` holds parts, projects, notes, jobs and profiles; a local bucket holds file bytes and mesh triangles, named by sha256. Both live in `.brim/` at the repo root (`BRIM_DATA` overrides; delete it to start over). `api.ts` is the dev server's `/api/state`, `/api/blobs` and `/api/files`. On the first visit the web app imports what this browser had in localStorage. Node only.
- `apps/simulator` (`@brim/simulator`): a simulated Bambu printer, for developing without hardware (see below).

The domain vocabulary is in [docs/domain.md](docs/domain.md). Run the commands below from the repo root.

Built with React, TypeScript, Vite, Three.js, and Elanor UI components. Model generation and slicing run locally in the browser.

### AI prompts (optional)

With a key in the repo-root `.env` (see `.env.sample`), the dev server sends each prompt to an LLM through [pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai). The LLM returns a typed `Spec` or an `Op[]` edit list, never mesh data, and the resolved ops are shown in the history. The default model is `opencode-go/deepseek-v4.1-flash` (`OPENCODE_API_KEY`). Set `BRIM_MODEL=provider/model-id` to use any pi-ai provider, with that provider's usual key variable. Without a key, or when a call fails, Brim uses the built-in rule-based parser. With the [1Password CLI](https://developer.1password.com/docs/cli/), `npm run dev:op` reads the key from the references in `.env.op` instead, so no `.env` is needed.

```sh
npm run record -w packages/core   # re-run the paraphrase set against the real LLM and save replies for npm test
```

```sh
npm test         # Run self-checks
npm run build    # Type-check and build for production
npm run preview  # Serve the production build locally
```

### Checks

Pull requests run [Dagger](https://dagger.io) checks on Dagger Cloud: lint, format, test, end-to-end, sim and build, the npm scripts above in a pinned Node container (`.dagger/modules/brim-dev`). To run them locally you need the Dagger CLI v1.0.0-beta.28 (the version the module is tested with) and a container runtime such as Docker or OrbStack.

```sh
dagger check                            # Run every check Dagger Cloud runs
dagger check --check lint               # Run one check
dagger check -i                         # Open a shell in the container when a check fails
dagger cloud checks rerun               # Re-run this commit's checks on Dagger Cloud, e.g. after a flake
dagger call dist export --path apps/web/dist  # Build the web app and copy it out
dagger lock update                      # Refresh dagger.lock's pinned images (commit it)
```

### Printer simulator

`npm run simulator` starts a simulated Bambu X2D with an AMS 2 Pro on this machine's real Bambu ports: MQTT over TLS (8883), implicit FTPS (990, its storage is a temp dir) and a P1-style camera (6000). It prints the bambu-printer-mcp settings that drive it. `BAMBU_MODEL=p1s` simulates a P1S instead.

The X2D reports two nozzles, one external spool per nozzle, a four-slot AMS 2 Pro with drying, and its cancel state. A job heats up, then runs `PREPARE` → `RUNNING` → `FINISH`, with pause, resume and stop. Jobs take `SIM_JOB_SECONDS` (default 120). It does not run the G-code, simulate AMS loading or errors, or serve the RTSP camera that X1, P2S, H2 and X2D printers use.

bambu-printer-mcp sends X2D prints and controls through Bambu's closed networking plug-in. For the simulator, `BAMBU_NATIVE_HELPER` points it at `apps/simulator/bin/native-helper`, a stand-in that hands the job to the simulator. On Linux the MCP also requires Bambu's plug-in and certificates to exist, so it is pointed at the empty files in `apps/simulator/bin/plugin`; they are deliberate stand-ins, not truncated downloads, and a real plug-in does not belong there. That tests Brim and the MCP's own checks, not Bambu's transport.

The simulator also announces itself on the LAN the way a real printer does (SSDP on UDP 2021, from this machine's LAN address; `SIM_SSDP=0` turns that off). So in `npm run dev`, Settings → **Find printers** lists it; connect with access code `12345678` to see its live status and AMS spools. Real Bambu printers show up the same way; their access code is on the printer's screen. Brim keeps the code in the dev server's memory only, so after a restart you connect again. Bambu Studio holds UDP 2021 while it runs, so close it to discover.

`npm run test:e2e` runs that path end to end without a browser: it starts the simulator and the dev server, discovers the printer, connects (a wrong code is refused) and reads its status. It needs the ports above plus UDP 2021 free and a private LAN address; `npm test` leaves it out. The same command also runs the storage tests, which drive the web app in Chromium against a dev server with a temporary `BRIM_DATA`: parts (imported meshes too), projects, notes and files survive a reload. Install the browser once with `npx playwright install chromium-headless-shell`.

`npm run test:sim` slices a cube with Bambu Studio and prints it on the simulated X2D through bambu-printer-mcp. It needs Bambu Studio and the ports above free, so stop `npm run simulator` first; `npm test` leaves it out.

`dagger check` runs all of it in containers with every dependency: lint, format, `npm test`, the build, `test:e2e` with Chromium, and `test:sim` (the `sim` check) with Bambu Studio's Linux CLI on linux/amd64, emulated on Apple silicon. `dagger check sim` runs one.

## Prototype limits

Without an LLM key, descriptions are interpreted by a rule-based parser. Supported shapes and edits are limited; imported meshes support scale, stretch, flip, and rotation edits.

The built-in slicer is experimental. Review generated G-code and verify printer settings before running it on hardware. Export STL to use your usual slicer instead.
