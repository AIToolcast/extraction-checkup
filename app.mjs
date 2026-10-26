import { compareInvoice, reportText, INPUT_LIMIT } from './compare.mjs';

// Measurement failure never prevents the local exercise from working.
const usage = import('./usage.mjs').then(module => module.createUsageTracker({ tool: 'extraction-checkup' })).catch(() => null);
const track = (name, sample = false) => { usage.then(tracker => tracker?.event(name, { sample })).catch(() => {}); };
const byId = id => document.getElementById(id);
if (new URLSearchParams(location.search).get('qa') === '1') byId('qa-notice')?.removeAttribute('hidden');
const input = byId('response');
const reportArea = byId('report');
const controls = byId('report-controls');
let sampleMode = false;
let sampleName = '';
let output = '';
let reportSample = false;
let sampleRequest = 0;

function announce(message, target = 'status') { byId(target).textContent = message; }
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function clearReport(message = 'Paste your response and choose Compare response. The report will show exact expected and received values, with format issues and uncertainty kept separate.') {
  reportArea.replaceChildren(element('p', message, 'empty-message'));
  reportArea.dataset.state = 'empty';
  controls.hidden = true;
  byId('plain-report').value = '';
  input.removeAttribute('aria-invalid');
  output = '';
}

function updateInputState() {
  byId('character-count').textContent = `${input.value.length.toLocaleString('en-US')} / ${INPUT_LIMIT.toLocaleString('en-US')} characters`;
  const source = byId('input-source');
  source.dataset.sample = String(sampleMode);
  source.textContent = sampleMode
    ? `Synthetic example: ${sampleName}. Reset before pasting your own response. Example checks do not count as reader use.`
    : 'Your response is not saved here. Reset clears the exercise.';
}

const groupLabels = {
  value: 'Value differences', missing: 'Missing or uncertain',
  format: 'Format and representation', structure: 'Row or schema structure',
  extra: 'Extra fields or rows', input: 'Input problem'
};

function showReport(report) {
  reportArea.replaceChildren();
  reportArea.dataset.state = report.status;
  const summary = element('div', undefined, `report-summary ${report.status}`);
  const title = report.status === 'match' ? 'All 37 fields match this exercise.'
    : report.status === 'invalid' ? 'The JSON could not be compared.'
    : `${report.matched_fields} of ${report.expected_fields} fields match.`;
  summary.append(element('strong', title));
  summary.append(element('p', report.status === 'invalid'
    ? 'No field values were judged. Fix the input problem below and compare again.'
    : report.status === 'match'
      ? 'No value, format, missing-field or extra-field findings under the fixed rules.'
      : `${report.findings.length} finding${report.findings.length === 1 ? '' : 's'} to review. A format or uncertainty finding is not a wrong-value verdict.`));
  if (sampleMode) summary.append(element('p', `Built-in synthetic example: ${sampleName}. This is not an observed AI result.`, 'sample-label'));
  reportArea.append(summary);
  for (const [kind, label] of Object.entries(groupLabels)) {
    const findings = report.findings.filter(finding => finding.kind === kind);
    if (!findings.length) continue;
    const group = element('section', undefined, 'finding-group');
    group.append(element('h4', `${label} (${findings.length})`));
    for (const finding of findings) {
      const row = element('div', undefined, 'finding');
      row.append(element('code', finding.path), element('p', finding.message));
      if (kind !== 'input') {
        const values = element('dl');
        for (const key of ['expected', 'received']) {
          const value = element('dd');
          value.append(element('pre', finding[key]));
          values.append(element('dt', key === 'expected' ? 'Expected' : 'Received'), value);
        }
        row.append(values);
      }
      group.append(row);
    }
    reportArea.append(group);
  }
  output = (sampleMode ? `Input: built-in synthetic example (${sampleName}); not an observed AI output.\n\n` : '') + reportText(report);
  reportSample = sampleMode;
  byId('plain-report').value = output;
  controls.hidden = false;
  input.setAttribute('aria-invalid', String(report.status === 'invalid'));
  byId('report-title').focus();
  announce(report.status === 'invalid' ? 'JSON could not be compared. Review the input problem.' : title);
}

byId('compare').addEventListener('click', () => {
  if (!input.value.trim()) {
    clearReport('Paste a JSON response first, or load a clearly labeled synthetic example below the input.');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    announce('Paste a JSON response before comparing.');
    return;
  }
  track('start', sampleMode);
  const report = compareInvoice(input.value);
  showReport(report);
  if (report.status === 'match' || report.status === 'differences') track('complete', sampleMode);
});

input.addEventListener('input', () => {
  sampleRequest += 1;
  updateInputState();
  if (output || input.hasAttribute('aria-invalid')) clearReport('Your response changed. Compare again to generate a current report.');
  announce('');
});

byId('reset').addEventListener('click', () => {
  sampleRequest += 1;
  input.value = '';
  sampleMode = false;
  sampleName = '';
  byId('plain-report-detail').open = false;
  updateInputState();
  clearReport();
  announce('Exercise reset. Paste your own response when ready.');
  input.focus();
});

function confirmSampleReplace() {
  const dialog = byId('replace-response-dialog');
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'replace'), { once: true });
    dialog.showModal();
  });
}

byId('load-sample').addEventListener('click', async () => {
  if (input.value.trim() && !await confirmSampleReplace()) return;
  const request = ++sampleRequest;
  const button = byId('load-sample');
  const selected = byId('sample');
  const name = selected.options[selected.selectedIndex].text;
  const file = selected.value;
  button.disabled = true;
  button.textContent = 'Loading…';
  try {
    const response = await fetch(`./fixture/samples/${file}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Sample unavailable');
    const text = await response.text();
    if (request !== sampleRequest) return;
    input.value = text;
    sampleMode = true;
    sampleName = name;
    clearReport('Synthetic example loaded. Choose Compare response to inspect the prepared control.');
    updateInputState();
    input.focus();
    announce(`Loaded synthetic example: ${name}. Choose Compare response.`);
  } catch {
    if (request === sampleRequest) announce('The example could not be loaded. Try again, or paste your own JSON response.');
  } finally {
    button.disabled = false;
    button.textContent = 'Load example';
  }
});

async function copy(text, success, fallback, target = 'status') {
  try {
    await navigator.clipboard.writeText(text);
    announce(success, target);
    return true;
  } catch {
    announce(fallback, target);
    return false;
  }
}

byId('copy-prompt').addEventListener('click', async () => {
  const copied = await copy(byId('extraction-prompt').textContent, 'Extraction instruction copied.', 'Clipboard unavailable. Open the full instruction and select its text to copy.', 'preparation-status');
  if (!copied) byId('extraction-prompt').parentElement.open = true;
});

byId('copy-schema').addEventListener('click', async () => {
  const button = byId('copy-schema');
  button.disabled = true;
  try {
    const response = await fetch('./response-schema.json');
    if (!response.ok) throw new Error('Schema unavailable');
    await copy(await response.text(), 'JSON schema copied.', 'Clipboard unavailable. Use Download schema or open the schema link in the rules.', 'preparation-status');
  } catch { announce('The schema could not be loaded. Use the schema link in the comparison rules.', 'preparation-status'); }
  finally { button.disabled = false; }
});

byId('copy-report').addEventListener('click', async () => {
  if (!output) return;
  const text = output;
  const sample = reportSample;
  const copied = await copy(text, 'Report copied.', 'Clipboard unavailable. Select the plain-text report below or download it.');
  if (copied) track('copy', sample);
  else {
    byId('plain-report-detail').open = true;
    byId('plain-report').focus();
    byId('plain-report').select();
  }
});

byId('download-report').addEventListener('click', () => {
  if (!output) return;
  let url;
  try {
    url = URL.createObjectURL(new Blob([output], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ai-extraction-checkup-report.txt';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    track('export', reportSample);
    announce('Report download started. Check your browser’s downloads.');
  } catch { announce('The download could not be started. Copy the report or select its plain text instead.'); }
  finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 30000); }
});

byId('download-practice').addEventListener('click', () => track('practice_download'));
updateInputState();
