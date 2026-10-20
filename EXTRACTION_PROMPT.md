Extract the supplied synthetic practice invoice into one JSON object.
Return only JSON: no Markdown fences, commentary or extra fields.

Use these invoice-level fields:
invoice_id, invoice_date, currency, seller, buyer, line_items, subtotal,
discount_rate, discount_amount, taxable_amount, tax_rate, tax_amount,
shipping and total.

line_items must be an array. Each printed row needs these fields:
line_id, item_id, description, quantity, unit_price and line_total.
Preserve the printed line ID for each row; do not number rows again based
on their order. Use each JSON key only once per object.

Use JSON strings for all known scalar values, including IDs and numbers.
Preserve leading zeroes and meaningful characters in identifiers.
Use YYYY-MM-DD for the invoice date and the document's currency code.
Use two decimal places for money. Express percentage rates as decimal
fractions, such as "0.05" for 5%, without a percent sign.
Quantities are decimal strings without units.

Join wrapped description lines with spaces while preserving their words.
Keep each quantity, unit price and line total associated with its printed row.

For this exercise, discount_amount is the positive magnitude to subtract from
subtotal, even when the invoice displays the adjustment with a minus sign.
The relationship is subtotal minus discount_amount plus tax_amount plus
shipping equals total. Follow the document's stated tax/shipping rules.
Do not fill unreadable printed values by calculation or guesswork.

If a scalar value cannot be read, include that required field with null.
Do not explain it outside the JSON. A null flags uncertainty to the checker
and does not count as a successfully extracted value. Keep line_items as an
array; use null for an unreadable row field rather than inventing its contents.

Use only the practice source PDF/image as evidence. Do not consult its gold
answer or example response files. This is one educational exercise, not a
representative model benchmark.
