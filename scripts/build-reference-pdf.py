"""Create the standard service reference PDF from docs/service-reference.json.

Requires reportlab and pypdf. Run from the CLI checkout with Python 3.9+ and
Node.js 18+, which generates each example upstream request from lib/api.js.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from html import escape
from pathlib import Path
from urllib.parse import urlsplit

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
NAVY = colors.HexColor("#142C40")
TEAL = colors.HexColor("#087F8C")
INK = colors.HexColor("#24394A")
MUTED = colors.HexColor("#5F7181")
LIGHT = colors.HexColor("#F1F6F8")
RULE = colors.HexColor("#D8E3E9")


def upstream_requests(inputs):
    """Return the request lib/api.js sends for each service input, without network access."""
    environment = {
        key: value
        for key, value in os.environ.items()
        if key not in {"MRSCRAPER_API_BASE_URL", "MRSCRAPER_FETCH_BASE_URL"}
    }
    result = subprocess.run(
        ["node", str(ROOT / "scripts/upstream-requests.mjs")],
        input=json.dumps(inputs),
        capture_output=True,
        text=True,
        check=True,
        cwd=ROOT,
        env=environment,
    )
    return json.loads(result.stdout)


def request_text(request):
    """Show a request with one query field per line, followed by its authentication header."""
    parts = urlsplit(request["url"])
    lines = [f"{request['method']} {parts.scheme}://{parts.netloc}{parts.path}"]
    for index, field in enumerate(parts.query.split("&") if parts.query else []):
        lines.append(("  ?" if index == 0 else "  &") + field)
    lines.append("x-api-token: <API key>")
    if request["body"]:
        lines += ["", request["body"]]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "output/pdf/file.pdf")
    args = parser.parse_args()
    reference = json.loads((ROOT / "docs/service-reference.json").read_text())
    parameters = reference["parameters"]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    font_root = Path("/System/Library/Fonts/Supplemental")
    if (font_root / "Arial.ttf").exists():
        pdfmetrics.registerFont(TTFont("Reference", str(font_root / "Arial.ttf")))
        pdfmetrics.registerFont(
            TTFont("ReferenceBold", str(font_root / "Arial Bold.ttf"))
        )
        regular, bold = "Reference", "ReferenceBold"
    else:
        regular, bold = "Helvetica", "Helvetica-Bold"
    styles = getSampleStyleSheet()
    for name, size, leading, color, after in [
        ("BodyRef", 10, 14, INK, 7),
        ("SmallRef", 8.4, 11.4, MUTED, 5),
        ("TableRef", 8.5, 11.2, INK, 0),
        ("TableHeadRef", 8.2, 10.5, colors.white, 0),
        ("SectionRef", 12, 16, NAVY, 8),
        ("TitleRef", 28, 32, NAVY, 14),
        ("ServiceRef", 23, 28, NAVY, 10),
        ("KickerRef", 8.5, 11, TEAL, 7),
        ("CodeRef", 8.2, 11, INK, 0),
    ]:
        styles.add(
            ParagraphStyle(
                name,
                fontName=bold
                if name
                in {"TableHeadRef", "SectionRef", "TitleRef", "ServiceRef", "KickerRef"}
                else ("Courier" if name == "CodeRef" else regular),
                fontSize=size,
                leading=leading,
                textColor=color,
                spaceAfter=after,
                alignment=TA_LEFT,
                keepWithNext=name
                in {"SectionRef", "TitleRef", "ServiceRef", "KickerRef"},
            )
        )
    styles.add(
        ParagraphStyle(
            "TableKeyRef", parent=styles["TableRef"], fontName=bold, textColor=NAVY
        )
    )
    # Long request URLs have no spaces, so this style may break lines anywhere.
    styles.add(ParagraphStyle("CodeWrapRef", parent=styles["CodeRef"], wordWrap="CJK"))

    def p(text, style="BodyRef"):
        return Paragraph(escape(str(text)), styles[style])

    def table(rows, widths, header=True, compact=False):
        formatted = [
            [
                p(cell, "TableHeadRef" if header and index == 0 else "TableRef")
                for cell in row
            ]
            for index, row in enumerate(rows)
        ]
        result = Table(
            formatted, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT"
        )
        commands = [
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 3 if compact else 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3 if compact else 4),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, RULE),
        ]
        if header:
            commands += [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
            ]
        result.setStyle(TableStyle(commands))
        return result

    def details(rows):
        """Two-column key and value table for a service's upstream request."""
        result = Table(
            [[p(key, "TableKeyRef"), p(value, "TableRef")] for key, value in rows],
            colWidths=[112, 393],
            hAlign="LEFT",
        )
        result.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 7),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ("ROWBACKGROUNDS", (0, 0), (-1, -1), [LIGHT, colors.white]),
                    ("BOX", (0, 0), (-1, -1), 0.5, RULE),
                ]
            )
        )
        return result

    def code(text, wrap=False):
        content = Paragraph(
            escape(text).replace("\n", "<br/>").replace("  ", "&nbsp;&nbsp;"),
            styles["CodeWrapRef" if wrap else "CodeRef"],
        )
        result = Table([[content]], colWidths=[505])
        result.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
                    ("BOX", (0, 0), (-1, -1), 0.5, RULE),
                    ("LEFTPADDING", (0, 0), (-1, -1), 10),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ("TOPPADDING", (0, 0), (-1, -1), 9),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                ]
            )
        )
        return result

    def header(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(RULE)
        canvas.line(45, A4[1] - 40, A4[0] - 45, A4[1] - 40)
        canvas.setFont(bold, 8)
        canvas.setFillColor(TEAL)
        canvas.drawString(45, A4[1] - 28, "MRSCRAPER / STANDARD SERVICE REFERENCE")
        canvas.setFillColor(MUTED)
        canvas.setFont(regular, 8)
        canvas.drawString(45, 27, "Reference v1.2  |  24 November 2026")
        canvas.drawRightString(A4[0] - 45, 27, f"{doc.page:02d}")
        canvas.restoreState()

    doc = BaseDocTemplate(
        str(args.output),
        pagesize=A4,
        leftMargin=45,
        rightMargin=45,
        topMargin=55,
        bottomMargin=45,
        title="MrScraper - Standard Service Reference",
        author="MrScraper",
        subject="Standard descriptions, parameter types, defaults, upstream requests, and naming across the CLI, SDKs, and integrations.",
    )
    doc.addPageTemplates(
        [
            PageTemplate(
                id="Reference",
                frames=[
                    Frame(
                        45,
                        45,
                        505,
                        A4[1] - 100,
                        leftPadding=0,
                        rightPadding=0,
                        topPadding=0,
                        bottomPadding=0,
                    )
                ],
                onPage=header,
            )
        ]
    )
    story = [
        Spacer(1, 12),
        p("PUBLIC DOCUMENTATION STANDARD", "KickerRef"),
        p("Seven services.\nOne description standard.", "TitleRef"),
        p(
            "Canonical function and parameter descriptions for the CLI, Python SDK, Node SDK, LangChain integration, and MCP server, with the upstream API request each service sends."
        ),
        Spacer(1, 8),
        p("Service directory", "SectionRef"),
    ]
    rows = [["Service", "Standard description"]]
    for service in reference["services"]:
        rows.append([service["title"], service["description"]])
    story += [
        table(rows, [98, 407]),
        Spacer(1, 15),
        p("How to use this reference", "SectionRef"),
        p(
            "Copy the description text exactly for the same service and parameter. Adapt only names, language-specific types, authentication setup, and example syntax. Parameter defaults and meanings stay the same."
        ),
        p(
            "All sample target URLs use https://example.com. Function and parameter naming equivalents are listed at the end of this reference."
        ),
        p(reference["response_examples_note"], "SmallRef"),
        p(
            "Screenshot has three service-specific forms: full (default), top, or a custom viewport for Get screenshot; the same values or false for Scrape HTML; and a boolean for JSON extraction. These forms have distinct descriptions because their types and meanings differ.",
            "SmallRef",
        ),
        p(
            "Each service adds its documented fixed request fields automatically: html=true and markdown=false (plus browserRendering=true when a screenshot is set), markdown=true with html=false and screenshot=false, browserRendering=true with html=false and markdown=false for screenshots, action=brand-scraping with bundle=none, agent=general, and action=websearch. HTML, Markdown, screenshots, and JSON extraction always send saveResult=true, and tokenCap is never sent. Fixed fields are not service parameters.",
            "SmallRef",
        ),
    ]
    examples = {
        "status": {},
        "scrape-html": {
            "url": "https://example.com",
            "browserRendering": True,
            "warmStart": True,
            "waitForSelector": "body",
            "timeout": 120,
        },
        "scrape-markdown": {
            "url": "https://example.com",
            "warmStart": True,
            "maxAge": 86400000,
        },
        "get-screenshot": {
            "url": "https://example.com",
            "screenshot": "top",
            "timeout": 120,
        },
        "scrape-brand": {"url": "https://example.com"},
        "scrape-json": {
            "url": "https://example.com",
            "prompt": 'Extract the first 2 items with title and price. Json Schema: {"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"price":{"type":"string"}},"required":["title","price"]}}',
            "browserRendering": True,
        },
        "web-search": {
            "query": "site:example.com documentation",
            "country": "id",
            "numResults": 20,
        },
    }
    upstream = upstream_requests(examples)
    scraper = "GET https://api.mrscraper.com/"
    endpoints = {
        "status": {
            "request": "GET https://api.app.mrscraper.com/api/v1/subscription-accounts",
            "fixed": "None",
            "query": "None",
            "notes": "Returns the raw account record from the platform API.",
        },
        "scrape-html": {
            "request": scraper,
            "fixed": "html=true, markdown=false, saveResult=true; browserRendering=true when a screenshot is set",
            "query": "url, html=true, markdown=false, [browserRendering], timeout, warmStart, blockResources, [waitForSelector], [geoCode], saveResult=true, maxAge, [maxRetries], screenshot",
            "notes": "A screenshot other than false also sends browserRendering=true, and the response becomes JSON with html and screenshot.",
        },
        "scrape-markdown": {
            "request": scraper,
            "fixed": "markdown=true, html=false, screenshot=false, saveResult=true",
            "query": "url, markdown=true, html=false, screenshot=false, [browserRendering], timeout, warmStart, blockResources, [waitForSelector], [geoCode], saveResult=true, maxAge, [maxRetries]",
        },
        "get-screenshot": {
            "request": scraper,
            "fixed": "html=false, markdown=false, browserRendering=true, saveResult=true",
            "query": "url, screenshot, html=false, markdown=false, browserRendering=true, timeout, [waitForSelector], [geoCode], saveResult=true, maxAge, [maxRetries]",
            "notes": "screenshot is full unless set to top or a WIDTHxHEIGHT[-ZOOM] viewport. The API still includes the page HTML.",
        },
        "scrape-brand": {
            "request": scraper,
            "fixed": "action=brand-scraping, bundle=none",
            "query": "action=brand-scraping, url, bundle=none",
            "notes": "Page controls are not accepted.",
        },
        "scrape-json": {
            "request": scraper
            + "; POST https://api.mrscraper.com/ when the encoded GET URL is longer than 8,000 characters",
            "fixed": "agent=general, saveResult=true",
            "query": "url, prompt, agent=general, html, [browserRendering], timeout, warmStart, blockResources, [waitForSelector], [geoCode], saveResult=true, maxAge, [maxRetries], screenshot",
            "notes": "For POST, url, prompt, and agent move to a JSON body (Content-Type: application/json), and the other fields stay in the query string.",
        },
        "web-search": {
            "request": scraper,
            "fixed": "action=websearch",
            "query": "action=websearch, query, [country], numResults",
            "notes": "country is omitted unless set.",
        },
    }
    rows = [["Service", "Upstream request", "Fixed fields"]]
    for service in reference["services"]:
        endpoint = endpoints[service["name"]]
        rows.append([service["title"], endpoint["request"], endpoint["fixed"]])
    story += [
        Spacer(1, 8),
        p("Upstream endpoints", "SectionRef"),
        p(
            "Status calls the platform API. The six scraping and search services call the Scraper API with query parameters. Each service page lists the full request, its field order, and an example request generated from the CLI code."
        ),
        table(rows, [86, 258, 161]),
        Spacer(1, 6),
        p(
            "Authentication: every request sends the API key in the x-api-token header, never in the URL; the CLI and SDKs also send it as Authorization: Bearer. In the field lists, brackets mark fields sent only when set, and fields shown with a value are fixed.",
            "SmallRef",
        ),
    ]
    for index, service in enumerate(reference["services"], 1):
        story += [
            PageBreak(),
            p(f"SERVICE {index:02d} / {service['name']}", "KickerRef"),
            p(service["title"], "ServiceRef"),
            p(service["description"]),
            Spacer(1, 4),
            p("Parameters", "SectionRef"),
        ]
        if service["parameters"]:
            rows = [["Parameter", "Type", "Default", "Standard description"]]
            for key in service["parameters"]:
                field = parameters[key]
                value = service["defaults"].get(field["name"], field["default"])
                default = (
                    "Required"
                    if field["required"]
                    else ("Omitted" if value is None else json.dumps(value))
                )
                rows.append(
                    [field["name"], field["type"], default, field["description"]]
                )
            story += [table(rows, [91, 48, 101, 265])]
        else:
            story += [
                p(
                    "No service parameters. Authentication is configured outside the service input."
                ),
                p("Authentication", "SectionRef"),
                p(parameters["token"]["description"]),
                p(
                    "The CLI and Node SDK can override an API key for one call. Python and LangChain configure credentials on the client or tool. MCP authenticates through the connection and does not accept token as a tool argument."
                ),
            ]
        endpoint = endpoints[service["name"]]
        deadline = (
            f"{service['transport_timeout_seconds']} seconds, fixed; not a service parameter"
            if service["transport_timeout_seconds"] is not None
            else "timeout + 30 seconds"
        )
        rows = [
            ("Request", endpoint["request"]),
            ("Authentication", "x-api-token header; never in the URL"),
            ("Query fields, in order", endpoint["query"]),
            ("HTTP deadline", deadline),
        ]
        if "notes" in endpoint:
            rows.append(("Notes", endpoint["notes"]))
        story += [
            Spacer(1, 9),
            p("Upstream endpoint", "SectionRef"),
            details(rows),
            Spacer(1, 9),
            p("Example input", "SectionRef"),
            code(json.dumps(examples[service["name"]], indent=2)),
            Spacer(1, 9),
            p("Example request", "SectionRef"),
            code(request_text(upstream[service["name"]]), wrap=True),
            Spacer(1, 10),
        ]
        for example_index, example in enumerate(service["response_examples"]):
            response_block = [
                p("Response - " + service["title"], "SectionRef"),
            ]
            if example_index == 0:
                response_block.append(p(service["response"]))
            response_block += [
                p(example["label"], "SmallRef"),
                code(json.dumps(example["value"], indent=2)),
                Spacer(1, 8),
            ]
            story.append(KeepTogether(response_block))
    story += [
        PageBreak(),
        p("CROSS-SURFACE NAMING", "KickerRef"),
        p("Same meaning. Native names.", "ServiceRef"),
        p(
            "Descriptions remain identical. Only spelling conventions and invocation syntax change."
        ),
        p("Function names", "SectionRef"),
    ]
    rows = [["CLI", "Python SDK", "Node SDK / MCP", "LangChain tool"]]
    for service in reference["services"]:
        name = service["name"]
        py = name.replace("-", "_")
        js = re.sub(r"-([a-z])", lambda m: m[1].upper(), name)
        rows.append([name, py, js, "mrscraper_" + py])
    story += [
        table(rows, [105, 108, 115, 177], compact=True),
        Spacer(1, 12),
        p("Parameter names", "SectionRef"),
    ]
    rows = [["HTTP / Node / MCP", "CLI", "Python / LangChain"]]
    seen = set()
    for service in reference["services"]:
        for key in service["parameters"]:
            field = parameters[key]
            name = field["name"]
            if name in seen:
                continue
            seen.add(name)
            flag = re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()
            cli = (
                "<" + name + ">"
                if name in ["url", "query"]
                else (
                    "--" + flag + " / --no-" + flag
                    if field["type"] == "boolean" and field["default"] in [None, True]
                    else "--" + flag
                )
            )
            py = re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
            rows.append([name, cli, py])
    story += [
        table(rows, [170, 170, 165], compact=True),
        Spacer(1, 8),
        p(
            "Paired CLI flags set browserRendering and the JSON extraction html field to true or false; leaving both out keeps the documented default. The CLI also accepts status --json as an output-format flag; it is not an API service parameter. Authentication follows each surface's setup.",
            "SmallRef",
        ),
        p(
            "Response examples use the common response envelope. MCP returns this envelope in structuredContent and as JSON text in content. LangChain returns the envelope as a JSON string. Decode that string to access the illustrated fields.",
            "SmallRef",
        ),
    ]
    doc.build(story)
    from pypdf import PdfReader

    pdf = PdfReader(args.output)
    text = "\n".join(page.extract_text() for page in pdf.pages)
    for service in reference["services"]:
        assert "Response - " + service["title"] in text
    for key in ["subscriptionItem", "scraperAllowance", "token_usage", "tokenUsage"]:
        assert key in text, f"Missing response field: {key}"
    assert text.count("Upstream endpoint") == len(reference["services"]) + 1
    assert text.count("Example request") == len(reference["services"])
    for key in ["api.app.mrscraper.com/api/v1/subscription-accounts", "x-api-token"]:
        assert key in text, f"Missing upstream detail: {key}"
    print(args.output)


if __name__ == "__main__":
    main()
