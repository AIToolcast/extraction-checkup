# Synthetic practice invoice

AI Toolcast created this fictional invoice and checked its printed values and
arithmetic. It is an educational fixture, not a real customer's invoice or a
representative extraction benchmark. The four rows total USD 147.47 after
the stated discount, tax and shipping rules.

- `synthetic-invoice-000147.pdf`: original practice source.
- `synthetic-invoice-000147.png`: rendered image of that source.
- `answer.json`: checked answer for the fixed exercise.
- `samples/*.json`: six deliberately prepared comparison controls, not AI outputs.

The extraction instruction in `../EXTRACTION_PROMPT.md` defines the positive
discount magnitude, date, identifier and decimal representation expected by
this version of the exercise. Do not consult the answer or controls before
an extraction if you want a blind exercise.

Original PDF SHA-256:
`891891c327d0f6f8a19f23ddf50c02c770f598539739b7fd586f42b9e62da7f8`

Original answer JSON SHA-256:
`64b2e86135b40018acd2282cadc5786c85c03eaf6da953a9586623a4294cb2a4`

The original generation source is included as generate_fixture.py. It uses
Python Decimal arithmetic and ReportLab to regenerate the source and original
gold/control files. Run it in a separate scratch copy: it writes generated
files beside itself. The browser checker needs neither Python nor ReportLab.
