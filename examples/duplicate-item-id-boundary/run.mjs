import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const sources = ['compare.mjs', 'fixture.mjs', 'fixture/answer.json', 'fixture/samples/changed_id.json'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const read = path => readFileSync(resolve(root, path));
const hashes = () => Object.fromEntries(sources.map(path => [path, sha256(read(path))]));
const inputHashes = hashes();

const { compareInvoice, FIXTURE_ID, RULE_VERSION } = await import(pathToFileURL(resolve(root, 'compare.mjs')));
const answer = JSON.parse(read('fixture/answer.json'));
const approvedChangedSample = JSON.parse(read('fixture/samples/changed_id.json'));
const row = answer.line_items.find(candidate => candidate.line_id === '02');
const matchingId = row.item_id;
const changedId = approvedChangedSample.line_items.find(candidate => candidate.line_id === '02').item_id;
assert.equal(matchingId, '0012');
assert.equal(changedId, '012');

const baseline = JSON.stringify(answer);
const rowText = JSON.stringify(row);
const itemMember = value => `"item_id":${JSON.stringify(value)}`;
assert.equal(baseline.split(rowText).length, 2);
assert.equal(rowText.split(itemMember(matchingId)).length, 2);

function comparison(text) {
  const result = compareInvoice(text);
  return { status: result.status, matched_fields: result.matched_fields,
    expected_fields: result.expected_fields, findings: result.findings };
}

function checkCase(first, last) {
  const duplicateMembers = `${itemMember(first)},${itemMember(last)}`;
  const rawText = baseline.replace(rowText, rowText.replace(itemMember(matchingId), duplicateMembers));
  const raw = comparison(rawText);
  assert.equal(raw.status, 'invalid');
  assert.equal(raw.matched_fields, null);
  assert.deepEqual(raw.findings.map(finding => finding.code), ['duplicate_key']);

  const parsed = JSON.parse(rawText);
  const expected = structuredClone(answer);
  expected.line_items.find(candidate => candidate.line_id === '02').item_id = last;
  assert.deepEqual(parsed, expected);
  const parsedItemId = parsed.line_items.find(candidate => candidate.line_id === '02').item_id;
  const serialized = JSON.stringify(parsed);
  assert.equal(serialized.includes(duplicateMembers), false);
  const normalized = comparison(serialized);
  return { first, last, raw_members: duplicateMembers, raw_sha256: sha256(rawText), raw,
    parsed_item_id: parsedItemId, serialized_sha256: sha256(serialized), normalized };
}

const baselineResult = comparison(baseline);
assert.equal(baselineResult.status, 'match');
assert.equal(baselineResult.matched_fields, 37);
const correctLast = checkCase(changedId, matchingId);
const changedLast = checkCase(matchingId, changedId);
assert.deepEqual(correctLast.normalized, baselineResult);
assert.equal(correctLast.serialized_sha256, sha256(baseline));
assert.equal(changedLast.normalized.status, 'differences');
assert.equal(changedLast.normalized.matched_fields, 36);
assert.deepEqual(changedLast.normalized.findings.map(finding => finding.code), ['value_mismatch']);
assert.deepEqual(hashes(), inputHashes);

console.log(JSON.stringify({ completed_at: new Date().toISOString(), node_version: process.version,
  fixture: FIXTURE_ID, rules: RULE_VERSION, line_id: '02', source_sha256: inputHashes,
  baseline: baselineResult, cases: [correctLast, changedLast],
  scope: 'Local deterministic QA using only the existing checked synthetic answer and changed-ID sample; no provider or workflow call.' }, null, 2));
