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

- **Library**: every Part, File and Component, whether or not any Project uses it. It lists definitions, not physical copies.
- **Part**: the one printable, editable object. Digital. Its `history` is a list of Entries, each a full snapshot. The last Entry is the current state; undo pops it, restore appends a copy of an earlier one.
- **Entry**: `{prompt, changes, model}`. `model` is the geometry: `param` (a `Spec`, rebuilt on demand) or `mesh` (triangles; imports and anything after a boolean op).
- **Model**: the geometry type in `@brim/core/model.ts`. Not a user-facing term; the UI says "part".
- **File**: reference material kept as uploaded (photos, PDFs, datasheets, someone else's STL or 3MF). Digital. "Make part from file" creates a Part from a mesh file (STL, 3MF, OBJ) and leaves the File as the original.
- **Component**: something you buy rather than print (screws, magnets, bearings, a board): name, optional link and notes, and `onHand`, the count you have. Physical. It has no history; a different spec is a different Component.
- **Project**: a name, its Notes, and Uses of Library items.
- **Use**: `{projectId, itemId, qty}` links a Project to a Part, File or Component. `qty` is how many to print or how many are needed; Files ignore it. One item can have Uses in many Projects.
- **Note**: markdown body, always in one Project. Several small notes, not one document, so the user and agents can add without conflicts.
- **Job**: a print queue entry: which Part, printer, material and settings, with the slicer's time and filament estimate.
- **Printer**, **Material**: slicing profiles. Stock presets live in `@brim/core/slicer.ts`; users edit and add their own. A Printer is a profile, not a physical device.

## Rules

- Digital items are references: using a Part in a Project does not copy it, and editing it changes it everywhere it is used. Duplicate the Part to change it for one Project.
- Physical items are counted: a Project's shortfall for a Component is `qty - onHand`, and the shortfalls across Projects make the shopping list.
- Something Brim prints and edits is a Part; something you buy is a Component; everything else is a File.
- Only Notes belong to a Project. Deleting a Project deletes its Notes and Uses; Library items stay.
- Deleting a Library item deletes its Uses; warn when it has any.
- "Not used in any project" is a Library filter, not a separate place.
- Job is process-neutral on purpose; Printer stays "Printer". A second process (laser, CNC) gets its own profile type beside it, not a generic "Machine".

## Status

Built (browser storage): Part, Entry, Job, Printer, Material, Project, Note, Use (Parts only; `qty` has no UI yet and is always 1). Notes are plain text for now.

Next: Component. Planned with the backend: File, plus:

- Entry gets `id`, `at` and `source` (`web` | `mcp`).
- Mesh positions move to a hash-addressed blob store; today mesh entries are dropped on save.
- Job references `entryId` and stores the printer and material it used, not only their names.

## Open questions

- MCP edits: change the Part in place (labelled by `source`) or work on a copy?
- Job outcome (success or failure, photos, measurements): add now or later? Printed Parts kept as stock ("3 brackets in the drawer") would come from here.
- A Use pinned to one Entry, so a Project can hold an older version of a Part.
- Project parameters and relations between Parts (lid fits box): the next expansion.
- If inventory grows (storage locations, suppliers, reorder levels), it becomes its own Inventory area beside the Library.
