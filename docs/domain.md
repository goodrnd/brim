# Brim domain

The shared vocabulary for the web app, the HTTP API and the MCP tools. Use these names in code, storage and tool names.

```
Library                    catalog of things you can use in projects
 ├── Part        digital   printable thing with history
 ├── File        digital   reference material, kept as-is
 └── Component   physical  bought thing, with a count on hand
Project ─┬─ Use → Part · File · Component   reference, with a quantity
         └─ Note                            markdown, owned by the project
Part ── Entry              one step: prompt, changes, model
Job                        a part at one entry, sent to a printer with a material
Printer · Material         profiles
```

## Terms

- **Library**: every Part, File and Component, whether or not any Project uses it. It lists definitions, not physical copies. The Library page shows Parts and Projects as tabs; Projects sit there for navigation but are not Library items.
- **Part**: the one printable, editable object. Digital. Its `history` is a list of Entries, each a full snapshot. The last Entry is the current state; undo pops it, restore appends a copy of an earlier one.
- **Entry**: `{prompt, changes, model}`. `model` is the geometry: `param` (a `Spec`, rebuilt on demand) or `mesh` (triangles; imports and anything after a boolean op).
- **Model**: the geometry type in `@brim/core/model.ts`. Not a user-facing term; the UI says "part".
- **File**: reference material kept as uploaded (photos, PDFs, datasheets, someone else's STL or 3MF). Digital. "Make part from file" creates a Part from a mesh file (STL, 3MF, OBJ) and leaves the File as the original.
- **Component**: something you buy rather than print (screws, magnets, bearings, a board): name, optional link and notes, and `onHand`, the count you have. Physical. It has no history; a different spec is a different Component.
- **Project**: a name, its Notes, and Uses of Library items.
- **Use**: `{projectId, itemId, qty}` links a Project to a Part, File or Component. `qty` is how many to print or how many are needed; Files ignore it. One item can have Uses in many Projects.
- **Note**: markdown body, always in one Project. Several small notes, not one document, so the user and agents can add without conflicts.
- **Job**: one print of a Part, at `#/jobs` and `#/job/<id>`: which Part, printer, material and settings, with the slicer's time and filament estimate. `outcome` is unset while queued, then `ok` or `failed` (with an optional `note`), set by a person. A printer reporting "finished" is not `ok`: firmware only knows its commands ran.
- **Printer**, **Material**: slicing profiles. Stock presets live in `@brim/core/slicer.ts`; users edit and add their own. A Printer is a profile; with a `serial` it is also that one physical printer. Identical printers are separate Printers (duplicate, then set each serial), so each can be addressed on its own. Serials are unique; "Reset to presets" keeps Printers that have one. A Bambu Printer also names its `bambuModel` (the `bambu_model` that [bambu-printer-mcp](https://dmontgomery40.github.io/bambu-printer-mcp/reference/printer-tools) takes); Brim finds the printer's host and serial by discovery (SSDP); the access code comes from a person, is held only in the Brim server's memory and the MCP's env, and is never stored or sent to the browser.

## Rules

- Digital items are references: using a Part in a Project does not copy it, and editing it changes it everywhere it is used. Duplicate the Part to change it for one Project.
- Physical items are counted: a Project's shortfall for a Component is `qty - onHand`, and the shortfalls across Projects make the shopping list.
- Something Brim prints and edits is a Part; something you buy is a Component; everything else is a File.
- Only Notes belong to a Project. Deleting a Project deletes its Notes and Uses; Library items stay.
- Deleting a Library item deletes its Uses; warn when it has any.
- "Not used in any project" is a Library filter, not a separate place.
- Jobs are history: never delete them in bulk. Removing one Job by hand is fine.
- A Job's run has three separate facts: did the send reach the printer (`dispatch`), what the firmware reported (`run`), and is the part good (`outcome`). Only a person sets `outcome`; `cancelled` is not `failed`.
- A Job is sent once. Printing again makes a new Job; resending after an `unconfirmed` dispatch can print twice.
- Job is process-neutral on purpose; Printer stays "Printer". A second process (laser, CNC) gets its own profile type beside it, not a generic "Machine".

## Status

Built: Part, Entry, Job, Printer, Material, Project, Note, Use (Parts only; `qty` has no UI yet and is always 1), File. Notes are plain text for now. Bambu Printers can be found on the LAN and connected for live status; access codes are re-entered after a server restart.

Storage (`@brim/store`): the dev server keeps everything in SQLite (Kysely on `node:sqlite`) and file bytes in a local bucket named by sha256, both in `.brim/`. A mesh Entry stores its triangles in the bucket and names them by `sha256`. On the first visit the browser's localStorage is imported once. A static build without the server still uses localStorage and drops mesh entries.

Next: Component, plus:

- Entry gets `id`, `at` and `source` (`web` | `mcp`).
- Uses of Files (a File in a Project).
- Job gets the shape below: it names the Entry and the exact file it printed, keeps the printer and spools it used, and copies the run from bambu-printer-mcp. The MCP keeps only its last ten flight records, so Brim is the long-term history.

```ts
Job {
  id, partId, entryId, part            // part title when created
  printerId, printer: {name, bambuModel}
  filaments: [{slot, material, color}] // AMS mapping used
  settings: {layer, infill}, estimate: {seconds, grams} // from the sent file, not our preview
  artifact?: {sha256, plate}           // the .gcode.3mf sent; matches the MCP's record
  createdAt
  dispatch?: {at, recordId, status: 'unconfirmed' | 'accepted' | 'observed-active'}
  run?: {state, startedAt?, endedAt?, problems: Array<string>} // copied when the print ends
  outcome?: 'ok' | 'failed', note?     // a person decides
}
```

Live progress (percent, layer, temperatures) is read from the printer, never stored.

## Open questions

- Bambu printing (in progress, via bambu-printer-mcp; the web app discovers and connects printers and shows live status, but does not print yet): send a Job as `print_3mf` with a slicer-made `.gcode.3mf` rather than our G-code, read status and AMS spools from `counterpart_print_progress` / `get_printer_filaments`, and copy `counterpart_print_record` into the Job's `run` when the print ends. Firmware `finished` does not prove the part printed, so `outcome` stays a person's call.

- MCP edits: change the Part in place (labelled by `source`) or work on a copy?
- Job outcome beyond ok/failed (photos, measurements, camera frames from `counterpart_print_record`). Printed Parts kept as stock ("3 brackets in the drawer") would come from `ok` Jobs.
- Spools: read live from the printer, never stored; a Job keeps the ones it used.
- A Use pinned to one Entry, so a Project can hold an older version of a Part.
- Project parameters and relations between Parts (lid fits box): the next expansion.
- If inventory grows (storage locations, suppliers, reorder levels), it becomes its own Inventory area beside the Library.
