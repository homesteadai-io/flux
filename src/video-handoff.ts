export function handoffForVisibleNote(
  handoff: FluxVideoHandoff | null,
  note: Pick<FluxNoteSummary, 'id' | 'folder'> | null
) {
  if (
    !handoff ||
    !note ||
    handoff.sourceNote.noteId !== note.id ||
    handoff.sourceNote.folder !== note.folder
  ) {
    return null;
  }
  return handoff;
}
