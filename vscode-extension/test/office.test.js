/**
 * Reading the words out of an Office file.
 *
 * A .docx opened as UTF-8 is a page of binary, and that is what used to be
 * attached. These are built here as real archives - zip of XML, the shape the
 * formats actually have - so the reader is tested against the thing rather
 * than against a description of it.
 */
const assert = require('assert');
const zlib = require('zlib');

const { officeText, isOfficeFile, readZip } = require('../out/office.js');

/** A minimal but genuine zip: local headers, central directory, EOCD. */
function makeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(text, 'utf8');
    const deflated = zlib.deflateRawSync(raw);
    const crc = require('zlib').crc32
      ? require('zlib').crc32(raw)
      : 0; // the reader does not check it

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);            // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(Buffer.concat([local, nameBuf, deflated]));

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([dir, nameBuf]));

    offset += 30 + nameBuf.length + deflated.length;
  }

  const body = Buffer.concat(locals);
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, directory, eocd]);
}

let passed = 0;
const ok = (name) => { console.log('  ok  ' + name); passed += 1; };

assert.ok(isOfficeFile('.docx') && isOfficeFile('.PPTX') && isOfficeFile('.xlsx'));
assert.ok(!isOfficeFile('.pdf') && !isOfficeFile('.png') && !isOfficeFile('.txt'));
ok('the three zip formats are recognised, and pdf is not claimed');

const docx = makeZip({
  '[Content_Types].xml': '<Types/>',
  'word/document.xml':
    '<w:document><w:body><w:p><w:r><w:t>Quarterly report</w:t></w:r>'
    + '<w:r><w:t xml:space="preserve"> for R&amp;D</w:t></w:r></w:p></w:body></w:document>',
});
const fromDocx = officeText('.docx', docx);
assert.ok(fromDocx.includes('Quarterly report'), fromDocx);
assert.ok(fromDocx.includes('R&D'), 'the entity should be decoded: ' + fromDocx);
assert.ok(!fromDocx.includes('<w:t>'), 'no markup should survive');
ok('a .docx gives up its words, entities decoded and markup gone');

const pptx = makeZip({
  'ppt/slides/slide10.xml': '<p:sld><a:t>Tenth slide</a:t></p:sld>',
  'ppt/slides/slide2.xml': '<p:sld><a:t>Second slide</a:t></p:sld>',
});
const fromPptx = officeText('.pptx', pptx);
assert.ok(fromPptx.indexOf('[slide 2] Second slide') < fromPptx.indexOf('[slide 10] Tenth slide'),
  'slide 2 must come before slide 10: ' + fromPptx);
ok('slides are labelled and ordered 2 before 10, not by string');

const xlsx = makeZip({
  'xl/sharedStrings.xml': '<sst><si><t>Revenue</t></si><si><t>Q3</t></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><t>1200</t></worksheet>',
});
const fromXlsx = officeText('.xlsx', xlsx);
assert.ok(fromXlsx.includes('Revenue') && fromXlsx.includes('1200'), fromXlsx);
ok('a spreadsheet gives its strings and its cell values');

// A part whose compressed bytes will not inflate must not take the rest with
// it, and must not throw.
const twoParts = makeZip({
  'word/document.xml': '<w:t>Kept</w:t>',
  'word/footnotes.xml': '<w:t>Also kept</w:t>',
});
const damaged = Buffer.from(twoParts);
// Corrupt inside the first entry's deflated bytes, past its 30-byte header
// and its name, leaving the archive's structure intact.
damaged[30 + 'word/document.xml'.length + 2] ^= 0xff;
let salvaged = '';
assert.doesNotThrow(() => { salvaged = officeText('.docx', damaged); });
assert.ok(salvaged.includes('Also kept'), 'the intact part should survive: ' + salvaged);
ok('a damaged part does not throw, and the rest of the document survives');

assert.strictEqual(officeText('.docx', Buffer.from('not a zip at all')), '');
ok('something that is not an archive returns nothing rather than throwing');

console.log(`${passed} checks passed`);
