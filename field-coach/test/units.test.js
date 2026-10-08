import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../lib/whatsapp.js';
import { overallScore } from '../lib/analyze.js';

test('israeli phone numbers become international', () => {
  assert.equal(normalizePhone('050-123-4567'), '972501234567');
  assert.equal(normalizePhone('+972 50 1234567'), '972501234567');
  assert.equal(normalizePhone('00972501234567'), '972501234567');
});

test('overall score is weighted and clamped', () => {
  const defs = [{ id: 'a', weight: 1 }, { id: 'b', weight: 3 }];
  assert.equal(overallScore(defs, [{ id: 'a', score: 10 }, { id: 'b', score: 0 }]), 25);
  assert.equal(overallScore(defs, [{ id: 'a', score: 15 }, { id: 'b', score: 10 }]), 100);
});
