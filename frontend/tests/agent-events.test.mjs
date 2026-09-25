import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAgentEvent, summarize } from '../src/utils/agentEvents.js';

test('a tool call becomes a running step, then done with its result', () => {
  let steps = applyAgentEvent([], { type: 'tool_call', step: 1, name: 'read_file', arguments: { path: 'a.js' } });
  assert.equal(steps[0].status, 'running');
  steps = applyAgentEvent(steps, { type: 'tool_result', step: 1, result: '1 | x' });
  assert.deepEqual([steps[0].status, steps[0].result], ['done', '1 | x']);
});

test('a change waits for approval and a refusal stays refused', () => {
  let steps = applyAgentEvent([], { type: 'tool_call', step: 2, name: 'write_file', arguments: { path: 'b.js' } });
  steps = applyAgentEvent(steps, { type: 'approval_needed', step: 2 });
  assert.equal(steps[0].status, 'waiting');
  steps = applyAgentEvent(steps, { type: 'approval', step: 2, approved: false });
  steps = applyAgentEvent(steps, { type: 'tool_result', step: 2, result: 'declined' });
  assert.equal(steps[0].status, 'declined');
});

test('an allowed change runs', () => {
  let steps = applyAgentEvent([], { type: 'tool_call', step: 3, name: 'run_command', arguments: { command: 'npm test' } });
  steps = applyAgentEvent(steps, { type: 'approval_needed', step: 3 });
  steps = applyAgentEvent(steps, { type: 'approval', step: 3, approved: true });
  assert.equal(steps[0].status, 'running');
});

test('steps read as plain actions', () => {
  assert.equal(summarize('edit_file', { path: 'src/app.js' }), 'Edit src/app.js');
  assert.equal(summarize('run_command', { command: 'npm test' }), 'Run npm test');
  assert.equal(summarize('git', { subcommand: 'status' }), 'git status');
});

test('a refusal keeps its reason', () => {
  let steps = applyAgentEvent([], { type: 'tool_call', step: 4, name: 'run_command', arguments: { command: 'format c:' } });
  steps = applyAgentEvent(steps, { type: 'approval', step: 4, approved: false, reason: 'Refused in every mode: this formats a drive.' });
  assert.equal(steps[0].status, 'declined');
  assert.equal(steps[0].refused, true);
  assert.match(steps[0].reason, /formats a drive/);
});
