/**
 * The loop that makes this an agent rather than a chat box.
 *
 *     ask the model
 *       -> it asks for a tool
 *       -> run the tool
 *       -> give it the result
 *       -> ask again
 *     until it stops asking, or the step limit is reached
 *
 * Version 1.5.0 had no arrow going back: it scanned one reply with two regular
 * expressions and stopped, so the model never learned whether the file was
 * written or the test passed. Everything else here is detail; that arrow is
 * the difference.
 *
 * Tool calls are tags in ordinary text rather than a provider's function
 * calling. Every model reachable from here can produce tags - a small one in
 * Ollama, a large one behind a key. Native tool calling would work for some
 * and quietly fail for the rest.
 */

import { decide, Policy } from './modes';
import { Choice, complete, Message } from './models';
import { McpRegistry } from './mcpRegistry';
import { readInstructions } from '../instructions';
import {
    confineToFolder, describeTools, execute, parseTodo, TodoItem, TOOLS,
} from './tools';

/** Not a guess at how much work a task needs — a stop, so a model repeating
 *  itself cannot run forever on somebody's machine. Reaching it is reported. */
export const MAX_STEPS = 24;

const SYSTEM = `You are SMARAN.AI's coding agent, working inside a real folder \
on this machine. You can read and change files and run commands, and you see \
the result of everything you do.

Work like an engineer, not like a chat reply:

- Look before you change. Read the files you are about to edit. Do not assume \
what is in them.
- Make the change with a tool. Writing code into your message is not doing it; \
the person asked for the work, not a description of it.
- Check what you did. Run the tests, run the file, read it back. If something \
failed, the output will say so - fix it and try again.
- Stop when it is actually done, and say what you changed.

To use a tool, emit exactly this and nothing after it in that message:

<tool_call name="read_file">
<path>src/main.py</path>
</tool_call>

One tool per message. You will be given the result and can then continue.

If the task needs more than two steps, call the todo tool first with the \nsteps you intend to take, and call it again as each one is finished. The \nperson watching sees that list; it is how they know what you are doing and \nwhat is left.

%TOOLS%

When the work is complete, reply normally with no tool call, and summarise \
what you changed and what you verified.`;

const PLAN_SYSTEM = `You are SMARAN.AI's coding agent. Before doing anything, \
say what you intend to do.

Give a short numbered plan: which files you will read, what you will change, \
and how you will check it worked. Name real files where you can. Do not write \
the code yet and do not use any tools - this is the plan the person will agree \
to or correct.

Keep it under ten lines.`;

const TOOL_CALL = /<tool_call\s+name=["']([a-z_]+)["']\s*>([\s\S]*?)<\/tool_call>/i;
const ARGUMENT = /<([a-z_]+)>([\s\S]*?)<\/\1>/gi;

/**
 * The other syntax models use to call a tool.
 *
 * The prompt asks for `<tool_call name="…">`, and most models do as they are
 * asked. Some do not: a model fine-tuned on its own calling format emits that
 * format whatever the prompt says. dots-3 replied with
 *
 *     <dots_function_call><invoke name="list_files"></invoke></dots_function_call>
 *
 * which matched nothing here, so it was treated as ordinary prose and the raw
 * XML was printed at the person as the answer. It was never an answer - it was
 * a tool call in a spelling this parser did not know.
 *
 * The wrapper is whatever the model calls it; the part that matters is the
 * `<invoke name="…">` inside, with `<parameter name="…">` arguments. Both are
 * read now, so a model's own habit is understood instead of leaking on screen.
 */
const INVOKE = /<invoke\s+name=["']([A-Za-z0-9_.-]+)["']\s*>([\s\S]*?)<\/invoke>/i;
const NAMED_ARGUMENT = /<parameter\s+name=["']([A-Za-z0-9_.-]+)["']\s*>([\s\S]*?)<\/parameter>/gi;
/** The wrapper some models put around an invoke, so it goes with it. */
const WRAPPER = /<([a-z0-9_]*function_call|tool_use|function_calls)>\s*$/i;

export interface ToolCall {
    name: string;
    args: Record<string, string>;
    raw: string;
}

/**
 * A tool call that started and never finished.
 *
 * The model's reply can be cut off mid-call - it runs into max_tokens, or it
 * simply stops. TOOL_CALL needs the closing tag, so a truncated call does not
 * match, and the whole reply was then treated as ordinary prose: the raw
 * `<tool_call name="read_file"><path>...` was printed at the person as if it
 * were an answer, and the run ended there.
 *
 * It is not an answer. It is a step that did not survive the trip.
 */
export function looksTruncated(text: string): boolean {
    const body = text || '';
    if (/<tool_call\s+name=/i.test(body) && !/<\/tool_call>/i.test(body)) return true;
    return /<invoke\s+name=/i.test(body) && !/<\/invoke>/i.test(body);
}

/** Where a tool call starts, in either spelling, or -1. */
function callStarts(text: string): number {
    const starts = [
        (text || '').search(/<tool_call\s+name=/i),
        (text || '').search(/<(?:[a-z0-9_]*function_call|function_calls|tool_use)>/i),
        (text || '').search(/<invoke\s+name=/i),
    ].filter((at) => at >= 0);
    return starts.length ? Math.min(...starts) : -1;
}

/** Whatever the model said before it started calling a tool. */
export function proseBefore(text: string): string {
    const start = callStarts(text);
    return (start >= 0 ? text.slice(0, start) : text || '').trim();
}

/** Argument values: code must survive exactly, a path must not keep a newline. */
function keep(key: string, value: string): string {
    return key === 'content' ? value : value.trim();
}

export function parseToolCall(text: string): ToolCall | undefined {
    const body = text || '';
    const match = TOOL_CALL.exec(body);
    if (match) {
        const args: Record<string, string> = {};
        ARGUMENT.lastIndex = 0;
        let found = ARGUMENT.exec(match[2]);
        while (found) {
            const key = found[1].toLowerCase();
            args[key] = keep(key, found[2]);
            found = ARGUMENT.exec(match[2]);
        }
        return { name: match[1].toLowerCase(), args, raw: match[0] };
    }

    const invoked = INVOKE.exec(body);
    if (!invoked) {
        return undefined;
    }

    const args: Record<string, string> = {};
    NAMED_ARGUMENT.lastIndex = 0;
    let named = NAMED_ARGUMENT.exec(invoked[2]);
    while (named) {
        const key = named[1].toLowerCase();
        args[key] = keep(key, named[2]);
        named = NAMED_ARGUMENT.exec(invoked[2]);
    }
    // Some write <path>…</path> inside the invoke instead. Read those too,
    // but never over a <parameter> of the same name, which is the explicit one.
    ARGUMENT.lastIndex = 0;
    let plain = ARGUMENT.exec(invoked[2]);
    while (plain) {
        const key = plain[1].toLowerCase();
        if (key !== 'parameter' && !(key in args)) {
            args[key] = keep(key, plain[2]);
        }
        plain = ARGUMENT.exec(invoked[2]);
    }

    /* The wrapper, if there is one, is part of the call and not part of what
       the model said - otherwise `<dots_function_call>` is left behind on
       screen as the prose before the call. */
    const at = body.indexOf(invoked[0]);
    const before = body.slice(0, at);
    const wrapper = WRAPPER.exec(before.trimEnd());
    let raw = invoked[0];
    if (wrapper) {
        const from = before.trimEnd().length - wrapper[0].length;
        const closing = new RegExp(`^\\s*</${wrapper[1]}>`, 'i')
            .exec(body.slice(at + invoked[0].length));
        raw = body.slice(from, at + invoked[0].length + (closing ? closing[0].length : 0));
    }

    return { name: invoked[1].toLowerCase(), args, raw };
}

export type AgentEvent =
    | { type: 'workspace'; root: string }
    | { type: 'message'; text: string }
    /* Said before every request to the model. Without it the panel sat still
       for the whole wait, which on a slow free model is most of the run. */
    | { type: 'thinking'; step: number }
    | { type: 'note'; text: string }
    | { type: 'tool_call'; name: string; args: Record<string, string>; step: number }
    | { type: 'tool_result'; name: string; result: string; step: number }
    /* The step list, as the model last published it. Sent as its own
       event rather than as a tool result, because the panel replaces
       the list in place instead of adding another copy of it. */
    | { type: 'todo'; items: TodoItem[] }
    | { type: 'refused'; name: string; because: string; step: number }
    | { type: 'done'; steps: number; toolsUsed: string[]; text: string }
    | { type: 'error'; message: string };

/** Asked before anything that changes something, when the mode says to ask. */
export type Approver = (
    call: ToolCall,
    because: string | undefined,
) => Promise<boolean>;

/**
 * What is answering, in its own words.
 *
 * Asked "which model are you using?", the agent said GPT-4. It is not, and it
 * had no way to know - nothing in the prompt told it, so it guessed from what
 * models generally say about themselves. Anyone asking that question is asking
 * because the answer matters to them, and a confident wrong one is worse than
 * no feature at all. It is told now, and repeats what it is told.
 */
export function identify(choice: Choice): string {
    const where = choice.provider
        ? `the ${choice.provider} API`
        : 'Ollama, on this machine';
    return `

You are running as the model "${choice.model}", served by `
        + `${where}. If you are asked which model you are, say exactly that and `
        + `nothing more - do not guess a name from your training.`;
}

export async function plan(task: string, choice: Choice): Promise<string> {
    return complete(
        [
            { role: 'system', content: PLAN_SYSTEM + identify(choice) },
            { role: 'user', content: task },
        ],
        choice,
    );
}

export async function* run(
    task: string,
    root: string,
    history: Message[],
    choice: Choice,
    stopped: () => boolean,
    policy: Policy,
    approve: Approver,
    /* Optional, so every existing caller and test keeps working and the agent
       behaves exactly as before when no server is configured. */
    mcp?: McpRegistry,
    /* Pictures attached to this turn. They ride on the first user message and
       nowhere else: repeating them on every step would resend the same
       megabytes for every tool call. */
    images?: { data: string; mime: string }[],
): AsyncGenerator<AgentEvent> {
    const preamble = policy.reach === 'read'
        // Told, as well as enforced. Refusing a write the model did not know
        // was forbidden wastes a step; refusing one it was warned about is a
        // backstop rather than the mechanism.
        ? '\n\nYou are in Plan mode. You may read and search, but you cannot change '
          + 'any file or run any command - those tools will refuse. Look at the real '
          + 'code, then say what you would change, in which files, and how you would '
          + 'check it.'
        : '';

    /* Tools from MCP servers are listed alongside the built-in ones, in the
       same shape, so the model has nothing new to learn. They are named
       mcp_<server>_<tool> so two servers offering `search` stay distinct. */
    const extra = mcp?.describe() || '';
    const toolList = extra
        ? `${describeTools()}

From connected MCP servers:
${extra}`
        : describeTools();

    /* What the project itself says. Read here rather than passed in, so it is
       whatever is on disk at the moment the run starts - somebody who corrects
       these instructions because the agent got something wrong expects the
       next run to know, not the next window. */
    const house = readInstructions(root);
    if (house.from.length) {
        yield { type: 'note', text: `Following ${house.from.join(' and ')}` };
    }

    const messages: Message[] = [
        {
            role: 'system',
            content: SYSTEM.replace('%TOOLS%', toolList) + preamble + identify(choice)
                + (house.text ? `\n\n${house.text}` : ''),
        },
        ...history,
        { role: 'user', content: task, images: images?.length ? images : undefined },
    ];

    // What was actually done, so a claim of completion can be checked against
    // it. A small model will write one file and announce it wrote three.
    const performed: string[] = [];

    /* The reach dial, applied where the paths are resolved. Set per run, so
       changing it takes effect on the next question rather than on the next
       window. */
    confineToFolder(policy.reach !== 'full');

    yield { type: 'workspace', root };

    for (let step = 1; step <= MAX_STEPS; step += 1) {
        if (stopped()) {
            return;
        }

        yield { type: 'thinking', step };

        let reply: string;
        try {
            reply = await complete(messages, choice);
        } catch (error) {
            yield { type: 'error', message: (error as Error).message };
            return;
        }

        if (stopped()) {
            return;
        }

        const call = parseToolCall(reply);
        if (!call) {
            /* Cut off mid-call. Ask for it again rather than printing the
               half-written tag and stopping - the person did not ask for XML,
               and the work was not finished. */
            /* Either it stopped mid-call, or it called in a spelling that
               could not be read. Both look the same from here and both have
               the same answer: show what it said in words, keep the XML off
               the screen, and ask for the call again in the one form this
               understands. What must never happen is the tag itself being
               printed as though it were the reply. */
            if (looksTruncated(reply) || callStarts(reply) >= 0) {
                const said = proseBefore(reply);
                if (said) yield { type: 'message', text: said };
                yield {
                    type: 'note',
                    text: 'That tool call did not arrive in a form it could run. Asking again.',
                };
                messages.push({ role: 'assistant', content: reply });
                messages.push({
                    role: 'user',
                    content: 'That tool call could not be run - it was either cut off or '
                        + 'written in another format. Send exactly one call, in this form '
                        + 'and no other, with nothing after it:\n\n'
                        + '<tool_call name="read_file">\n<path>src/main.py</path>\n'
                        + '</tool_call>',
                });
                continue;
            }
            yield { type: 'message', text: reply };
            yield { type: 'done', steps: step, toolsUsed: performed, text: reply };
            return;
        }

        const spoken = reply.slice(0, reply.indexOf(call.raw)).trim();
        if (spoken) {
            yield { type: 'message', text: spoken };
        }

        yield { type: 'tool_call', name: call.name, args: call.args, step };

        // The mode is applied here, where the tool would run, rather than left
        // to the model to respect.
        const decision = decide(policy, call.name, call.args);
        let result: string;

        if (decision.act === 'refuse') {
            yield { type: 'refused', name: call.name, because: decision.because, step };
            result = decision.because;
        } else if (decision.act === 'ask' && !(await approve(call, decision.because))) {
            const declined = 'The person declined that. Do not repeat it - either '
                + 'do the work another way, or stop and say what you would have done.';
            yield { type: 'refused', name: call.name, because: 'You said no.', step };
            result = declined;
        } else {
            if (stopped()) {
                return;
            }
            result = mcp?.has(call.name)
                ? await mcp.call(call.name, call.args)
                : await execute(call.name, call.args, root);
            performed.push(call.name);
            if (call.name === 'todo') {
                // The list itself, for the panel to draw in place. The result
                // still goes to the model in the normal way below.
                const items = parseTodo(call.args.items);
                if (items.length) {
                    yield { type: 'todo', items };
                }
            }
            yield { type: 'tool_result', name: call.name, result, step };
        }

        // The arrow back. Without these two lines this is 1.5.0 again.
        messages.push({ role: 'assistant', content: reply });
        messages.push({ role: 'user', content: `Result of ${call.name}:\n${result}` });
    }

    yield {
        type: 'error',
        message: `Stopped after ${MAX_STEPS} steps without finishing. The work so far has been done; ask again to carry on.`,
    };
}

/** Whether a tool changes anything, for callers that treat those differently. */
export const changesThings = (name: string): boolean => Boolean(TOOLS[name]?.changes);
