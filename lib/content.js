import { NodeHtmlMarkdown } from "node-html-markdown";
import { parse } from "node-html-parser";

export const FETCH_FORMATS = ["markdown", "html", "json"];

/** @param {string} value */
function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

/** @param {string | undefined} value @param {string} baseUrl */
function resolveHttpUrl(value, baseUrl) {
  if (!value || /^(?:data|javascript|mailto|tel):/i.test(value)) return null;
  try {
    const resolved = new URL(value, baseUrl);
    return ["http:", "https:"].includes(resolved.protocol)
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Convert HTML into a small, stable document representation.
 * @param {string} html
 * @param {string} url
 */
export function htmlToDocument(html, url) {
  const root = parse(html);
  for (const element of root.querySelectorAll(
    "script, style, noscript, template, svg",
  )) {
    element.remove();
  }

  const title = cleanText(root.querySelector("title")?.textContent || "");
  const description =
    root.querySelector('meta[name="description"]')?.getAttribute("content") ||
    root
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content") ||
    "";
  const language = root.querySelector("html")?.getAttribute("lang") || null;

  const links = [];
  const seenLinks = new Set();
  for (const anchor of root.querySelectorAll("a")) {
    const resolved = resolveHttpUrl(anchor.getAttribute("href"), url);
    if (!resolved || seenLinks.has(resolved)) continue;
    seenLinks.add(resolved);
    links.push({
      text: cleanText(anchor.textContent || ""),
      url: resolved,
    });
  }

  const images = [];
  const seenImages = new Set();
  for (const image of root.querySelectorAll("img")) {
    const resolved = resolveHttpUrl(
      image.getAttribute("src") || image.getAttribute("data-src"),
      url,
    );
    if (!resolved || seenImages.has(resolved)) continue;
    seenImages.add(resolved);
    images.push({
      alt: cleanText(image.getAttribute("alt") || ""),
      url: resolved,
    });
  }

  return {
    url,
    title: title || null,
    description: cleanText(description) || null,
    language,
    text: cleanText(
      root.querySelector("body")?.structuredText || root.structuredText,
    ),
    links,
    images,
  };
}

/**
 * @param {string} html
 * @param {'markdown' | 'html' | 'json'} format
 * @param {string} url
 */
export function convertHtml(html, format, url) {
  if (!FETCH_FORMATS.includes(format)) {
    throw new Error(`format must be one of: ${FETCH_FORMATS.join(", ")}`);
  }
  if (format === "html") return html;
  if (format === "json") return htmlToDocument(html, url);
  const root = parse(html);
  for (const anchor of root.querySelectorAll("a")) {
    const resolved = resolveHttpUrl(anchor.getAttribute("href"), url);
    if (resolved) anchor.setAttribute("href", resolved);
  }
  for (const image of root.querySelectorAll("img")) {
    const resolved = resolveHttpUrl(
      image.getAttribute("src") || image.getAttribute("data-src"),
      url,
    );
    if (resolved) image.setAttribute("src", resolved);
  }
  return NodeHtmlMarkdown.translate(root.toString(), {
    keepDataImages: false,
    useInlineLinks: true,
  }).trim();
}

/**
 * @param {{ data?: unknown; [key: string]: unknown }} result
 * @param {{ format: 'markdown' | 'html' | 'json'; url: string }} options
 */
export function formatFetchResult(result, { format, url }) {
  const formatted = {
    ...result,
    format,
    url,
  };

  if (!result.error && typeof result.data === "string") {
    formatted.data = convertHtml(result.data, format, url);
  }
  return formatted;
}
