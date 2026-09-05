import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactText, coarsenGeo, coarsenCoordinate, applyObligationsToPayload } from './redact.js';

test('email addresses are replaced with a stable pseudonym', () => {
  const first = redactText('write to eleni.papadaki@example.org today', ['email']);
  const second = redactText('and again eleni.papadaki@example.org tomorrow', ['email']);
  assert.ok(!first.text.includes('eleni.papadaki@example.org'));
  assert.match(first.text, /\[REDACTED:email#[0-9a-f]{8}\]/);
  assert.equal(
    first.text.match(/#([0-9a-f]{8})/)![1],
    second.text.match(/#([0-9a-f]{8})/)![1],
    'the same value gets the same pseudonym, so a reviewer can still correlate',
  );
});

test('repeated values are counted once with an occurrence count', () => {
  const result = redactText('a@x.org and a@x.org and b@x.org', ['email']);
  assert.equal(result.findings.length, 2);
  assert.equal(result.findings.find((f) => f.count === 2)?.detector, 'email');
});

test('phone numbers are caught but dates are not', () => {
  const phone = redactText('call +30 210 555 0134 now', ['phone']);
  assert.ok(!phone.text.includes('555 0134'));
  const date = redactText('the period 2026-09-05 was quiet', ['phone']);
  assert.equal(date.findings.length, 0, 'an eight-digit date is not a phone number');
});

test('payment cards are Luhn-checked so random digit runs survive', () => {
  const valid = redactText('card 4539578763621486 on file', ['payment_card']);
  assert.equal(valid.findings.length, 1);
  const invalid = redactText('card 4539578763621487 on file', ['payment_card']);
  assert.equal(invalid.findings.length, 0);
});

test('credential-shaped strings are removed', () => {
  const result = redactText('key sk-abcdefghijklmnopqrstuvwx here', ['credential']);
  assert.ok(!result.text.includes('sk-abcdefghij'));
});

test('a detector that is not requested does not fire', () => {
  const result = redactText('mail me at a@x.org', ['phone']);
  assert.ok(result.text.includes('a@x.org'));
});

test('coordinates are coarsened to roughly a kilometre', () => {
  assert.equal(coarsenCoordinate(37.938412, 2), 37.94);
  const result = coarsenGeo('site at 37.938412, 23.643117 today', 2);
  assert.equal(result.count, 2);
  assert.ok(result.text.includes('37.94'));
  assert.ok(!result.text.includes('37.938412'));
});

test('obligations rewrite the payload and report what they removed', () => {
  const { payload, findings } = applyObligationsToPayload(
    { prompt: 'contact a@x.org at 37.938412, 23.643117', keep: 'untouched' },
    [
      { type: 'redact', fields: ['payload.prompt'], detectors: ['email'] },
      { type: 'coarsen_geo', fields: ['payload.prompt'], precision: 2 },
    ],
  );
  assert.ok(!(payload.prompt as string).includes('a@x.org'));
  assert.ok((payload.prompt as string).includes('37.94'));
  assert.equal(payload.keep, 'untouched');
  assert.deepEqual(findings.map((f) => f.detector).sort(), ['email', 'geo_coarsened']);
});

test('minimisation runs before labelling, whatever order the rules declare', () => {
  const { payload } = applyObligationsToPayload({ text: 'mail a@x.org' }, [
    { type: 'label', text: 'AI-generated.' },
    { type: 'redact', fields: ['payload.text'], detectors: ['email'] },
  ]);
  const text = payload.text as string;
  assert.ok(text.startsWith('> AI-generated.'));
  assert.ok(!text.includes('a@x.org'));
});

test('a label is not applied twice to the same content', () => {
  const once = applyObligationsToPayload({ text: 'body' }, [{ type: 'label', text: 'Notice.' }]).payload;
  const twice = applyObligationsToPayload(once, [{ type: 'label', text: 'Notice.' }]).payload;
  assert.equal(once.text, twice.text);
});

test('the original payload is never mutated in place', () => {
  const original = { prompt: 'a@x.org' };
  applyObligationsToPayload(original, [{ type: 'redact', fields: ['payload.prompt'], detectors: ['email'] }]);
  assert.equal(original.prompt, 'a@x.org');
});
