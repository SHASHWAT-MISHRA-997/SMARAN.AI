// "Open GPay" opens it. "Send 500 to Rahul on GPay", "buy this", "add to cart"
// open the app if one is named and say plainly that paying and buying are the
// user's to do. Nothing in SMARAN ever sends money or buys.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectDeviceCommand, describeOutcome } from '../src/utils/deviceCommands.js';

test('paying or buying opens the named app, marked as money', () => {
  for (const [said, app] of [
    ['send 500 rupees to Rahul on gpay', 'Google Pay'],
    ['paytm par 200 bhejo', 'Paytm'],
    ['gpay se 100 rupees bhej do', 'Google Pay'],
    ['₹50 send karo phonepe par', 'PhonePe'],
    ['buy this on amazon', 'Amazon'],
    ['order pizza on swiggy', 'Swiggy'],
  ]) {
    assert.deepEqual(detectDeviceCommand(said), { action: 'app', name: app, money: true }, said);
  }
});

test('with no app named, it only says so', () => {
  for (const said of ['Rahul ko 500 bhejo', 'add to cart', 'recharge karo', 'pay Rahul']) {
    assert.deepEqual(detectDeviceCommand(said), { action: 'say', money: true }, said);
  }
});

test('what is said back promises nothing was paid', () => {
  const opened = describeOutcome({ action: 'app', name: 'Google Pay', money: true }, { opened: true, label: 'Google Pay' });
  assert.match(opened, /^Opened Google Pay\. I don't send money or buy anything myself/);
  assert.match(describeOutcome({ action: 'say', money: true }, {}), /don't send money or buy anything/);
});

test('"open gpay" is just opening it, under the name the phone uses', () => {
  assert.deepEqual(detectDeviceCommand('open gpay'), { action: 'app', name: 'Google Pay' });
  assert.deepEqual(detectDeviceCommand('gpay kholo'), { action: 'app', name: 'Google Pay' });
});
