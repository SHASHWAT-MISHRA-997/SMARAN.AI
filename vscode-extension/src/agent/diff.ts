/**
 * What actually changed in a file, in the form everybody already reads.
 *
 * The agent used to report its edits as
 *
 *     Wrote src/panel.ts (412 lines).
 *
 * which says a file was touched and nothing about what happened to it. You
 * could not tell a one-character fix from a rewrite, and the only way to find
 * out was to open the file and compare it against a version you no longer had.
 * Trusting an agent with your files means being able to see what it did, and
 * that means a diff.
 *
 * WHY NOT A LIBRARY
 *
 * A line diff is small and this needs no dependency. What it does need is to
 * stay fast on a large file, which is the part that goes wrong: the textbook
 * longest-common-subsequence table is O(n*m), and two four-thousand-line
 * versions of a file would be sixteen million cells for a change of one line.
 *
 * So the common start and end are cut away first. Almost every edit is small
 * and local, which leaves a handful of lines to compare properly - and when it
 * does not, the table is refused rather than built, and a summary is given
 * instead. A panel that freezes is worse than a panel that says "this was a
 * large rewrite".
 */

/** Lines either side of a change, the way every diff tool shows it. */
const CONTEXT = 3;

/** Past this, on either side of the change, the table is not worth building. */
const MAX_COMPARED = 600;

/** Past this, the diff is trimmed: a rewrite should not fill the transcript. */
const MAX_OUTPUT_LINES = 80;

export interface Change {
    kind: 'same' | 'add' | 'remove';
    text: string;
}

/**
 * The changed lines between two versions.
 *
 * Exported on its own because it is the part worth testing: the formatting
 * around it is decoration, and this is where a wrong answer would hide.
 */
export function compare(before: string[], after: string[]): Change[] | null {
    // Cut the identical start and end away. This is what keeps a one-line
    // change in a long file cheap.
    let head = 0;
    while (head < before.length && head < after.length && before[head] === after[head]) {
        head += 1;
    }
    let tail = 0;
    while (
        tail < before.length - head
        && tail < after.length - head
        && before[before.length - 1 - tail] === after[after.length - 1 - tail]
    ) {
        tail += 1;
    }

    const oldMiddle = before.slice(head, before.length - tail);
    const newMiddle = after.slice(head, after.length - tail);

    if (oldMiddle.length > MAX_COMPARED || newMiddle.length > MAX_COMPARED) {
        return null;   // Too large to line up honestly. The caller summarises.
    }

    // Longest common subsequence over what is left.
    const rows = oldMiddle.length;
    const cols = newMiddle.length;
    const table: number[][] = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
    for (let i = rows - 1; i >= 0; i -= 1) {
        for (let j = cols - 1; j >= 0; j -= 1) {
            table[i][j] = oldMiddle[i] === newMiddle[j]
                ? table[i + 1][j + 1] + 1
                : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }

    const changes: Change[] = [];
    for (const text of before.slice(0, head)) changes.push({ kind: 'same', text });

    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
        if (oldMiddle[i] === newMiddle[j]) {
            changes.push({ kind: 'same', text: oldMiddle[i] });
            i += 1;
            j += 1;
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            changes.push({ kind: 'remove', text: oldMiddle[i] });
            i += 1;
        } else {
            changes.push({ kind: 'add', text: newMiddle[j] });
            j += 1;
        }
    }
    while (i < rows) { changes.push({ kind: 'remove', text: oldMiddle[i] }); i += 1; }
    while (j < cols) { changes.push({ kind: 'add', text: newMiddle[j] }); j += 1; }

    for (const text of before.slice(before.length - tail)) changes.push({ kind: 'same', text });
    return changes;
}

function splitLines(text: string): string[] {
    // A trailing newline is not a line. Without this, every file that ends
    // properly showed a phantom empty line at the bottom of every diff.
    const lines = text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
}

/**
 * A diff a person can read, with a line of summary at the top.
 *
 * Returns an empty string when the two versions are identical, so a caller
 * can say "no change" rather than printing an empty diff - which happens more
 * often than it sounds, because a model asked to fix something sometimes
 * writes back exactly what was there.
 */
export function unified(beforeText: string, afterText: string, label: string): string {
    if (beforeText === afterText) return '';

    const before = splitLines(beforeText);
    const after = splitLines(afterText);
    const changes = compare(before, after);

    if (!changes) {
        return `${label}: rewritten. ${before.length} lines replaced with ${after.length}, `
            + 'which is too large a change to line up usefully - open the file to read it.';
    }

    const added = changes.filter((c) => c.kind === 'add').length;
    const removed = changes.filter((c) => c.kind === 'remove').length;

    // Only the parts that changed, with a few lines either side. A whole file
    // printed to show one altered line is the thing that makes diffs unread.
    const keep = new Array(changes.length).fill(false);
    changes.forEach((change, index) => {
        if (change.kind === 'same') return;
        for (let k = Math.max(0, index - CONTEXT); k <= Math.min(changes.length - 1, index + CONTEXT); k += 1) {
            keep[k] = true;
        }
    });

    const out: string[] = [`${label}: +${added} -${removed}`];
    if (beforeText.endsWith('\n') !== afterText.endsWith('\n')) {
        out.push(afterText.endsWith('\n') ? 'Final newline added.' : 'Final newline removed.');
    }
    let skipped = 0;
    let printed = 0;
    let truncated = false;

    for (let index = 0; index < changes.length; index += 1) {
        if (!keep[index]) { skipped += 1; continue; }
        if (skipped) {
            out.push(`   … ${skipped} unchanged line${skipped === 1 ? '' : 's'}`);
            skipped = 0;
        }
        if (printed >= MAX_OUTPUT_LINES) { truncated = true; break; }
        const change = changes[index];
        const mark = change.kind === 'add' ? '+' : change.kind === 'remove' ? '-' : ' ';
        out.push(`${mark} ${change.text}`);
        printed += 1;
    }

    if (truncated) {
        out.push('   … the rest of the diff was left out; open the file to read it all.');
    }
    return out.join('\n');
}
