/* SMARAN Code's streamed events, folded into what the page shows.
 * Kept apart from AgentSteps.jsx so it can be tested without a DOM. */

export function summarize(name, args = {}) {
  switch (name) {
    case 'read_file': return `Read ${args.path || ''}`;
    case 'write_file': return `Write ${args.path || ''}`;
    case 'edit_file': return `Edit ${args.path || ''}`;
    case 'run_command': return `Run ${args.command || ''}`;
    case 'git': return `git ${args.subcommand || ''}`;
    case 'search': return `Search for "${args.query || ''}"`;
    case 'list_files': return `List ${args.path || 'the folder'}`;
    case 'snapshot': return 'Save a checkpoint';
    case 'restore_snapshot': return `Restore checkpoint ${args.snapshot_id || ''}`;
    default: return name.replace(/_/g, ' ');
  }
}

/** Fold one streamed agent event into the step list. Pure, for testing. */
export function applyAgentEvent(steps, event) {
  const list = steps.slice();
  const at = (step) => list.findIndex((s) => s.step === step);
  if (event.type === 'tool_call') {
    list.push({ step: event.step, name: event.name, arguments: event.arguments || {}, result: null, status: 'running' });
  } else if (event.type === 'approval_needed') {
    const i = at(event.step);
    if (i >= 0) list[i] = { ...list[i], status: 'waiting', reason: event.reason || '' };
  } else if (event.type === 'approval') {
    const i = at(event.step);
    if (i >= 0) {
      list[i] = {
        ...list[i],
        status: event.approved ? 'running' : 'declined',
        reason: event.reason || list[i].reason || '',
        refused: Boolean(event.reason && !event.approved),
      };
    }
  } else if (event.type === 'tool_result') {
    const i = at(event.step);
    if (i >= 0) list[i] = { ...list[i], result: event.result, status: list[i].status === 'declined' ? 'declined' : 'done' };
  }
  return list;
}
