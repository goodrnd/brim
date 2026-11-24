# Brim

An npm workspace. [README.md](README.md) describes each package, the commands and the printer simulator.

## Vocabulary

Read [docs/domain.md](docs/domain.md) before naming anything or touching Parts, Projects, Jobs, Printers or storage. Its terms are the names used in code, storage, the HTTP API and MCP tool names, and its Rules section is the expected behaviour.

## Boundaries

- `packages/core` runs in both the browser and Node, so it uses only APIs both have.
- `packages/printer`, `packages/store`, `apps/daemon` and `apps/simulator` are Node only. The web app reaches them through the daemon's `/api` (`apps/daemon/src/api.ts`), which `npm run dev` mounts on the Vite dev server.
- `apps/daemon/src/api.ts` checks the request's host and origin for every `/api` route, so a new route goes behind it.
- The LLM returns a typed `Spec` or `Op[]`. Mesh data comes from `@brim/core`.
- A printer's access code lives in the daemon's memory and the MCP's env. It stays out of storage, logs and anything sent to the browser.

## Checks

Run from the repo root, and finish a change with all three green:

```sh
npm run lint
npm run fmt
npm test
```

- `npm run build` is the only type-check: `tsc` in `apps/daemon` (which also covers `packages/store` and `packages/printer`), then in `apps/web`. Run it after changing types.
- `npm test` leaves out `test:e2e` and `test:sim`. The printer tests bind the real Bambu ports and `test:sim` needs Bambu Studio, so run them only when the change touches discovery, connecting or printing, and say so if you could not. Run `node --test e2e/storage.test.ts` in `apps/web` after touching storage or what a page saves.
- Storage schema changes are a new entry in `packages/store/src/db.ts` `migrations`; never edit a shipped one.
- After changing LLM prompts or the `Spec`/`Op` types, the recorded replies in `packages/core/test` may be stale. `npm run record -w packages/core` refreshes them and needs an API key, so ask first.

## Commits

Conventional commits with the package as scope: `fix(web): …`, `feat(ci): …`.
