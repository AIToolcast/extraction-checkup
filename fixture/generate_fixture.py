"""Rebuild one original synthetic invoice and its answer sheets; no model calls."""
import copy
import csv
import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Table, TableStyle


ROOT = Path(__file__).resolve().parent
D = Decimal


def money(value):
    return str(value.quantize(D("0.01"), rounding=ROUND_HALF_UP))


gold = {
    "invoice_id": "000147",
    "invoice_date": "2026-10-19",
    "currency": "USD",
    "seller": "Synthetic Supplier A",
    "buyer": "Synthetic Customer B",
    "line_items": [
        {"line_id": "01", "item_id": "0008", "description": "Cable organizer set", "quantity": "2", "unit_price": "18.75", "line_total": "37.50"},
        {"line_id": "02", "item_id": "0012", "description": "Desk label holder set", "quantity": "3", "unit_price": "18.75", "line_total": "56.25"},
        {"line_id": "03", "item_id": "0031", "description": "Archival document sleeves, clear matte finish, A4 size, with reinforced edges and reusable label inserts (pack of 25).", "quantity": "1", "unit_price": "24.50", "line_total": "24.50"},
        {"line_id": "04", "item_id": "0104", "description": "Recycled note cards, blank (pack of 50)", "quantity": "5", "unit_price": "5.15", "line_total": "25.75"},
    ],
    "subtotal": "144.00",
    "discount_rate": "0.10",
    "discount_amount": "14.40",
    "taxable_amount": "129.60",
    "tax_rate": "0.08",
    "tax_amount": "10.37",
    "shipping": "7.50",
    "total": "147.47",
}


def check_math(data):
    for row in data["line_items"]:
        assert money(D(row["quantity"]) * D(row["unit_price"])) == row["line_total"]
    subtotal = sum(D(row["line_total"]) for row in data["line_items"])
    assert money(subtotal) == data["subtotal"]
    discount = D(money(subtotal * D(data["discount_rate"])))
    assert money(discount) == data["discount_amount"]
    taxable = subtotal - discount
    assert money(taxable) == data["taxable_amount"]
    tax = D(money(taxable * D(data["tax_rate"])))
    assert money(tax) == data["tax_amount"]
    assert money(taxable + tax + D(data["shipping"])) == data["total"]


def write_data(path, data):
    path.with_suffix(".json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    header = [key for key in data if key != "line_items"]
    fields = header + list(gold["line_items"][0])
    with path.with_suffix(".csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        for row in data["line_items"]:
            writer.writerow({**{key: data[key] for key in header}, **row})


def create_pdf():
    doc = canvas.Canvas(str(ROOT / "synthetic-invoice-000147.pdf"), pagesize=letter, invariant=1)
    doc.setTitle("Synthetic invoice 000147 - AI Toolcast extraction exercise")
    doc.setAuthor("AI Toolcast")
    ink, teal, muted = colors.HexColor("#152A35"), colors.HexColor("#006B70"), colors.HexColor("#4C5E68")
    doc.setFillColor(teal)
    doc.rect(42, 733, 528, 25, fill=1, stroke=0)
    doc.setFillColor(colors.white)
    doc.setFont("Helvetica-Bold", 9)
    doc.drawString(53, 741, "SYNTHETIC DOCUMENT  |  NOT A REAL TRANSACTION  |  NO PAYMENT DUE")
    doc.setFillColor(teal)
    doc.setFont("Helvetica-Bold", 11)
    doc.drawString(42, 707, "AI TOOLCAST")
    doc.setFillColor(muted)
    doc.setFont("Helvetica", 9)
    doc.drawString(42, 691, "Original extraction exercise / one-page invoice")
    doc.setFillColor(ink)
    doc.setFont("Helvetica-Bold", 27)
    doc.drawRightString(570, 701, "INVOICE")
    doc.setFont("Helvetica-Bold", 10)
    doc.drawString(42, 653, "FROM")
    doc.drawString(240, 653, "BILL TO")
    doc.setFont("Helvetica", 11)
    doc.drawString(42, 634, gold["seller"])
    doc.drawString(240, 634, gold["buyer"])
    doc.setFillColor(muted)
    doc.setFont("Helvetica", 9)
    doc.drawString(42, 618, "Fictional seller for this exercise")
    doc.drawString(240, 618, "Fictional buyer for this exercise")
    doc.setFillColor(ink)
    doc.setFont("Helvetica", 10)
    doc.drawString(42, 584, "Invoice ID: " + gold["invoice_id"])
    doc.drawString(240, 584, "Invoice date: " + gold["invoice_date"])
    doc.drawRightString(570, 584, "Currency: USD")

    style = ParagraphStyle("item", fontName="Helvetica", fontSize=9.5, leading=13, textColor=ink)
    table_rows = [["No.", "Item ID", "Description", "Qty", "Unit USD", "Line USD"]]
    for row in gold["line_items"]:
        table_rows.append([row["line_id"], row["item_id"], Paragraph(row["description"], style), row["quantity"], row["unit_price"], row["line_total"]])
    table = Table(table_rows, colWidths=[28, 50, 240, 40, 80, 90])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ink), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5), ("LEADING", (0, 0), (-1, -1), 13),
        ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("ALIGN", (3, 0), (-1, -1), "RIGHT"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#F1F6F7"), colors.white]),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, colors.HexColor("#D7E0E3")),
    ]))
    _, table_height = table.wrap(528, 240)
    table.drawOn(doc, 42, 561 - table_height)
    summary_top = 561 - table_height - 26
    summary = [
        ("Line-item subtotal", "144.00"), ("Discount (10% of subtotal)", "-14.40"),
        ("Taxable amount", "129.60"), ("Tax (8% of taxable amount)", "10.37"),
        ("Shipping (not taxable)", "7.50"),
    ]
    doc.setFillColor(ink)
    for index, (label, value) in enumerate(summary):
        y = summary_top - index * 19
        doc.setFont("Helvetica", 10)
        doc.drawString(342, y, label)
        doc.drawRightString(564, y, value)
    total_y = summary_top - 113
    doc.setFillColor(teal)
    doc.rect(332, total_y - 9, 238, 29, fill=1, stroke=0)
    doc.setFillColor(colors.white)
    doc.setFont("Helvetica-Bold", 12)
    doc.drawString(342, total_y, "TOTAL USD")
    doc.drawRightString(560, total_y, gold["total"])

    note_style = ParagraphStyle("note", fontName="Helvetica", fontSize=9.5, leading=13, textColor=muted)
    notes = [
        "<b>Calculation rules</b>",
        "Discount applies to the line-item subtotal. Tax applies to the discounted subtotal only. Shipping is not taxable. Round each discount and tax amount to two decimal places, half up.",
        "144.00 - 14.40 = 129.60; 129.60 x 8% = 10.368, rounded to 10.37.<br/>129.60 + 10.37 + 7.50 = <b>USD 147.47</b>.",
    ]
    note_y = total_y - 35
    for text in notes:
        paragraph = Paragraph(text, note_style)
        _, height = paragraph.wrap(528, 100)
        paragraph.drawOn(doc, 42, note_y - height)
        note_y -= height + 7
    assert note_y > 65, "Invoice content would collide with footer"
    doc.setStrokeColor(colors.HexColor("#D7E0E3"))
    doc.line(42, 54, 570, 54)
    doc.setFont("Helvetica", 8)
    doc.setFillColor(muted)
    doc.drawString(42, 39, "Synthetic training material. All parties and transactions are fictional.")
    doc.drawRightString(570, 39, "Page 1 of 1")
    doc.showPage()
    doc.save()


if __name__ == "__main__":
    check_math(gold)
    assert len(gold["line_items"]) == 4
    assert len({row["line_id"] for row in gold["line_items"]}) == 4
    write_data(ROOT / "gold", gold)
    schema = {"$schema": "https://json-schema.org/draft/2020-12/schema", "title": "Synthetic invoice extraction", "type": "object", "additionalProperties": False, "required": list(gold), "properties": {key: {"type": "string"} for key in gold if key != "line_items"}}
    schema["properties"]["line_items"] = {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": list(gold["line_items"][0]), "properties": {key: {"type": "string"} for key in gold["line_items"][0]}}}
    (ROOT / "schema.json").write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
    samples = {"identical_correct": copy.deepcopy(gold)}
    for name in ("missing_last_row", "changed_id", "swapped_quantities", "wrong_total", "harmless_whitespace_row_reorder"):
        samples[name] = copy.deepcopy(gold)
    samples["missing_last_row"]["line_items"].pop()
    samples["changed_id"]["line_items"][1]["item_id"] = "012"
    swapped = samples["swapped_quantities"]["line_items"]
    swapped[0]["quantity"], swapped[1]["quantity"] = swapped[1]["quantity"], swapped[0]["quantity"]
    for row in swapped[:2]:
        row["line_total"] = money(D(row["quantity"]) * D(row["unit_price"]))
    check_math(samples["swapped_quantities"])
    samples["wrong_total"]["total"] = "147.57"
    harmless = samples["harmless_whitespace_row_reorder"]
    harmless["line_items"].reverse()
    harmless["line_items"][1]["description"] = "  " + harmless["line_items"][1]["description"].replace(", ", ",\n  ") + "  "
    harmless["seller"] = "  Synthetic   Supplier A  "
    (ROOT / "samples").mkdir(exist_ok=True)
    for name, data in samples.items():
        write_data(ROOT / "samples" / name, data)
    create_pdf()
    print("Created one synthetic PDF, gold JSON/CSV, schema, and six controlled JSON/CSV cases. Arithmetic self-check passed.")
