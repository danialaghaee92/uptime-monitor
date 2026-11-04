import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parsePasteInput, parseTargetsCsv } from '../src/lib/csv.js';

test('parseCsv supports quoted commas, quotes and newlines', () => {
  const rows = parseCsv('url,name\r\nhttps://a.com,"Name, Inc"\r\nhttps://b.com,"Say ""Hi"""\r\n');
  assert.deepEqual(rows, [
    ['url', 'name'],
    ['https://a.com', 'Name, Inc'],
    ['https://b.com', 'Say "Hi"'],
  ]);
});

test('parseTargetsCsv detects header columns', () => {
  const entries = parseTargetsCsv('display_name,url,category,tags,allow_private\nسایت,https://a.com,بانک,"پرداخت,عمومی",true\n');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].url, 'https://a.com');
  assert.equal(entries[0].name, 'سایت');
  assert.equal(entries[0].category, 'بانک');
  assert.equal(entries[0].tags, 'پرداخت,عمومی');
  assert.equal(entries[0].allowPrivate, 'true');
});

test('parseTargetsCsv works without header', () => {
  const entries = parseTargetsCsv('https://a.com,سایت الف\nhttps://b.com\n');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'سایت الف');
});

test('parsePasteInput supports pipe and comma and skips empty/comment lines', () => {
  const entries = parsePasteInput('# comment\nhttps://a.com\nexample.ir | سایت | بانک | پرداخت\nb.ir,دوم,دسته\n');
  assert.equal(entries.length, 3);
  assert.equal(entries[0].url, 'https://a.com');
  assert.equal(entries[1].name, 'سایت');
  assert.equal(entries[1].category, 'بانک');
  assert.equal(entries[2].url, 'b.ir');
  assert.equal(entries[2].name, 'دوم');
});
