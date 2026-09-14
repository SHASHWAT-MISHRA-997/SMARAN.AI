/**
 * A generated video is shown as a video, and both can be saved.
 *
 * The backend ends a video generation by sending a raw
 * <video controls src="/api/video/file/…"></video> tag into the chat. The
 * message renderer builds elements from markdown and had no HTML branch at
 * all, so after waiting out a generation what arrived on screen was that tag,
 * printed as text. Nothing in the frontend referenced /api/video/file
 * anywhere, which is how it went unnoticed.
 *
 * Saving was no better. A picture could only be kept with right-click and
 * "save image as", which does not exist on a phone, and a video only through
 * Chrome's overflow menu.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'components', 'ChatArea.jsx'), 'utf8');

test('the renderer recognises the video tag the backend sends', () => {
  assert.match(source, /videoMatch/,
    'nothing matches the <video> tag, so it renders as literal text');
  assert.match(source, /<video\b[\s\S]{0,200}src=\{videoSrc\}/,
    'the tag is matched but no player is rendered from it');
  assert.match(source, /controls/, 'the player has no controls');
});

test('the pattern matches the tag the backend actually emits', () => {
  // Kept in step with VIDEO_TAG_TEMPLATE in backend/app/main.py.
  const emitted = '<video controls style="max-width:100%" src="/api/video/file/abc123"></video>';
  const found = /<video[^>]*\ssrc=["']([^"']+)["'][^>]*>/i.exec(emitted);
  assert.ok(found, 'the emitted tag does not match the renderer pattern');
  assert.equal(found[1], '/api/video/file/abc123');
});

test('both a generated video and a generated image can be downloaded', () => {
  assert.match(source, /Download video/, 'no way to save a generated video');
  assert.match(source, /Download image/, 'no way to save a generated picture');
  // download= is what makes the browser save rather than navigate, and it is
  // what names the file instead of leaving an opaque id.
  assert.match(source, /download=\{videoName\}/, 'the video link navigates instead of saving');
  assert.match(source, /download=\{imageName\}/, 'the image link navigates instead of saving');
});

test('a relative media path is resolved against the API, not the page', () => {
  // The desktop app and the phone are not served from the same origin as the
  // backend, so "/api/video/file/x" alone would resolve against the wrong host.
  assert.match(source, /videoMatch\[1\]\.startsWith\('\/'\) \? `\$\{API_BASE\}/,
    'the video src is used raw, which breaks wherever the app is not same-origin');
  assert.match(source, /imageMatch\[2\]\.startsWith\('\/'\) \? `\$\{API_BASE\}/,
    'the image src is used raw, which breaks wherever the app is not same-origin');
});
