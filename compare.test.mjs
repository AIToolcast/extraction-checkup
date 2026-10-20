import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ANSWER } from './fixture.mjs';
import { compareInvoice, reportText, INPUT_LIMIT } from './compare.mjs';

const sample = name => readFileSync(new URL(`./tests/samples/${name}.json`, import.meta.url), 'utf8');
const correctText = sample('identical_correct');
const correct = JSON.parse(correctText);
const edited = edit => { const value = JSON.parse(correctText); edit(value); return compareInvoice(JSON.stringify(value)); };
const codes = report => report.findings.map(item => item.code);
const valueErrors = report => report.findings.filter(item => item.kind === 'value');

test('original answer and independent positive-control file agree; answer is frozen', () => {
  assert.deepEqual(ANSWER, correct);
  assert.equal(ANSWER.total, '147.47');
  assert.equal(ANSWER.discount_amount, '14.40');
  assert(Object.isFrozen(ANSWER) && Object.isFrozen(ANSWER.line_items));
  assert(ANSWER.line_items.every(Object.isFrozen));
});

test('response schema preserves the fixed shape and explicitly permits uncertain nulls', () => {
  const schema = JSON.parse(readFileSync(new URL('./response-schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(new Set(schema.required), new Set(Object.keys(correct)));
  assert.equal(schema.additionalProperties, false);
  for (const key of Object.keys(correct).filter(key => key !== 'line_items')) {
    assert.deepEqual(schema.properties[key].type, ['string', 'null']);
  }
  assert.deepEqual(new Set(schema.properties.line_items.items.required), new Set(Object.keys(correct.line_items[0])));
  assert.equal(schema.properties.line_items.items.additionalProperties, false);
  assert.match(schema.properties.discount_amount.description, /Positive magnitude/);
});

test('exact control meets all 37 fixed fields without findings', () => {
  const report = compareInvoice(correctText);
  assert.equal(report.status, 'match');
  assert.equal(report.expected_fields, 37);
  assert.equal(report.matched_fields, 37);
  assert.deepEqual(report.findings, []);
});

test('missing row 04 is identified even though the submitted total is unchanged', () => {
  const report = compareInvoice(sample('missing_last_row'));
  assert.equal(report.status, 'differences');
  assert.equal(report.matched_fields, 31);
  assert.deepEqual(codes(report), ['missing_row']);
  assert.equal(report.findings[0].path, '$.line_items[line_id="04"]');
});

test('changed leading-zero item ID produces the exact row and field difference', () => {
  const report = compareInvoice(sample('changed_id'));
  assert.equal(report.matched_fields, 36);
  assert.equal(report.findings.length, 1);
  assert.deepEqual(valueErrors(report).map(f => [f.path, f.expected, f.received]),
    [['$.line_items[line_id="02"].item_id', '"0012"', '"012"']]);
});

test('total-preserving quantity swap still produces four value findings', () => {
  const input = sample('swapped_quantities');
  assert.equal(JSON.parse(input).total, correct.total);
  const report = compareInvoice(input);
  assert.equal(report.matched_fields, 33);
  assert.deepEqual(valueErrors(report).map(f => f.path), [
    '$.line_items[line_id="01"].quantity', '$.line_items[line_id="01"].line_total',
    '$.line_items[line_id="02"].quantity', '$.line_items[line_id="02"].line_total'
  ]);
});

test('wrong total is an exact decimal value error', () => {
  const report = compareInvoice(sample('wrong_total'));
  assert.equal(report.matched_fields, 36);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].expected, '"147.47"');
  assert.equal(report.findings[0].received, '"147.57"');
});

test('descriptive whitespace and row reordering are harmless', () => {
  const report = compareInvoice(sample('harmless_whitespace_row_reorder'));
  assert.equal(report.status, 'match');
  assert.equal(report.matched_fields, 37);
});

test('surrounding field whitespace is allowed without stripping meaningful ID characters', () => {
  assert.equal(edited(v => { v.invoice_id = ' 000147 '; v.line_items[0].line_id = ' 01 '; }).status, 'match');
  assert.deepEqual(codes(edited(v => { v.invoice_id = '000-147'; })), ['value_mismatch']);
});

test('descriptive case remains meaningful', () => {
  assert.deepEqual(codes(edited(v => { v.seller = 'synthetic supplier a'; })), ['value_mismatch']);
});

test('positive discount convention is explicit; printed negative sign is a representation finding', () => {
  const report = edited(v => { v.discount_amount = '-14.40'; });
  assert.equal(report.status, 'differences');
  assert.deepEqual(codes(report), ['discount_convention']);
  assert.equal(report.findings[0].kind, 'format');
  assert.match(report.findings[0].message, /positive magnitude/);
});

test('wrong discount magnitude is still detected', () => {
  assert.equal(valueErrors(edited(v => { v.discount_amount = '-15.40'; })).length, 1);
});

test('numeric JSON values violate the string contract, without a false semantic verdict', () => {
  const report = edited(v => { v.total = 147.47; });
  assert.deepEqual(codes(report), ['string_required']);
  assert.equal(report.findings[0].kind, 'format');
  assert.equal(valueErrors(report).length, 0);
});

test('JSON number precision and overflow are never treated as exact decimal values', () => {
  for (const token of ['147.47000000000000000001', '1e400']) {
    const input = correctText.replace('"147.47"', token);
    const report = compareInvoice(input);
    assert.deepEqual(codes(report), ['string_required']);
    assert.equal(report.status, 'differences');
  }
});

test('equivalent money with extra decimal places is format-only, not a wrong value', () => {
  const report = edited(v => { v.total = '147.4700'; });
  assert.deepEqual(codes(report), ['decimal_representation']);
  assert.equal(valueErrors(report).length, 0);
});

test('rates and quantities allow numerically equal trailing zeroes', () => {
  assert.equal(edited(v => { v.discount_rate = '0.1000'; v.line_items[0].quantity = '2.00'; }).status, 'match');
});

test('very close decimal strings do not collapse through floating-point rounding', () => {
  const report = edited(v => { v.total = '147.47000000000000000001'; });
  assert.equal(report.status, 'differences');
  assert.equal(valueErrors(report).length, 1);
});

test('currency signs, grouping, exponents, percent signs and unit suffixes are not guessed', () => {
  for (const value of ['$147.47', '147,47', '1.4747e2', '147.47 USD']) {
    assert.deepEqual(codes(edited(v => { v.total = value; })), ['decimal_format']);
  }
  assert.deepEqual(codes(edited(v => { v.discount_rate = '10%'; })), ['decimal_format']);
});

test('leading zeroes and plus signs in money remain explicit representation deviations', () => {
  for (const value of ['0147.47', '+147.47']) {
    assert.deepEqual(codes(edited(v => { v.total = value; })), ['decimal_representation']);
  }
});

test('date rendering and invalid calendar dates are format findings', () => {
  for (const value of ['10/19/2026', '2026-02-30', '2026-99-19']) {
    assert.deepEqual(codes(edited(v => { v.invoice_date = value; })), ['date_format']);
  }
  assert.deepEqual(codes(edited(v => { v.invoice_date = '2026-10-18'; })), ['value_mismatch']);
});

test('requested null means uncertain/missing, not a string-type violation or invented answer', () => {
  const report = edited(v => { v.buyer = null; });
  assert.deepEqual(codes(report), ['uncertain_value']);
  assert.equal(report.findings[0].kind, 'missing');
  assert.equal(report.findings[0].received, 'null');
});

test('absent and blank fields are distinguished from null', () => {
  assert.deepEqual(codes(edited(v => { delete v.buyer; })), ['missing_value']);
  assert.equal(edited(v => { delete v.buyer; }).findings[0].received, '(not provided)');
  assert.deepEqual(codes(edited(v => { v.buyer = ' \n\t '; })), ['missing_value']);
});

test('duplicate literal and escaped root JSON keys are rejected before comparison', () => {
  const raw = JSON.stringify(correct);
  for (const suffix of [',"total":"147.47"}', String.raw`,"\u0074otal":"147.47"}`]) {
    const report = compareInvoice(raw.slice(0, -1) + suffix);
    assert.equal(report.status, 'invalid');
    assert.equal(report.matched_fields, null);
    assert.deepEqual(codes(report), ['duplicate_key']);
  }
});

test('duplicate row-object keys and duplicates in ignored extra objects are rejected', () => {
  const raw = JSON.stringify(correct);
  assert.deepEqual(codes(compareInvoice(raw.replace('"item_id":"0008"', '"item_id":"0008","item_id":"0008"'))), ['duplicate_key']);
  assert.deepEqual(codes(compareInvoice(raw.slice(0, -1) + ',"extra":{"a":1,"a":2}}')), ['duplicate_key']);
  assert.deepEqual(codes(compareInvoice(String.raw`{"a\"b":1,"a\"b":2}`)), ['duplicate_key']);
});

test('repeated names in separate objects and punctuation inside strings are not duplicate keys', () => {
  assert.equal(compareInvoice(correctText).status, 'match');
  const report = edited(v => { v.notes = { same: ['}', ',', '"same":1', { same: 2 }] }; });
  assert.equal(report.status, 'differences');
  assert.deepEqual(codes(report), ['extra_field']);
});

test('duplicate row IDs are ambiguous: neither conflicting row is selected', () => {
  const report = edited(v => {
    v.line_items.push({ ...v.line_items[0], line_id: ' 01 ', quantity: '999' });
  });
  assert.deepEqual(codes(report), ['duplicate_row']);
  assert.equal(report.matched_fields, 31);
});

test('missing, null and numeric row IDs never get guessed or aligned by position', () => {
  for (const id of [null, 2, '']) {
    const report = edited(v => { v.line_items[1].line_id = id; });
    assert(codes(report).includes('row_id_required'));
    assert(codes(report).includes('missing_row'));
    assert.equal(report.matched_fields, 31);
  }
});

test('unknown or shortened line IDs are extra rows plus missing expected rows', () => {
  const report = edited(v => { v.line_items[1].line_id = '2'; });
  assert.deepEqual(codes(report), ['extra_row', 'missing_row']);
  assert.equal(report.findings[1].path, '$.line_items[line_id="02"]');
});

test('extra row and extra fields are reported even when all expected fields match', () => {
  const report = edited(v => { v.line_items.push({ ...v.line_items[0], line_id: '05' }); v.extra = true; v.line_items[0].note = 'extra'; });
  assert.equal(report.status, 'differences');
  assert.equal(report.matched_fields, 37);
  assert.equal(report.findings.filter(f => f.kind === 'extra').length, 3);
});

test('missing array, wrong array shape, malformed rows and excessive rows are actionable', () => {
  assert.deepEqual(codes(edited(v => { delete v.line_items; })), ['missing_rows']);
  assert.deepEqual(codes(edited(v => { v.line_items = null; })), ['rows_array']);
  assert(codes(edited(v => { v.line_items[0] = []; })).includes('row_object'));
  assert.deepEqual(codes(edited(v => { v.line_items = Array(21).fill(v.line_items[0]); })), ['row_limit']);
});

test('dangerous property names are data, not prototype mutations', () => {
  const raw = JSON.stringify(correct).slice(0, -1) + ',"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}';
  const report = compareInvoice(raw);
  assert.equal(report.status, 'differences');
  assert.equal(report.findings.length, 2);
  assert.equal({}.polluted, undefined);
});

test('malformed JSON is rejected without exposing its raw contents in the error', () => {
  for (const input of ['', ' ', '```json\n{}\n```', '{"x":1,}', '{"x":NaN}', '{"x":"secret",}', '{}{}', '\uFEFF{}']) {
    const report = compareInvoice(input);
    assert.equal(report.status, 'invalid');
    assert.deepEqual(codes(report), ['invalid_json']);
    assert(!reportText(report).includes('secret'));
  }
});

test('non-object roots and non-text inputs are rejected', () => {
  for (const input of ['null', '[]', '"text"', '4', 'true']) {
    assert.deepEqual(codes(compareInvoice(input)), ['root_object']);
  }
  for (const input of [null, {}, undefined, 3]) {
    assert.deepEqual(codes(compareInvoice(input)), ['text_required']);
  }
});

test('size and nesting limits are enforced with no guessed repair', () => {
  assert.deepEqual(codes(compareInvoice(' '.repeat(INPUT_LIMIT + 1))), ['input_limit']);
  assert.equal(compareInvoice(' '.repeat(INPUT_LIMIT - 2) + '{}').status, 'differences');
  assert.deepEqual(codes(compareInvoice('['.repeat(17) + '0' + ']'.repeat(17))), ['depth_limit']);
});

test('plain-text report carries fixture, rule version and explicit timestamp', () => {
  const report = compareInvoice(sample('changed_id'));
  const text = reportText(report, new Date('2026-10-20T14:00:00Z'));
  assert.match(text, /Fixture: synthetic-invoice-000147/);
  assert.match(text, /Rules: 1\.0\.0/);
  assert.match(text, /Report generated: 2026-10-20T14:00:00.000Z/);
  assert.match(text, /Row 02: item ID/);
  assert.match(text, /not a model benchmark/);
  assert.match(text, /Expected: "0012"\nReceived: "012"/);
});

test('HTML-looking input remains literal report data, without executing or fetching it', () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected network request'); };
  try {
    const payload = '<img src=x onerror="globalThis.didExecute=true">';
    const report = edited(v => { v.buyer = payload; });
    const text = reportText(report, new Date('2026-10-20T14:00:00Z'));
    assert(text.includes(JSON.stringify(payload)));
    assert.equal(globalThis.didExecute, undefined);
  } finally { globalThis.fetch = previousFetch; }
});

test('repeated checks do not alter the fixed fixture or retain a previous result', () => {
  const before = JSON.stringify(ANSWER);
  const first = compareInvoice(sample('wrong_total'));
  first.findings.length = 0;
  assert.equal(compareInvoice(correctText).status, 'match');
  assert.equal(compareInvoice(sample('wrong_total')).findings.length, 1);
  assert.equal(JSON.stringify(ANSWER), before);
});
