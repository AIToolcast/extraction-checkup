# Where the identifier changed: CSV import

AI Toolcast ran this local exercise on November 4, 2026 using Python 3.11.8
and the already-installed pandas 2.2.3. It projects three identifier columns
from the repository's existing fictional invoice answer. It adds no invoice,
checker feature, model call or product release. The preparation and reporting
were AI-assisted; all execution was internal QA.

## Recorded result

The source invoice identifier is the string `000147`. Both CSV encodings
retained those six digits. Python's ordinary CSV reader returned the original
strings. pandas' default C parser inferred integer columns and returned `147`.
Quoting every field did not prevent that conversion. An explicit `string`
dtype at import retained the original identifiers. Converting the numeric
result to strings afterward returned `"147"`, not `"000147"`.

| Boundary, first row | invoice_id | line_id | item_id |
| --- | --- | --- | --- |
| Original strings / CSV lexical fields | `000147` | `01` | `0008` |
| pandas default import, integers | `147` | `1` | `8` |
| Default import, then `astype(str)` | `"147"` | `"1"` | `"8"` |
| Explicit text dtype during import | `"000147"` | `"01"` | `"0008"` |

This happened with both minimal quoting and all fields quoted. Each input
contained four rows and three identifier columns: 12 cell occurrences,
including the repeated invoice identifier, not 12 distinct identifiers.
All 12 differed after default import; all 12 matched after explicit text import.
The CSV bytes and lexical readback were checked before either pandas import.
The first observed value change was therefore at pandas import in this run,
not in JSON parsing or CSV serialization. This is expected type inference,
not evidence of a pandas defect or an extraction-model error.

## Reproduce

With Python and pandas available, run from the repository root:

```sh
python examples/csv-identifier-boundary/run.py --fixture fixture/answer.json
```

The script reads the fixture and prints JSON. It makes no network calls or
file writes. It reports the actual installed versions rather than installing
or upgrading dependencies. [result.json](result.json) is the recorded run;
timestamps will differ on reproduction. Its input SHA-256 is
`64b2e86135b40018acd2282cadc5786c85c03eaf6da953a9586623a4294cb2a4`.

The relevant import setting in this exercise is:

```python
pd.read_csv(source, dtype={
    "invoice_id": "string", "line_id": "string", "item_id": "string"
})
```

Keep the original response and exported bytes when diagnosing a mismatch.
Check the value and type at each boundary before assigning the cause to
extraction. Choosing identifier columns as text is an import decision;
padding a converted value afterward requires an independently known format
and is not a general recovery method.

## Scope and sources

The input is the known synthetic answer, not an AI-produced extraction.
No Excel, SAP, Pretix, Abacus, AI provider, alternate pandas version or engine
was tested. Missing values, numeric precision, general invoices, speed and
customer behavior were not tested. The Python documentation's dialect name
`excel` does not mean Excel was run. This exercise does not change Checkup's
one-invoice contract or establish paid demand.

The [pandas 2.2.3 read_csv documentation](https://pandas.pydata.org/pandas-docs/version/2.2.3/reference/api/pandas.read_csv.html)
describes column dtypes separately from CSV quoting and missing-value settings.
The [Python 3.11 CSV documentation](https://docs.python.org/3.11/library/csv.html)
describes ordinary reader fields as strings and the writer's quoting options.
The fixture provenance is in [fixture/README.md](../../fixture/README.md).
Documentation supports the method; the recorded output supports this result.

Unlike the earlier schema-versus-source Guide, this exercise follows unchanged
identifiers across a downstream serialization/import boundary. It does not
repeat the prepared changed-ID control or score any model.
