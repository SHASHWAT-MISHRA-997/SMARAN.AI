/**
 * Handing a self-contained piece of work to a second agent.
 *
 * WHY, AND IT IS NOT WHAT IT SOUNDS LIKE
 *
 * The reason is not that two agents are cleverer than one. It is the context
 * window, and it is the most ordinary problem there is.
 *
 * "Find where the login redirect is decided" means reading twenty files to
 * quote three lines. Done in the main conversation, all twenty land in it and
 * stay there for the rest of the run: every later step re-reads them, the
 * actual task drifts further from the model's attention, and on a small model
 * the window fills and the task falls out of it entirely. What looks like the
 * model getting worse as a run goes on usually is not - it is the model being
 * asked to hold a filing cabinet.
 *
 * A second agent reads those twenty files in a conversation nobody keeps, and
 * hands back the three lines. The main run receives an answer instead of a
 * search.
 *
 * SO IT IS FOR LOOKING THINGS UP, MOSTLY
 *
 * Anything whose question is short and whose reading is long: where is this
 * handled, what does this library expect, which of these forty files mention
 * that setting. It can change files - it has the same tools - but a change is
 * the thing the person most wants to watch, and delegating it moves it out of
 * sight. The prompt says as much.
 *
 * ONE LEVEL, AND NOT ONE MORE
 *
 * A delegate cannot delegate. Without that rule the first sub-agent that
 * decides its own task is too big spawns another, which decides the same, and
 * a single question becomes a tree nobody asked for and nobody can stop. The
 * limit is not a performance concern; it is the difference between a feature
 * and a runaway.
 */

import type { AgentEvent } from './loop';

/** What a delegate run needs, without this file knowing how a run works. */
export type Delegator = (task: string) => Promise<string>;

let handler: Delegator | null = null;

/**
 * Registered by the loop before it starts, cleared when it ends.
 *
 * The tool cannot call the loop directly - the loop imports the tools, and
 * making the tools import the loop back is a cycle. So the loop hands in a
 * function and the tool calls that.
 */
export function setDelegator(fn: Delegator | null): void {
    handler = fn;
}

export function canDelegate(): boolean {
    return handler !== null;
}

export async function delegate(task: string): Promise<string> {
    if (!handler) {
        return 'There is no second agent available here - this is already one, '
            + 'and a delegate cannot delegate again. Do this part yourself.';
    }
    if (!task.trim()) {
        return 'A delegated task needs to say what to find out. It starts with no '
            + 'memory of this conversation, so name the files, the words to search '
            + 'for, and what you want back.';
    }
    return handler(task);
}

/** How many steps a delegate gets. Enough to read widely, not enough to wander. */
export const DELEGATE_STEPS = 12;

/**
 * What a delegate is told about itself.
 *
 * It is told it will not be asked anything else, because the failure otherwise
 * is a sub-agent that ends with "let me know if you would like me to look at
 * the other files" - a question to a conversation that has already been thrown
 * away, and an answer the main run cannot use.
 */
export const DELEGATE_SYSTEM =
    'You are a focused sub-agent. You have been given one question by another '
    + 'agent working on a larger task. You know nothing about that task beyond '
    + 'what you have been told, and you will not be asked anything else - this '
    + 'conversation ends with your reply.\n\n'
    + 'So: find the answer with the tools, and reply with the answer itself. '
    + 'Quote the lines and name the files. Do not ask a follow-up question, do '
    + 'not offer to continue, and do not describe what you would do - there is '
    + 'nobody to answer you. If you could not find it, say what you looked at '
    + 'and what was not there, which is a useful answer too.';

/** Fold a delegate's events into the one string the caller gets back. */
export function summarise(events: AgentEvent[], task: string): string {
    let text = '';
    let steps = 0;
    const read: string[] = [];

    for (const event of events) {
        if (event.type === 'done') { text = event.text; steps = event.steps; }
        if (event.type === 'error') { text = text || `It failed: ${event.message}`; }
        if (event.type === 'tool_call' && event.args.path) {
            const path = event.args.path;
            if (!read.includes(path)) read.push(path);
        }
    }

    if (!text) {
        text = 'The sub-agent finished without an answer. Do this part yourself.';
    }

    // What it touched, briefly. Not the contents - putting those back in the
    // main conversation would undo the entire point of delegating.
    const looked = read.length
        ? `\n\n(Looked at ${read.length} file${read.length === 1 ? '' : 's'}: `
          + `${read.slice(0, 8).join(', ')}${read.length > 8 ? ', …' : ''})`
        : '';

    return `Answer to "${task.trim().slice(0, 80)}":\n\n${text}`
        + looked
        + `\n(${steps} step${steps === 1 ? '' : 's'})`;
}
