import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyTranscriptionFailure, pollFinalTranscript, voiceOutcomeKind,
} from '../src/utils/voiceStatus.js';

// The reported failure, written down as a test.
//
// On the phone: Speak opened, the microphone worked, the user said nothing for
// a moment, the recorded-audio fallback had no endpoint to reach, and the call
// reported "Voice input unavailable" with "I did not catch that" underneath.
test('a missing transcription endpoint is not a broken microphone', () => {
  const kind = voiceOutcomeKind({
    micStatus: 'granted',
    voiceState: 'vad-ready',
    uploadStatus: 'unavailable',
    heardNothing: true,
    nativeRecognizerFailed: false,
  });
  assert.equal(kind, 'no-speech');
  assert.notEqual(kind, 'voice-unavailable');
});

test('a fallback that failed does not claim voice input is unavailable', () => {
  assert.equal(voiceOutcomeKind({ micStatus: 'granted', uploadStatus: 'error' }),
    'transcriber-unavailable');
});

test('real faults still win', () => {
  assert.equal(voiceOutcomeKind({ micStatus: 'denied' }), 'mic-denied');
  assert.equal(voiceOutcomeKind({ micStatus: 'unavailable' }), 'voice-unavailable');
  assert.equal(voiceOutcomeKind({ micStatus: 'error' }), 'voice-unavailable');
  assert.equal(voiceOutcomeKind({ voiceState: 'error' }), 'voice-unavailable');
  assert.equal(voiceOutcomeKind({ nativeRecognizerFailed: true }), 'voice-unavailable');
});

test('a denied microphone outranks having heard nothing', () => {
  // Both are true while a refused permission stops any audio arriving. The
  // permission is the one the user can act on.
  assert.equal(voiceOutcomeKind({ micStatus: 'denied', heardNothing: true }), 'mic-denied');
});

test('this turn outranks the missing fallback route', () => {
  assert.equal(
    voiceOutcomeKind({ micStatus: 'granted', heardNothing: true, uploadStatus: 'unavailable' }),
    'no-speech',
  );
});

test('a healthy call reports no condition at all', () => {
  assert.equal(voiceOutcomeKind({ micStatus: 'granted', voiceState: 'listening' }), null);
  assert.equal(voiceOutcomeKind({}), null);
  assert.equal(voiceOutcomeKind(), null);
});

test('unreachable is told apart from refused', () => {
  assert.equal(classifyTranscriptionFailure(new TypeError('Failed to fetch')), 'unreachable');
  assert.equal(classifyTranscriptionFailure(new Error('NetworkError when attempting to fetch')), 'unreachable');
  assert.equal(classifyTranscriptionFailure(new Error('Load failed')), 'unreachable');
  assert.equal(classifyTranscriptionFailure(new Error('connect ECONNREFUSED 127.0.0.1:8000')), 'unreachable');

  // A shell with no such route, which is what an unpaired phone serves.
  assert.equal(classifyTranscriptionFailure(null, 404), 'unreachable');
  assert.equal(classifyTranscriptionFailure(null, 501), 'unreachable');

  // A server that answered and refused is a genuine failure worth reporting.
  assert.equal(classifyTranscriptionFailure(null, 500), 'failed');
  assert.equal(classifyTranscriptionFailure(null, 401), 'failed');
  assert.equal(classifyTranscriptionFailure(new Error('model crashed')), 'failed');
});

// The dictation half of the report: sentences cut short, final words missing.
//
// The silence watchdog fires 850 ms after the audio stops; a recogniser
// commits its final result later than that. Reading the interim at the
// watchdog sent half a sentence and discarded the rest when it arrived.

test('a half-finished sentence waits rather than being sent', () => {
  assert.equal(pollFinalTranscript({
    finalText: '', lastSpeechAt: 1000, quietSince: 1000, expired: false,
  }), 'wait');
});

test('the final result ends the wait immediately', () => {
  assert.equal(pollFinalTranscript({
    finalText: 'how do I install the video packages',
    lastSpeechAt: 1000, quietSince: 1000,
  }), 'final');
});

test('speech that resumes is a pause inside a sentence, not a turn', () => {
  assert.equal(pollFinalTranscript({
    finalText: '', lastSpeechAt: 1600, quietSince: 1000,
  }), 'resumed');
});

test('the wait is bounded so a turn is never lost outright', () => {
  // Nothing final arrived. The caller falls back to the interim: losing the
  // tail of a sentence is bad, losing the whole turn is worse.
  assert.equal(pollFinalTranscript({
    finalText: '', lastSpeechAt: 1000, quietSince: 1000, expired: true,
  }), 'timeout');
});

test('closing or muting the call cancels the pending turn', () => {
  assert.equal(pollFinalTranscript({ finalText: 'hello', muted: true }), 'cancelled');
  assert.equal(pollFinalTranscript({ finalText: 'hello', open: false }), 'cancelled');
  // Cancellation outranks even a final result: there is nobody to answer.
  assert.equal(pollFinalTranscript({
    finalText: 'hello', lastSpeechAt: 9, quietSince: 1, muted: true, expired: true,
  }), 'cancelled');
});

test('whitespace is not a final result', () => {
  assert.equal(pollFinalTranscript({
    finalText: '   \n ', lastSpeechAt: 1000, quietSince: 1000,
  }), 'wait');
});

test('a resumed sentence outranks an expired deadline', () => {
  // Otherwise the deadline would commit a fragment the user was still adding to.
  assert.equal(pollFinalTranscript({
    finalText: '', lastSpeechAt: 2000, quietSince: 1000, expired: true,
  }), 'resumed');
});
