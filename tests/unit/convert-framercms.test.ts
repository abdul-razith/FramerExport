import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  UnknownCmsTagError,
  collectionIdFromFile,
  decodeChunk,
} from '../../src/convert/adapters/framer/framercms.js';

const dataDir = path.resolve('tests/fixtures/framer-nudge-mini/data');
const chunk = (name: string) => fs.readFileSync(path.join(dataDir, name));
const main = () => decodeChunk(chunk('hu3yniggG-chunk-default-0.framercms'));

test('decodes first item id and string fields', () => {
  const { items } = main();
  const first = items[0]!;
  assert.equal(first.id, 'leVeLIZbF');
  assert.deepEqual(first.fields.KVCXsWDZS, { type: 'string', value: 'meridian-health' });
  assert.deepEqual(first.fields.rAITKxrzh, { type: 'string', value: 'Meridian Health' });
});

test('decodes date, json and richtext fields', () => {
  const first = main().items[0]!;
  assert.deepEqual(first.fields.N9PVOHoUg, { type: 'date', value: 1773878400000 });
  assert.equal(first.fields.v80eqeLsH!.type, 'json');
  assert.ok(
    String((first.fields.v80eqeLsH!.value as any).src).startsWith('https://framerusercontent.com'),
  );
  assert.equal(first.fields.fM51CJnkf!.type, 'richtext');
  assert.ok(JSON.stringify(first.fields.fM51CJnkf!.value).includes('"The Real Problem"'));
});

test('decodes all items without errors', () => {
  const { items, errors } = main();
  assert.ok(items.length >= 4);
  assert.equal(errors.length, 0);
  const slugs = items.map((i) => (i.fields.KVCXsWDZS as any)?.value);
  assert.ok(slugs.includes('meridian-health'));
});

test('decodes every chunk file in the fixture without errors', () => {
  for (const f of fs.readdirSync(dataDir).filter((n) => n.includes('-chunk-'))) {
    const { items, errors } = decodeChunk(chunk(f));
    assert.equal(errors.length, 0, `${f}: ${errors.map((e) => e.message).join('; ')}`);
    assert.ok(items.length > 0, f);
  }
});

test('unknown tag yields UnknownCmsTagError with key and tag', () => {
  const key = Buffer.from('abc');
  const buf = Buffer.concat([
    Buffer.from([0x00, 0x01]),
    Buffer.from([0, 0, 0, key.length]),
    key,
    Buffer.from([0x7f, 1, 2, 3]),
  ]);
  const { items, errors } = decodeChunk(buf);
  assert.equal(items.length, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof UnknownCmsTagError);
  assert.equal(errors[0]!.tag, 0x7f);
  assert.equal(errors[0]!.key, 'abc');
  assert.equal(errors[0]!.reason, 'unknown-tag');
  assert.equal(errors[0]!.offset, 2 + 4 + 3);
});

test('collectionIdFromFile', () => {
  assert.equal(collectionIdFromFile('hu3yniggG-chunk-default-0.framercms'), 'hu3yniggG');
});

test('tag 0x05 (enum option id) decodes as a length-prefixed string', () => {
  const field = (key: string, tag: number, val: string) => {
    const k = Buffer.from(key);
    const v = Buffer.from(val);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(v.length);
    const kl = Buffer.alloc(4);
    kl.writeUInt32BE(k.length);
    return Buffer.concat([kl, k, Buffer.from([tag]), len, v]);
  };
  const buf = Buffer.concat([
    Buffer.from([0x00, 0x02]),
    field('id', 0x0c, 'item1'),
    field('s01z5wmCs', 0x05, 'isOn3ABPV'),
  ]);
  const { items, errors } = decodeChunk(buf);
  assert.equal(errors.length, 0);
  assert.deepEqual(items[0]!.fields.s01z5wmCs, { type: 'string', value: 'isOn3ABPV' });
});

test('real enum field decodes from the D8jD2HbSE chunk', () => {
  const { items, errors } = decodeChunk(chunk('D8jD2HbSE-chunk-default-0.framercms'));
  assert.equal(errors.length, 0);
  assert.deepEqual(items[0]!.fields.s01z5wmCs, { type: 'string', value: 'isOn3ABPV' });
});

test('half-length chunk reports truncated and keeps earlier items', () => {
  const full = chunk('hu3yniggG-chunk-default-0.framercms');
  const fullCount = decodeChunk(full).items.length;
  const { items, errors } = decodeChunk(full.subarray(0, Math.floor(full.length / 2)));
  assert.equal(errors[0]?.reason, 'truncated');
  assert.ok(items.length >= 1);
  assert.ok(items.length < fullCount);
});

test('trailing byte after a full chunk reports truncated but keeps all items', () => {
  const full = chunk('hu3yniggG-chunk-default-0.framercms');
  const fullCount = decodeChunk(full).items.length;
  const { items, errors } = decodeChunk(Buffer.concat([full, Buffer.from([0x00])]));
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.reason, 'truncated');
  assert.equal(errors[0]!.offset, full.length);
  assert.equal(items.length, fullCount);
});

test('malformed JSON in a json field reports invalid-json with key', () => {
  const key = Buffer.from('jf');
  const payload = Buffer.from('{bad');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(payload.length);
  const buf = Buffer.concat([
    Buffer.from([0x00, 0x01, 0, 0, 0, key.length]),
    key,
    Buffer.from([0x0a]),
    len,
    payload,
  ]);
  const { items, errors } = decodeChunk(buf);
  assert.equal(items.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.reason, 'invalid-json');
  assert.equal(errors[0]!.key, 'jf');
});

test('collectionIdFromFile handles Windows backslash paths', () => {
  assert.equal(collectionIdFromFile('C:\\x\\data\\hu3yniggG-chunk-default-0.framercms'), 'hu3yniggG');
  assert.equal(collectionIdFromFile('/x/data/D8jD2HbSE-chunk-default-0.framercms'), 'D8jD2HbSE');
});
