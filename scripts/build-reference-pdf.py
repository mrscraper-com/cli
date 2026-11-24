"""Create the standard service reference PDF from docs/service-reference.json.

Requires reportlab and pypdf. Run from the CLI checkout with Python 3.9+.
"""

from __future__ import annotations

import argparse
import json
import re
from html import escape
from pathlib import Path

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

    def code(text):
        content = Paragraph(
            escape(text).replace("\n", "<br/>").replace("  ", "&nbsp;&nbsp;"),
            styles["CodeRef"],
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
        canvas.drawString(45, 27, "Reference v1.1  |  23 November 2026")
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
        subject="Standard descriptions, parameter types, defaults, and naming across the CLI, SDKs, and integrations.",
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
            "Canonical function and parameter descriptions for the CLI, Python SDK, Node SDK, LangChain integration, and MCP server."
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
            "Screenshot has two service-specific forms: false, full, top, or a custom viewport for Scrape HTML, and a boolean for JSON extraction. Get screenshot always captures the full page and takes no screenshot parameter. These forms have distinct descriptions because their types and meanings differ.",
            "SmallRef",
        ),
        p(
            "Each service adds its documented fixed request fields automatically: html=true and markdown=false (plus browserRendering=true when a screenshot is set), markdown=true with html=false and screenshot=false, screenshot=full with html=false, markdown=false, and browserRendering=true, action=brand-scraping with bundle=none, agent=general, and action=websearch. HTML, Markdown, screenshots, and JSON extraction always send saveResult=true, and tokenCap is never sent. Fixed fields are not service parameters.",
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
            "waitForSelector": "body",
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
        if service["transport_timeout_seconds"] is not None:
            story += [
                Spacer(1, 7),
                p(
                    f"Fixed HTTP deadline: {service['transport_timeout_seconds']} seconds. This deadline is not a service parameter.",
                    "SmallRef",
                ),
            ]
        selections = {
            "scrape-html": "Request selection: html=true, markdown=false, saveResult=true. Setting the optional screenshot also sends browserRendering=true and returns JSON with html and screenshot.",
            "scrape-markdown": "Request selection: markdown=true, html=false, screenshot=false, saveResult=true.",
            "get-screenshot": "Request selection: screenshot=full, browserRendering=true, html=false, markdown=false, saveResult=true. These are not service parameters; the API still includes the page HTML.",
            "scrape-brand": "Request selection: action=brand-scraping, bundle=none. Page controls are not accepted.",
            "web-search": "Request selection: action=websearch. country is omitted unless set.",
        }
        if service["name"] in selections:
            story += [Spacer(1, 4), p(selections[service["name"]], "SmallRef")]
        if service["name"] == "scrape-json":
            story += [
                p(
                    "Request selection: agent=general, saveResult=true. GET changes to POST above an 8,000-character encoded URL; url, prompt, and agent move to the body.",
                    "SmallRef",
                )
            ]
        story += [
            Spacer(1, 9),
            p("Example input", "SectionRef"),
            code(json.dumps(examples[service["name"]], indent=2)),
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
    print(args.output)


if __name__ == "__main__":
    main()
