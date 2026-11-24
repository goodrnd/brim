# Brim domain

What Brim does, in six areas, and the names it uses. These names are the ones in code, storage, the HTTP API and MCP tool names. Each area lists what is built and what is planned.

## Areas

```
Projects    what you are making        ── uses ──────────▶ Library
Library     everything made or bought  (Part · File · Component)
Design      makes Parts                ── a Part version ─▶ Jobs
Jobs        each print                 ◀── profiles ─────── Printers
                                       ◀── spool, cost ──── Inventory
            printed and good ──▶ Projects    failed: fix it ──▶ Design
Printers    the machines
Inventory   what you have on hand
```

Projects are why you make something. Design makes the Parts, Jobs print them, and Printers and Inventory are what you print them with. Jobs sit in the middle because every other area either feeds them or reads from them.

```
Library
 ├── Part        digital   printable thing with history
 ├── File        digital   reference material, kept as-is
 └── Component   physical  bought thing
Project ─┬─ Use → Part · File · Component   reference, with a quantity
         └─ Note                            owned by the project
Part ── Entry                one version: prompt, changes, model
Job                          a Part at one Entry, sent to a Printer with a Material
Printer · Material           profiles
Spool                        filament bought (Inventory)
```

## Projects

What you are making: a name, its Notes, and Uses of Library items.

- **Project**: a name, its Notes and its Uses.
- **Use**: `{projectId, itemId, qty}` links a Project to a Part, File or Component. `qty` is how many to print or how many are needed; Files ignore it. One item can have Uses in many Projects.
- **Note**: a body of text, always in one Project. A Project has several small Notes, not one document, so a person and agents can add to it without conflicts.
- **Bill of materials**: a Project's Uses with their quantities: Parts to print, Components to buy.
- **Progress**: for each Part Use, how many `ok` Jobs exist against `qty`.
- **Shopping list**: for each Component, `qty - onHand` summed across Projects, where positive.
- **Cost**: the cost of the Jobs that printed the Project's Parts, plus Component prices times `qty`.

Built: Project, Note (plain text), Use of Parts. Planned: Uses of Files and Components, `qty` in the UI (it is always 1 today), markdown Notes, bill of materials, progress, shopping list, cost.

## Library

Everything made or bought, whether or not a Project uses it. It lists definitions, not physical copies. The Library page shows Parts and Projects as tabs; Projects sit there for navigation but are not Library items.

- **Part**: the one printable, editable object. Digital. Its `history` is a list of Entries.
- **File**: reference material kept as uploaded (photos, PDFs, datasheets, someone else's STL or 3MF). Digital. "Make part from file" creates a Part from a mesh File (STL, 3MF, OBJ) and keeps the File as the original.
- **Component**: something you buy rather than print (screws, magnets, bearings, a board, a nozzle): name, optional link, price and notes. Physical. It has no history; a different spec is a different Component. Its count on hand lives in Inventory.

Built: Part, File. Planned: Component.

## Design

Makes and changes Parts.

- **Entry**: `{prompt, changes, model}`, one version of a Part and a full snapshot. The last Entry is the current version; undo removes it, restore appends a copy of an earlier one.
- **Model**: the geometry type in `@brim/core/model.ts`: `param` (a `Spec`, rebuilt on demand) or `mesh` (triangles; imports and anything after a boolean op). Not a user-facing term; the UI says "part".
- A prompt goes to the LLM, which returns a typed `Spec` for a new Part or an `Op[]` for a change. Without a key, the rule-based parser does the same.

Built: describe a Part, import STL, 3MF or OBJ, refine in words with a 3D preview, every version kept. Planned: Entry gets `id`, `at` and `source` (`web` | `mcp`).

## Jobs

One print of a Part, at `#/jobs` and `#/job/<id>`. A Job is the history of what was printed, so it keeps everything about the print rather than pointing at things that change.

- **Job**: the Part and the Entry it printed, the Printer and Material, the settings, and the slicer's time and filament estimate.
- A Job's run has three separate facts: whether the send reached the printer (`dispatch`), what the firmware reported (`run`), and whether the part is good (`outcome`).
- **Outcome**: unset while queued, then `ok` or `failed` with an optional `note`. Only a person sets it.
- Live progress (percent, layer, temperatures) is read from the printer and never stored.

Built: slice in the browser and preview layers, queue a Job, watch a connected printer live, set the outcome with a note. Planned: send to a Bambu printer, the shape below, cost, photos and timelapse.

Sending goes through bambu-printer-mcp: `print_3mf` with a slicer-made `.gcode.3mf`, status and spools from `counterpart_print_progress` and `get_printer_filaments`, and `counterpart_print_record` copied into the Job's `run` when the print ends. The MCP keeps only its last ten records, so Brim keeps the long-term history.

```ts
Job {
  id, partId, entryId, part            // part title when created
  printerId, printer: {name, bambuModel}
  filaments: [{slot, material, color, spoolId?}] // AMS mapping used
  settings: {layer, infill}, estimate: {seconds, grams} // from the sent file, not our preview
  artifact?: {sha256, plate}           // the .gcode.3mf sent; matches the MCP's record
  createdAt
  dispatch?: {at, recordId, status: 'unconfirmed' | 'accepted' | 'observed-active'}
  run?: {state, startedAt?, endedAt?, problems: Array<string>} // copied when the print ends
  outcome?: 'ok' | 'failed', note?     // a person decides
}
```

## Printers

The machines and their profiles.

- **Printer**, **Material**: slicing profiles. Stock presets live in `@brim/core/slicer.ts`; users edit them and add their own.
- A Printer is a profile; with a `serial` it is also one physical printer. Identical printers are separate Printers (duplicate, then set each serial), so each can be addressed on its own. Serials are unique; "Reset to presets" keeps Printers that have one.
- A Bambu Printer names its `bambuModel` (the `bambu_model` that [bambu-printer-mcp](https://dmontgomery40.github.io/bambu-printer-mcp/reference/printer-tools) takes). Brim finds the host and serial by discovery (SSDP).
- **Access code**: comes from a person, is held only in the Brim server's memory and the MCP's env, and is never stored or sent to the browser. After a server restart, the person enters it again.
- Loaded spools are read live from the printer and never stored.

Built: profiles, discovery, connecting, live status and loaded spools. Planned: recent Jobs on a Printer's page, as a filtered view of Jobs.

## Inventory

What you have on hand. The Library defines a thing; Inventory counts it.

- **Spool**: filament you bought: material, color, price per kg, grams left. A Job's cost is its grams times the price of the Spool it used.
- **On hand**: the count of a Component (`onHand`). Spares such as nozzles and belts are Components that no Project uses.
- **Printed stock**: Parts kept printed ("3 brackets in the drawer"), counted from `ok` Jobs.

Planned: all of it.

## Rules

- Something Brim prints and edits is a Part; something you buy is a Component; everything else is a File.
- Digital items are references: using a Part in a Project does not copy it, and editing it changes it everywhere it is used. Duplicate the Part to change it for one Project.
- Physical items are counted, in Inventory.
- Only Notes belong to a Project. Deleting a Project deletes its Notes and Uses; Library items stay.
- Deleting a Library item deletes its Uses; warn when it has any.
- "Not used in any project" is a Library filter, not a separate place.
- Jobs are history: never delete them in bulk. Removing one Job by hand is fine.
- A printer reporting "finished" is not `ok`: firmware only knows its commands ran. Only a person sets `outcome`; `cancelled` is not `failed`.
- A Job is sent once. Printing again makes a new Job; resending after an `unconfirmed` dispatch can print twice.
- Other areas show Jobs as filtered views (a Project's, a Part's, a Printer's); the Jobs area owns them.
- Job is process-neutral on purpose; Printer stays "Printer". A second process (laser, CNC) gets its own profile type beside Printer, not a generic "Machine".

## Storage

The dev server keeps everything in SQLite (Kysely on `node:sqlite`) and file bytes in a local bucket named by sha256, both in `.brim/`. A mesh Entry stores its triangles in the bucket and names them by `sha256`. A static build without the server uses localStorage and drops mesh Entries.

## Open questions

- Spools: how a bought Spool is matched to the spool the printer reports, and how grams left stay right when a print fails partway.
- MCP edits: change the Part in place (labelled by `source`) or work on a copy?
- Outcome beyond ok/failed: photos, measurements, camera frames from `counterpart_print_record`.
- A Use pinned to one Entry, so a Project can hold an older version of a Part.
- Project parameters and relations between Parts (the lid fits the box).
- Inventory beyond counts: storage locations, suppliers, reorder levels.
