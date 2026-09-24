// "What time is it?" on the phone got "check the clock on your device" from
// the model. Time, date, weather and news are now answered before the model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  detectLiveQuestion, sayTime, sayDate, sayWeather, parseHeadlines, sayNews,
} from '../src/utils/liveAnswers.js';

const kinds = [
  ['what time is it', 'time'],
  ["what's the time", 'time'],
  ['time kya hua hai', 'time'],
  ['abhi kitne baje hain', 'time'],
  ['कितने बजे हैं', 'time'],
  ["what's today's date", 'date'],
  ['aaj ki date kya hai', 'date'],
  ['aaj kaun sa din hai', 'date'],
  ["what's the weather", 'weather'],
  ['aaj mausam kaisa hai', 'weather'],
  ['will it rain today', 'weather'],
  ['आज मौसम कैसा है', 'weather'],
  ['latest news', 'news'],
  ['aaj ki khabar sunao', 'news'],
  ['cricket ki news batao', 'news'],
];
for (const [said, kind] of kinds) {
  test(`"${said}" is a ${kind} question`, () => {
    assert.equal(detectLiveQuestion(said)?.kind, kind);
  });
}

for (const said of ['open chrome', 'play kesariya on spotify', 'what is the capital of france', 'write a poem about time travel', 'hello']) {
  test(`"${said}" is left to the model`, () => {
    assert.equal(detectLiveQuestion(said), null);
  });
}

test('a named city is picked out of the weather question', () => {
  assert.equal(detectLiveQuestion('weather in Delhi').place, 'Delhi');
  assert.equal(detectLiveQuestion('Mumbai ka mausam kaisa hai').place, 'Mumbai');
  assert.equal(detectLiveQuestion("what's the weather today").place, '');
});

test('a news topic is picked out', () => {
  assert.equal(detectLiveQuestion('cricket ki news batao').topic, 'cricket');
  assert.equal(detectLiveQuestion('latest news').topic, '');
});

test('time and date are read in the language asked', () => {
  const at = new Date(2026, 8, 24, 17, 5);
  assert.equal(sayTime(at, 'en'), "It's 5:05 PM.");
  assert.equal(sayTime(at, 'hinglish'), 'Abhi 5:05 PM baje hain.');
  assert.match(sayDate(at, 'en'), /Thursday.*24.*September.*2026/);
});

test('weather reads temperature, sky and rain', () => {
  const line = sayWeather({ temp: 31.4, code: 2, max: 34, min: 26, rainChance: 40, place: 'Delhi' }, 'en');
  assert.equal(line, "In Delhi, it's 31°C and partly cloudy. Today 26° to 34°, 40% chance of rain.");
});

test('headlines are pulled from the RSS feed without the publisher', () => {
  const xml = '<rss><channel><item><title>India wins the match - The Hindu</title></item>'
    + '<item><title><![CDATA[Rain in Mumbai &amp; Pune]]></title></item></channel></rss>';
  assert.deepEqual(parseHeadlines(xml), ['India wins the match', 'Rain in Mumbai & Pune']);
  assert.match(sayNews(['A', 'B'], '', 'en'), /^Top headlines:\n1\. A\n2\. B$/);
});
