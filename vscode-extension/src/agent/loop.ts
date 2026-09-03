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

import { decide, ModeId } from './modes';
import { Choice, complete, Message } from './models';
import { McpRegistry } from './mcpRegistry';
import { describeTools, execute, TOOLS } from './tools';

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
    return /<tool_call\s+name=/i.test(text || '') && !/<\/tool_call>/i.test(text || '');
}

/** Whatever the model said before it started calling a tool. */
export function proseBefore(text: string): string {
    const start = (text || '').search(/<tool_call\s+name=/i);
    return (start >= 0 ? text.slice(0, start) : text || '').trim();
}

export function parseToolCall(text: string): ToolCall | undefined {
    const match = TOOL_CALL.exec(text || '');
    if (!match) {
        return undefined;
    }
    const args: Record<string, string> = {};
    ARGUMENT.lastIndex = 0;
    let found = ARGUMENT.exec(match[2]);
    while (found) {
        // Content is code and must survive exactly. Everything else is a path
        // or a command, where a stray newline is the model's formatting rather
        // than part of the value.
        const key = found[1].toLowerCase();
        args[key] = key === 'content' ? found[2] : found[2].trim();
        found = ARGUMENT.exec(match[2]);
    }
    return { name: match[1].toLowerCase(), args, raw: match[0] };
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
    mode: ModeId,
    approve: Approver,
    /* Optional, so every existing caller and test keeps working and the agent
       behaves exactly as before when no server is configured. */
    mcp?: McpRegistry,
    /* Pictures attached to this turn. They ride on the first user message and
       nowhere else: repeating them on every step would resend the same
       megabytes for every tool call. */
    images?: { data: string; mime: string }[],
): AsyncGenerator<AgentEvent> {
    const preamble = mode === 'plan'
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

    const messages: Message[] = [
        {
            role: 'system',
            content: SYSTEM.replace('%TOOLS%', toolList) + preamble + identify(choice),
        },
        ...history,
        { role: 'user', content: task, images: images?.length ? images : undefined },
    ];

    // What was actually done, so a claim of completion can be checked against
    // it. A small model will write one file and announce it wrote three.
    const performed: string[] = [];

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
            if (looksTruncated(reply)) {
                const said = proseBefore(reply);
                if (said) yield { type: 'message', text: said };
                yield {
                    type: 'note',
                    text: 'That tool call was cut off before it finished. Asking again.',
                };
                messages.push({ role: 'assistant', content: reply });
                messages.push({
                    role: 'user',
                    content: 'Your last message ended in the middle of a tool call, so it '
                        + 'could not be run. Send that one tool call again, complete, with '
                        + 'its closing </tool_call> tag and nothing after it.',
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
        const decision = decide(mode, call.name, call.args);
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
