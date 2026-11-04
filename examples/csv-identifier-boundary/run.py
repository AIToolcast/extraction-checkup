"""Trace the existing synthetic invoice identifiers through CSV and pandas.

Reads one fixture, prints JSON, and makes no network calls or file writes.
This is a local serialization/import exercise, not an AI or Excel test.
"""
import argparse
import csv
import hashlib
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--fixture", type=Path, required=True)
args = parser.parse_args()
raw = args.fixture.read_bytes()
answer = json.loads(raw)
columns = ["invoice_id", "line_id", "item_id"]
rows = [{"invoice_id": answer["invoice_id"], "line_id": row["line_id"],
         "item_id": row["item_id"]} for row in answer["line_items"]]
assert len(rows) == 4 and all(isinstance(v, str) for row in rows for v in row.values())

cases = []
for name, quoting in [("minimal", csv.QUOTE_MINIMAL), ("all_fields", csv.QUOTE_ALL)]:
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=columns, quoting=quoting, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    text = stream.getvalue()
    lexical = list(csv.DictReader(io.StringIO(text)))
    with pd.read_csv(io.StringIO(text), iterator=True) as reader:
        engine = reader.engine
        default = reader.read()
    explicit = pd.read_csv(io.StringIO(text), dtype={column: "string" for column in columns})
    default_rows = default.to_dict("records")
    explicit_rows = explicit.to_dict("records")
    posthoc_rows = default.astype(str).to_dict("records")
    differences = [{"row": i + 1, "column": column, "source": source[column],
                    "imported": imported[column], "after_astype_str": later[column]}
                   for i, (source, imported, later) in enumerate(zip(rows, default_rows, posthoc_rows))
                   for column in columns if source[column] != str(imported[column])]
    assert lexical == rows, "CSV serialization changed an identifier"
    assert explicit_rows == rows, "Explicit text import changed an identifier"
    assert len(differences) == 12, "Observed default import differs from recorded expectation"
    assert posthoc_rows != rows, "Unexpected recovery of source identifiers after numeric import"
    cases.append({"quoting": name, "csv_text": text,
                  "csv_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                  "stdlib_reader_records": lexical, "pandas_default_engine": engine,
                  "pandas_default_dtypes": {k: str(v) for k, v in default.dtypes.items()},
                  "pandas_default_records": default_rows,
                  "pandas_explicit_dtypes": {k: str(v) for k, v in explicit.dtypes.items()},
                  "pandas_explicit_records": explicit_rows,
                  "post_import_astype_str_records": posthoc_rows,
                  "identifier_differences": differences})

print(json.dumps({"executed_at": datetime.now(timezone.utc).isoformat(),
                  "python_version": sys.version.split()[0], "pandas_version": pd.__version__,
                  "fixture_sha256": hashlib.sha256(raw).hexdigest(),
                  "source_records": rows, "cases": cases,
                  "scope": "One unchanged synthetic invoice; three identifier columns, four rows. All activity is QA.",
                  "not_tested": ["AI extraction", "Excel", "SAP", "other pandas versions or engines",
                                 "missing values", "general invoices", "performance", "external use"]}, indent=2))
