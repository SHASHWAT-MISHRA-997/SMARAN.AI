/**
 * Reading the words out of a .docx, .pptx or .xlsx.
 *
 * Opened as UTF-8 these are a page of binary, and that is what used to be
 * attached: a document dragged in arrived as replacement characters and the
 * model was asked to make sense of it.
 *
 * They are all zip archives of XML. The text lives in known parts inside the
 * archive, so the words can be reached without a document library - which
 * matters here, because this extension ships with no runtime dependencies and
 * adding one for this would be the larger change.
 *
 * The zip reader below is deliberately small and only does what these files
 * need: stored and deflated entries, read through the central directory. It is
 * not a general archive tool.
 *
 * What this is not: a converter. Tables lose their shape, images are skipped,
 * and a spreadsheet becomes its cell values in order. The caller says so when
 * it attaches the text, because a flattened document read as the whole truth
 * is how a model ends up confidently describing a layout that is not there.
 *
 * PDF is not here. Its text is a stream of positioned glyphs, usually
 * compressed, and pulling it out properly needs a real parser. Something that
 * looks like text and is not would be worse than saying no.
 */

import * as zlib from 'zlib';

/** One file inside the archive. */
interface Entry {
    name: string;
    data: Buffer;
}

/**
 * Read a zip through its central directory.
 *
 * The directory is authoritative: local headers can carry a zero size with the
 * real one in a trailing descriptor, and following those would mean guessing
 * where each entry ends.
 */
export function readZip(buffer: Buffer): Entry[] {
    // End of central directory: signature, then the offset of the directory.
    const END = 0x06054b50;
    let end = -1;
    for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 66000; i -= 1) {
        if (buffer.readUInt32LE(i) === END) { end = i; break; }
    }
    if (end < 0) throw new Error('not a zip file');

    const count = buffer.readUInt16LE(end + 10);
    let at = buffer.readUInt32LE(end + 16);
    const entries: Entry[] = [];

    for (let n = 0; n < count; n += 1) {
        if (buffer.readUInt32LE(at) !== 0x02014b50) break;
        const method = buffer.readUInt16LE(at + 10);
        const compressed = buffer.readUInt32LE(at + 20);
        const nameLength = buffer.readUInt16LE(at + 28);
        const extraLength = buffer.readUInt16LE(at + 30);
        const commentLength = buffer.readUInt16LE(at + 32);
        const localAt = buffer.readUInt32LE(at + 42);
        const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);

        // The local header's own name and extra lengths give the data start.
        const localNameLength = buffer.readUInt16LE(localAt + 26);
        const localExtraLength = buffer.readUInt16LE(localAt + 28);
        const from = localAt + 30 + localNameLength + localExtraLength;
        const raw = buffer.subarray(from, from + compressed);

        try {
            entries.push({
                name,
                data: method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw),
            });
        } catch {
            // One unreadable part should not lose the rest of the document.
        }

        at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

/** The text nodes of an Office XML part, in document order. */
function textFromXml(xml: string): string {
    // <w:t>, <a:t> and <t> are the text nodes in Word, PowerPoint and Excel.
    const pieces: string[] = [];
    const matcher = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g;
    let found = matcher.exec(xml);
    while (found) {
        pieces.push(found[1]);
        found = matcher.exec(xml);
    }
    return pieces
        .join(' ')
        // The five XML entities, and nothing invented beyond them.
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Which parts of the archive hold the words, per format. */
const PARTS: Record<string, RegExp> = {
    '.docx': /^word\/(document|footnotes|endnotes|header\d*|footer\d*)\.xml$/,
    '.pptx': /^ppt\/slides\/slide\d+\.xml$/,
    '.xlsx': /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/,
};

export const isOfficeFile = (extension: string): boolean =>
    Object.prototype.hasOwnProperty.call(PARTS, extension.toLowerCase());

/**
 * The readable text of an Office file, or an empty string if there is none.
 *
 * Slides and sheets are separated and labelled, because "slide 4 says" is a
 * thing somebody asks and an unlabelled run of words cannot answer it.
 */
export function officeText(extension: string, buffer: Buffer): string {
    const wanted = PARTS[extension.toLowerCase()];
    if (!wanted) return '';

    /* A file that is not the archive it claims to be - truncated in transit,
       renamed by hand - returns nothing rather than throwing. The caller is
       attaching a file somebody chose; it should say the file has no readable
       text in it, not fall over. */
    let all: Entry[];
    try {
        all = readZip(buffer);
    } catch {
        return '';
    }

    const parts = all
        .filter((entry) => wanted.test(entry.name))
        // slide2 before slide10, sheet2 before sheet10.
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const chunks: string[] = [];
    for (const part of parts) {
        const text = textFromXml(part.data.toString('utf8'));
        if (!text) continue;
        const slide = /slide(\d+)\.xml$/.exec(part.name);
        const sheet = /sheet(\d+)\.xml$/.exec(part.name);
        if (slide) chunks.push(`[slide ${slide[1]}] ${text}`);
        else if (sheet) chunks.push(`[sheet ${sheet[1]}] ${text}`);
        else chunks.push(text);
    }
    return chunks.join('\n\n');
}
