import { ANSWER } from './fixture.mjs';

export const FIXTURE_ID = 'synthetic-invoice-000147';
export const RULE_VERSION = '1.0.0';
export const INPUT_LIMIT = 65536;

const money = new Set(['unit_price', 'line_total', 'subtotal', 'discount_amount',
  'taxable_amount', 'tax_amount', 'shipping', 'total']);
const decimal = new Set([...money, 'quantity', 'discount_rate', 'tax_rate']);
const descriptive = new Set(['seller', 'buyer', 'description']);
const rootFields = Object.keys(ANSWER).filter(key => key !== 'line_items');
const rowFields = Object.keys(ANSWER.line_items[0]);
const expectedFields = rootFields.length + ANSWER.line_items.length * rowFields.length;
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const show = value => value === undefined ? '(not provided)'
  : typeof value === 'number' && !Number.isFinite(value) ? '(non-finite JSON number)'
  : JSON.stringify(value);
const label = key => key.replaceAll('_', ' ').replace(/\bid\b/g, 'ID');

class InputError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function parseResponse(text) {
  if (typeof text !== 'string') throw new InputError('text_required', 'Paste JSON text.');
  if (text.length > INPUT_LIMIT) {
    throw new InputError('input_limit', `Keep the response within ${INPUT_LIMIT} characters.`);
  }
  let value;
  try { value = JSON.parse(text); }
  catch { throw new InputError('invalid_json', 'Use one JSON object without code fences, comments or trailing commas.'); }

  // JSON.parse validates grammar, but discards duplicate members. Scan the valid
  // source before comparison so literal and escaped duplicate keys stay visible.
  const tokens = /"(?:[^"\\]|\\.)*"|[{}\[\]:,]|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const stack = [];
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    const top = stack.at(-1);
    if (token === '{' || token === '[') {
      stack.push({ type: token, keys: new Set(), wantsKey: token === '{' });
      if (stack.length > 16) throw new InputError('depth_limit', 'This exercise does not accept nesting deeper than 16 levels.');
    } else if (token === '}' || token === ']') {
      stack.pop();
    } else if (token === ',' && top?.type === '{') {
      top.wantsKey = true;
    } else if (top?.type === '{' && top.wantsKey && token.startsWith('"')) {
      const key = JSON.parse(token);
      if (top.keys.has(key)) {
        throw new InputError('duplicate_key', `Key ${show(key)} occurs twice in one object (character ${match.index + 1}). Remove the ambiguity; no values were compared.`);
      }
      top.keys.add(key);
      top.wantsKey = false;
    }
  }
  if (!object(value)) throw new InputError('root_object', 'The response must be one JSON object.');
  return value;
}

// Exact decimal equality through strings; no binary floating-point conversion,
// tolerances, percentage conversion, exponent expansion or currency guessing.
function normalizeDecimal(text) {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const whole = match[2].replace(/^0+(?=\d)/, '');
  const fraction = (match[3] || '').replace(/0+$/, '');
  const nonzero = whole !== '0' || fraction !== '';
  return (match[1] === '-' && nonzero ? '-' : '') + whole + (fraction ? '.' + fraction : '');
}

function validDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(text + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

export function compareInvoice(text) {
  const report = { fixture: FIXTURE_ID, rules: RULE_VERSION, status: 'differences',
    expected_fields: expectedFields, matched_fields: 0, findings: [] };
  const add = (kind, code, path, expected, received, message) => {
    report.findings.push({ kind, code, path, expected: show(expected), received: show(received), message });
  };
  let candidate;
  try { candidate = parseResponse(text); }
  catch (error) {
    if (!(error instanceof InputError)) throw error;
    report.status = 'invalid';
    report.matched_fields = null;
    add('input', error.code, '$', undefined, undefined, error.message);
    return report;
  }

  function fields(actual, expected, keys, path, context) {
    for (const key of Object.keys(actual)) {
      if (!keys.includes(key)) add('extra', 'extra_field', `${path}[${show(key)}]`,
        undefined, actual[key], `${context}: ${show(key)} is not part of this exercise's schema.`);
    }
    for (const key of keys) {
      const location = `${path}.${key}`;
      const want = expected[key];
      const got = has(actual, key) ? actual[key] : undefined;
      const name = `${context}: ${label(key)}`;
      if (got === undefined || got === null || (typeof got === 'string' && !got.trim())) {
        add('missing', got === null ? 'uncertain_value' : 'missing_value', location, want, got,
          `${name} is missing or uncertain. Do not invent a value; check the practice invoice.`);
        continue;
      }
      if (typeof got !== 'string') {
        add('format', 'string_required', location, want, got,
          `${name} must be a JSON string. No value verdict is assigned to this type mismatch.`);
        continue;
      }
      const trimmed = got.trim();
      let normalized = trimmed;
      let normalizedWant = want;
      let formatOkay = true;
      if (decimal.has(key)) {
        normalized = normalizeDecimal(trimmed);
        normalizedWant = normalizeDecimal(want);
        if (normalized === null) {
          add('format', 'decimal_format', location, want, got,
            `${name} needs plain decimal text, without currency signs, commas, units, percent signs or exponents.`);
          continue;
        }
        if (key === 'discount_amount' && normalized === '-' + normalizedWant) {
          add('format', 'discount_convention', location, want, got,
            'Discount amount is the positive magnitude to subtract. The invoice prints a minus sign; the exercise instruction asks for "14.40". This is a representation-rule difference, not a general model-quality finding.');
          continue;
        }
        const pattern = money.has(key) ? /^-?(?:0|[1-9]\d*)\.\d{2}$/ : /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
        if (!pattern.test(trimmed)) {
          formatOkay = false;
          add('format', 'decimal_representation', location, want, got,
            `${name}: ${money.has(key) ? 'use two decimal places for money' : 'use an unsigned plain decimal fraction or quantity'}, without extra leading zeroes or a plus sign.`);
        }
      } else if (key === 'invoice_date' && !validDate(trimmed)) {
        add('format', 'date_format', location, want, got, `${name} needs a valid YYYY-MM-DD date; dates are not guessed or reformatted.`);
        continue;
      } else if (descriptive.has(key)) {
        normalized = trimmed.replace(/\s+/gu, ' ');
        normalizedWant = want.replace(/\s+/gu, ' ');
      }
      if (normalized !== normalizedWant) {
        add('value', 'value_mismatch', location, want, got,
          `${name}: expected ${show(want)}; received ${show(got)}.`);
      } else if (formatOkay) {
        report.matched_fields += 1;
      }
    }
  }

  // line_items is checked separately; do not count it as a scalar field.
  const header = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== 'line_items'));
  fields(header, ANSWER, rootFields, '$', 'Invoice');
  const rows = candidate.line_items;
  if (!has(candidate, 'line_items')) {
    add('missing', 'missing_rows', '$.line_items', 'Four rows, identified 01 through 04', undefined,
      'The line_items array is missing.');
  } else if (!Array.isArray(rows)) {
    add('structure', 'rows_array', '$.line_items', 'An array of row objects', rows,
      'line_items must be an array; rows are not inferred from another shape.');
  } else if (rows.length > 20) {
    add('structure', 'row_limit', '$.line_items', 'At most 20 submitted rows for this four-row exercise', rows.length,
      'Too many rows for this fixed exercise. No row values were compared.');
  } else {
    const byId = new Map();
    const duplicateIds = new Set();
    for (const [index, row] of rows.entries()) {
      const path = `$.line_items[${index}]`;
      if (!object(row)) {
        add('structure', 'row_object', path, 'A row object', row, `Submitted row ${index + 1} must be an object.`);
        continue;
      }
      if (!has(row, 'line_id') || typeof row.line_id !== 'string' || !row.line_id.trim()) {
        add('structure', 'row_id_required', path + '.line_id', 'A printed line ID string', row.line_id,
          `Submitted row ${index + 1} has no usable line ID. No row alignment was guessed.`);
        continue;
      }
      const id = row.line_id.trim();
      if (byId.has(id)) {
        if (!duplicateIds.has(id)) add('structure', 'duplicate_row', path + '.line_id',
          'A unique printed line ID', id, `Line ID ${show(id)} appears more than once. None of its conflicting rows were compared.`);
        duplicateIds.add(id);
      } else byId.set(id, row);
    }
    const knownIds = new Set(ANSWER.line_items.map(row => row.line_id));
    for (const id of byId.keys()) {
      if (!knownIds.has(id)) add('extra', 'extra_row', `$.line_items[line_id=${show(id)}]`,
        'Only the printed line IDs 01, 02, 03 and 04', id, `No practice-invoice row has line ID ${show(id)}. Leading zeroes matter.`);
    }
    for (const expected of ANSWER.line_items) {
      const id = expected.line_id;
      const path = `$.line_items[line_id=${show(id)}]`;
      if (duplicateIds.has(id)) continue;
      if (!byId.has(id)) {
        add('missing', 'missing_row', path, expected, undefined, `Row ${id} (${expected.description}) is missing.`);
      } else fields(byId.get(id), expected, rowFields, path, `Row ${id}`);
    }
  }
  if (report.findings.length === 0) report.status = 'match';
  return report;
}

export function reportText(report, generatedAt = new Date()) {
  const timestamp = generatedAt.toISOString();
  const lines = ['AI Extraction Checkup', `Fixture: ${report.fixture}`, `Rules: ${report.rules}`,
    `Report generated: ${timestamp}`, `Result: ${report.status}`,
    'Scope: one synthetic practice invoice; not a model benchmark or a check of arbitrary invoices.'];
  if (report.status === 'match') lines.push('All 37 expected scalar fields meet this exercise’s value and format rules.');
  for (const finding of report.findings) {
    lines.push('', `[${finding.kind}] ${finding.path}`, finding.message,
      `Expected: ${finding.expected}`, `Received: ${finding.received}`);
  }
  return lines.join('\n') + '\n';
}
