"""Focused Chromium checks for the fixed browser exercise.

Run: python products/extraction-checkup/tests/browser_ui.py
Uses the development machine's existing Playwright installation; the tool
itself has no runtime package dependencies. Tracking is stubbed to inspect
the UI event contract; this does not verify a deployed collection service.
"""
import hashlib
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
TRACKER = """
window.__usageEvents = [];
export function createUsageTracker(options) {
  window.__usageOptions = options;
  return { event(name, options = {}) { window.__usageEvents.push({name, ...options}); } };
}
"""


def main():
    class QuietHandler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    original = (ROOT / "fixture/answer.json").read_text(encoding="utf-8")
    answer = json.loads(original)
    prompt = (ROOT / "EXTRACTION_PROMPT.md").read_text(encoding="utf-8")
    assert hashlib.sha256((ROOT / "fixture/synthetic-invoice-000147.pdf").read_bytes()).hexdigest() == "891891c327d0f6f8a19f23ddf50c02c770f598539739b7fd586f42b9e62da7f8"
    try:
        with sync_playwright() as playwright, TemporaryDirectory() as temporary:
            browser = playwright.chromium.launch()
            context = browser.new_context(permissions=["clipboard-read", "clipboard-write"], viewport={"width": 1440, "height": 1050})
            context.route("**/usage.mjs", lambda route: route.fulfill(content_type="text/javascript", body=TRACKER))
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(base + "/?qa=1")
            expect(page.locator("#report")).to_have_attribute("data-state", "empty")
            expect(page.locator("#copy-report")).to_be_hidden()
            page.locator("#compare").click()
            expect(page.locator("#response")).to_be_focused()
            assert page.evaluate("window.__usageEvents") == []

            page.locator("#copy-prompt").click()
            expect(page.locator("#preparation-status")).to_have_text("Extraction instruction copied.")
            assert page.locator("#extraction-prompt").text_content() == prompt
            assert page.evaluate("navigator.clipboard.readText()").replace("\r\n", "\n") == prompt
            page.locator("#copy-schema").click()
            expect(page.locator("#preparation-status")).to_have_text("JSON schema copied.")
            assert json.loads(page.evaluate("navigator.clipboard.readText()")) == json.loads((ROOT / "response-schema.json").read_text(encoding="utf-8"))
            with page.expect_download() as pending:
                page.locator("#download-practice").click()
            download = pending.value
            destination = Path(temporary) / download.suggested_filename
            download.save_as(destination)
            assert destination.read_bytes() == (ROOT / "fixture/synthetic-invoice-000147.pdf").read_bytes()

            page.locator("#response").fill(original)
            page.locator("#compare").click()
            expect(page.locator("#report")).to_have_attribute("data-state", "match")
            expect(page.locator("#report-title")).to_be_focused()
            expect(page.locator("#report")).to_contain_text("All 37 fields match")
            page.locator("#copy-report").click()
            expect(page.locator("#status")).to_have_text("Report copied.")
            exported = page.evaluate("navigator.clipboard.readText()")
            assert "Result: match" in exported and "Rules: 1.0.0" in exported
            with page.expect_download() as pending:
                page.locator("#download-report").click()
            downloaded = Path(temporary) / pending.value.suggested_filename
            pending.value.save_as(downloaded)
            assert downloaded.read_text(encoding="utf-8") == exported.replace("\r\n", "\n")

            page.locator("#response").fill('{"bad":')
            expect(page.locator("#report-controls")).to_be_hidden()
            before = page.evaluate("window.__usageEvents.filter(event => event.name === 'complete').length")
            page.locator("#compare").click()
            expect(page.locator("#report")).to_have_attribute("data-state", "invalid")
            expect(page.locator("#report")).to_contain_text("No field values were judged")
            assert page.evaluate("window.__usageEvents.filter(event => event.name === 'complete').length") == before

            changed = dict(answer, seller='<img src="https://example.invalid/private" onerror="window.__injected=true">', total=None, discount_amount="-14.40")
            page.locator("#response").fill(json.dumps(changed))
            page.locator("#compare").click()
            for label in ["Value differences (1)", "Missing or uncertain (1)", "Format and representation (1)"]:
                expect(page.locator("#report")).to_contain_text(label)
            expect(page.locator("#report")).to_contain_text(json.dumps(changed["seller"]))
            assert page.locator("#report img").count() == 0
            assert not page.evaluate("Boolean(window.__injected)")
            assert page.locator("#report dt").all_text_contents() == ["Expected", "Received"] * 3

            page.locator(".sample-picker summary").click()
            samples = {"identical_correct": "match", "harmless_whitespace_row_reorder": "match", "missing_last_row": "differences", "changed_id": "differences", "swapped_quantities": "differences", "wrong_total": "differences"}
            for sample, state in samples.items():
                page.locator("#sample").select_option(sample)
                page.locator("#load-sample").click()
                expect(page.locator("#input-source")).to_have_attribute("data-sample", "true")
                expect(page.locator("#report")).to_have_attribute("data-state", "empty")
                page.locator("#compare").click()
                expect(page.locator("#report")).to_have_attribute("data-state", state)
                expect(page.locator("#report")).to_contain_text("not an observed AI result")
            page.locator("#copy-report").click()
            expect(page.locator("#status")).to_have_text("Report copied.")
            assert "built-in synthetic example" in page.evaluate("navigator.clipboard.readText()")
            with page.expect_download() as pending:
                page.locator("#download-report").click()
            assert pending.value.failure() is None
            events = page.evaluate("window.__usageEvents")
            assert {event["name"] for event in events} == {"practice_download", "start", "complete", "copy", "export"}
            assert all(set(event) == {"name", "sample"} for event in events)
            assert all(event["sample"] for event in events[-4:])

            page.locator("#reset").click()
            expect(page.locator("#response")).to_have_value("")
            expect(page.locator("#report-controls")).to_be_hidden()
            expect(page.locator("#input-source")).to_have_attribute("data-sample", "false")
            page.locator("#response").fill("x" * 65537)
            page.locator("#compare").click()
            expect(page.locator("#report")).to_have_attribute("data-state", "invalid")
            expect(page.locator("#report")).to_contain_text("65536 characters")

            # Keyboard focus remains visible; native disclosures and controls work.
            page.locator("#reset").focus()
            page.keyboard.press("Enter")
            expect(page.locator("#response")).to_be_focused()
            assert page.locator("#reset").evaluate("node => getComputedStyle(node).outlineStyle") != "none" or page.locator("#response").evaluate("node => getComputedStyle(node).outlineStyle") != "none"
            for width in [1440, 390, 320]:
                page.set_viewport_size({"width": width, "height": 900})
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"horizontal overflow at {width}px"
                assert page.locator("#compare").bounding_box()["height"] >= 44

            # A missing measurement module and blocked clipboard cannot break comparison.
            fallback = context.new_page()
            fallback.route("**/usage.mjs", lambda route: route.abort())
            fallback.goto(base + "/?qa=1")
            fallback.locator("#response").fill(original)
            fallback.locator("#compare").click()
            expect(fallback.locator("#report")).to_have_attribute("data-state", "match")
            fallback.evaluate("() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard blocked'); }; }")
            fallback.locator("#copy-report").click()
            expect(fallback.locator("#plain-report-detail")).to_have_attribute("open", "")
            expect(fallback.locator("#plain-report")).to_be_focused()
            expect(fallback.locator("#status")).to_contain_text("Clipboard unavailable")
            fallback.close()
            assert not errors, errors
            browser.close()
        print("Browser UI checks passed: controls, six samples, safe findings, clipboard/download contents, event arguments, reset, keyboard, 1440/390/320px layouts and tracking/clipboard failure recovery.")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
