# Brim domain

The shared vocabulary for the web app, the HTTP API and the MCP tools. Use these names in code, storage and tool names.

```
Library
 ├── Project ─┬─ Part    printable thing with history
 │            ├─ Note    markdown, written by the user or an agent
 │            └─ File    reference material, kept as-is
 └── loose Parts        one-offs, no project needed
Part ── Entry           one step: prompt, changes, model
Job                     a part at one entry, sent to a printer with a material
Printer · Material      profiles
```

## Terms

- **Part**: the one printable, editable object; what the Library lists today. Its `history` is a list of Entries, each a full snapshot. The last Entry is the current state; undo pops it, restore appends a copy of an earlier one. A Part belongs to at most one Project (`projectId`, nullable). Duplicate a Part to use it in two Projects.
- **Entry**: `{prompt, changes, model}`. `model` is the geometry: `param` (a `Spec`, rebuilt on demand) or `mesh` (triangles; imports and anything after a boolean op).
- **Model**: the geometry type in `@brim/core/model.ts`. Not a user-facing term; the UI says "part".
- **Project**: optional grouping with a name. Holds Parts, Notes and Files.
- **Note**: markdown body, always in a Project. Several small notes, not one document, so the user and agents can add without conflicts.
- **File**: reference material kept as uploaded (photos, PDFs, someone else's STL), always in a Project. "Make part from file" creates a Part from an STL and leaves the File as the original.
- **Job**: a print queue entry: which Part, printer, material and settings, with the slicer's time and filament estimate.
- **Printer**, **Material**: slicing profiles. Stock presets live in `@brim/core/slicer.ts`; users edit and add their own. A Printer is a profile, not a physical device.

## Rules

- Only Parts can be loose. Notes and Files always belong to a Project.
- Something Brim prints and edits is a Part; everything else is a File.
- Deleting a Project makes its Parts loose and deletes its Notes and Files.
- Job is process-neutral on purpose; Printer stays "Printer". A second process (laser, CNC) gets its own profile type beside it, not a generic "Machine".

## Status

Built (browser storage): Part, Entry, Job, Printer, Material, Project, Note. Notes are plain text for now. Planned with the backend: File, plus:

- Entry gets `id`, `at` and `source` (`web` | `mcp`).
- Mesh positions move to a hash-addressed blob store; today mesh entries are dropped on save.
- Job references `entryId` and stores the printer and material it used, not only their names.

## Open questions

- MCP edits: change the Part in place (labelled by `source`) or work on a copy?
- Job outcome (success or failure, photos, measurements): add now or later?
- Project parameters and relations between Parts (lid fits box): the next expansion.
