import { expect, test } from 'bun:test';
import { splitSentences, chunkForKokoro } from '../src/services/text';

test('splitSentences splits on sentence-ending punctuation', () => {
  expect(splitSentences('Hello world. How are you? Fine!')).toEqual(['Hello world.', 'How are you?', 'Fine!']);
});

test('splitSentences drops empty fragments', () => {
  expect(splitSentences('  ')).toEqual([]);
});

test('chunkForKokoro keeps short sentences as single chunks', () => {
  expect(chunkForKokoro('Hello world. How are you?')).toEqual(['Hello world.', 'How are you?']);
});

test('chunkForKokoro splits a long sentence on clause boundaries under maxChars', () => {
  const clause = 'this is one clause';
  const sentence = Array(20).fill(clause).join(', ') + '.';
  const chunks = chunkForKokoro(sentence, 100);
  expect(chunks.length).toBeGreaterThan(1);
  for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100);
  expect(chunks.join(' ')).toContain(clause);
});

test('chunkForKokoro hard-wraps a run with no punctuation', () => {
  const sentence = 'a'.repeat(250) + '.';
  const chunks = chunkForKokoro(sentence, 100);
  expect(chunks).toEqual(['a'.repeat(100), 'a'.repeat(100), 'a'.repeat(50) + '.']);
});
