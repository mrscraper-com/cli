import test from "node:test";
import assert from "node:assert/strict";
import { convertHtml, formatFetchResult } from "../lib/content.js";

const html = `<!doctype html>
<html lang="en">
  <head>
    <title>Example Product</title>
    <meta name="description" content="A useful product">
  </head>
  <body>
    <script>window.secret = true;</script>
    <h1>Example Product</h1>
    <p>In stock <a href="/buy">Buy now</a></p>
    <img src="/product.jpg" alt="Product">
  </body>
</html>`;

test("markdown conversion removes scripts and resolves page links", () => {
  const markdown = convertHtml(html, "markdown", "https://shop.example/item");
  assert.match(markdown, /# Example Product/);
  assert.match(markdown, /https:\/\/shop\.example\/buy/);
  assert.doesNotMatch(markdown, /window\.secret/);
});

test("JSON conversion returns a clean document representation", () => {
  const document = convertHtml(html, "json", "https://shop.example/item");
  assert.equal(document.title, "Example Product");
  assert.equal(document.description, "A useful product");
  assert.equal(document.language, "en");
  assert.equal(document.text, "Example Product In stock Buy now");
  assert.deepEqual(document.links, [
    { text: "Buy now", url: "https://shop.example/buy" },
  ]);
  assert.deepEqual(document.images, [
    { alt: "Product", url: "https://shop.example/product.jpg" },
  ]);
});

test("fetch formatting preserves API metadata", () => {
  const result = formatFetchResult(
    {
      status_code: 200,
      data: html,
      headers: { "content-type": "text/html" },
      unblocker: { requested: "never" },
    },
    { format: "markdown", url: "https://shop.example/item" },
  );
  assert.equal(result.status_code, 200);
  assert.equal(result.format, "markdown");
  assert.equal(result.url, "https://shop.example/item");
  assert.match(result.data, /Example Product/);
  assert.deepEqual(result.unblocker, { requested: "never" });
});
