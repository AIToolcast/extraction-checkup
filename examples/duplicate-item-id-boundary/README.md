# When parsing can hide conflicting invoice item IDs

AI Toolcast ran this local QA example on November 18, 2026 using Node.js
v22.15.0 and Extraction Checkup comparison rules 1.0.0. The question is
whether a clean comparison can mask conflicting object members after a
workflow has parsed and saved the response.

The example uses the existing fictional invoice `synthetic-invoice-000147`.
For printed line `02`, it puts the checked item ID `0012` and the existing
changed-ID sample's `012` under two `item_id` members, then reverses the order.
Every other field and row stays as supplied. The checked answer returned
37 matching fields out of 37. [Checked answer](../../fixture/answer.json) ·
[Changed-ID sample](../../fixture/samples/changed_id.json)

| `item_id` values in original order | Original text in Checkup | After Node parses and saves the copy |
| --- | --- | --- |
| `012`, then `0012` | `duplicate_key`, matched count unavailable | Retains `0012`, 37 of 37 fields match |
| `0012`, then `012` | `duplicate_key`, matched count unavailable | Retains `012`, 36 of 37 fields match and one value differs |

The difference appears at `JSON.parse`. It retains one value, and
`JSON.stringify` writes that value once. In the first case, the copy has
exactly the same compact JSON bytes as the checked answer. Keep the original
response text and check it for repeated members before parsing where that
text is available. A match on the saved copy describes that copy.

[RFC 8259, section 4](https://www.rfc-editor.org/rfc/rfc8259.txt) recommends
unique names within an object and describes how implementations can differ.
The [ECMAScript specification](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.parse)
documents replacement of earlier values for repeated names by `JSON.parse`.
The [Checkup comparator](../../compare.mjs) checks the original text for
duplicates before comparing fields. This example identifies the actual
boundary in one Node run.

## Reproduce

From the Extraction Checkup repository root, with Node.js v22.15.0:

```sh
node examples/duplicate-item-id-boundary/run.mjs .
```

[result.json](result.json) records the execution timestamp, Node version,
fixture and source hashes, and both comparison results. The script reads
four local source and fixture files and prints JSON to standard output. The
timestamp varies on reproduction. The exact fixture and comparator files can
also be inspected at commit
[`5f3021f`](https://github.com/AIToolcast/extraction-checkup/tree/5f3021f59a2575c2be30fab90ef218f9dc1333f6).

## What this example covers

The [schema-versus-source guide](https://aitoolcast.com/articles/invoice-json-schema-valid-but-wrong-checkup-guide/)
shows why the shape and totals can agree while invoice values differ. This
example follows conflicting values through a parse-and-save step before
comparison. The [CSV identifier study](../csv-identifier-boundary/README.md)
looks at numeric type inference during CSV import. Here both item IDs stay
strings and the order of repeated members changes the result.

Scope is two constructed cases on one fixed fictional invoice. The run
used local deterministic QA, with no AI provider, n8n, other parser, customer
document, browser telemetry or performance test. AI Toolcast owns the free
Checkup exercise and used AI assistance to prepare and document this example.
