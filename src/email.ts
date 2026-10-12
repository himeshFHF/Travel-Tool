import PostalMime, { type Address, type Attachment } from "postal-mime";
import { Parser } from "htmlparser2";

export type EmailInput = string | ArrayBuffer | Uint8Array;
export type ReadableEmail = {
  subject: string;
  from: string;
  to: string;
  date: string;
  text: string;
  attachmentNames: string[];
  images: { name: string; mime: string; dataUrl: string; inBody: boolean }[];
  remoteImages: { name: string; url: string }[];
  omittedImages: number;
  viewableAttachments: { index: number; name: string; mime: string }[];
  bodyHtml?: string;
};

export function safeEmailLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
    return url.href;
  } catch { return; }
}

/** Converts HTML into inert text in browsers and Workers, without creating DOM
 * nodes or fetching images. htmlparser2 decodes character entities for us.
 */
export function emailHtmlToText(html: string): string {
  const chunks: string[] = [];
  const stack: { name: string; hidden: boolean; href?: string; start: number }[] = [];
  const ignored = new Set(["head", "script", "style", "template", "svg", "math", "iframe", "object", "noscript"]);
  const blocks = new Set(["p", "div", "section", "article", "header", "footer", "blockquote", "pre", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "table", "tr"]);
  const parser = new Parser({
    onopentag(name, attributes) {
      const hidden = Boolean(stack.at(-1)?.hidden) || ignored.has(name) || "hidden" in attributes || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attributes.style || "");
      stack.push({ name, hidden, href: name === "a" ? safeEmailLink(attributes.href || "") : undefined, start: chunks.length });
      if (hidden) return;
      if (blocks.has(name) || name === "br" || name === "hr") chunks.push("\n");
      if (name === "li") chunks.push("\n• ");
      if (name === "td" || name === "th") chunks.push("  ");
      if (name === "img" && attributes.alt?.trim()) chunks.push(` [${attributes.alt.trim()}] `);
    },
    ontext(value) {
      if (!stack.at(-1)?.hidden) chunks.push(stack.some((entry) => entry.name === "pre") ? value.replace(/\r\n?/g, "\n") : value.replace(/[\s\u00a0]+/g, " "));
    },
    onclosetag(name) {
      const entry = stack.pop();
      if (!entry || entry.hidden) return;
      if (entry.href && !chunks.slice(entry.start).join("").includes(entry.href)) chunks.push(` (${entry.href})`);
      if (blocks.has(name) || name === "li") chunks.push("\n");
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.end(html);
  return chunks.join("").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
function cleanPlainText(text: string) {
  // Remove invisible preheader filler lines, but preserve format characters
  // inside meaningful text (including right-to-left scripts).
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => /^[\s\u200b-\u200f\u2060\ufeff]*$/.test(line) ? "" : line).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function safeEmailStyle(style: string) {
  const allowed = new Set(["color", "background", "background-color", "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-decoration", "text-transform", "vertical-align", "white-space", "word-break", "overflow-wrap", "width", "max-width", "min-width", "height", "max-height", "padding", "padding-top", "padding-bottom", "padding-left", "padding-right", "margin", "margin-top", "margin-bottom", "margin-left", "margin-right", "border", "border-top", "border-bottom", "border-left", "border-right", "border-color", "border-width", "border-style", "border-radius", "border-collapse", "border-spacing", "table-layout", "display"]);
  return style.split(";").flatMap((declaration) => {
    const colon = declaration.indexOf(":");
    if (colon < 0) return [];
    const name = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    if (!allowed.has(name) || value.length > 250 || /url|expression|javascript|@|\\|[<>]/i.test(value) || !/^[a-z0-9\s#().,%'"!+\/-]+$/i.test(value)) return [];
    return [`${name}:${value}`];
  }).join(";");
}

/** Rebuild a small, inert HTML subset; no original tag or attribute is trusted.
 * Email tables/inline formatting remain, while active content and hidden
 * preheaders disappear. All image sources come from the validated image lists.
 */
function sanitizeEmailHtml(html: string, cidImages: Map<string, string>, remoteImages: ReadableEmail["remoteImages"], loadRemoteImages: boolean) {
  const allowed = new Set(["table", "thead", "tbody", "tfoot", "tr", "td", "th", "div", "p", "span", "a", "b", "strong", "i", "em", "u", "s", "small", "sub", "sup", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "br", "hr", "blockquote", "pre", "code", "img", "center"]);
  const ignored = new Set(["head", "script", "style", "template", "svg", "math", "iframe", "object", "embed", "noscript", "textarea", "select", "button"]);
  const voids = new Set(["img", "br", "hr"]);
  const stack: { hidden: boolean; emitted?: string }[] = [];
  const out: string[] = [];
  const remotes = new Set(remoteImages.map((image) => image.url));
  const parser = new Parser({
    onopentag(name, attributes) {
      const hidden = Boolean(stack.at(-1)?.hidden) || ignored.has(name) || "hidden" in attributes || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attributes.style || "");
      const entry: { hidden: boolean; emitted?: string } = { hidden };
      stack.push(entry);
      if (hidden || !allowed.has(name)) return;
      const attrs: string[] = [];
      const attr = (key: string, value: string) => attrs.push(`${key}="${escapeHtml(value)}"`);
      if (name === "img") {
        const source = attributes.src || "";
        const cid = source.toLowerCase().startsWith("cid:") ? source.slice(4).replace(/^<|>$/g, "").toLowerCase() : "";
        const remote = safeRemoteImage(source);
        const src = cidImages.get(cid) || (loadRemoteImages && remote && remotes.has(remote) ? remote : undefined);
        if (!src) {
          if (remote && remotes.has(remote) && attributes.alt?.trim()) out.push(`<span class="email-image-placeholder">${escapeHtml(attributes.alt)}</span>`);
          return;
        }
        attr("src", src); attr("alt", attributes.alt || "Email image"); attr("referrerpolicy", "no-referrer");
      }
      if (name === "a") {
        const href = safeEmailLink(attributes.href || "");
        if (href) { attr("href", href); attr("target", "_blank"); attr("rel", "noopener noreferrer"); }
      }
      const responsiveClasses = (attributes.class || "").split(/\s+/).filter((value) => ["desktop", "mobile", "mobile-row"].includes(value)).map((value) => `email-${value}`);
      if (responsiveClasses.length) attr("class", responsiveClasses.join(" "));
      for (const key of ["width", "height", "cellpadding", "cellspacing", "border", "colspan", "rowspan"]) {
        const value = attributes[key];
        if (value && /^\d{1,4}%?$/.test(value)) attr(key, value);
      }
      if (/^(left|center|right|justify)$/i.test(attributes.align || "")) attr("align", attributes.align);
      if (/^(top|middle|bottom|baseline)$/i.test(attributes.valign || "")) attr("valign", attributes.valign);
      if (/^#[0-9a-f]{3,8}$/i.test(attributes.bgcolor || "")) attr("bgcolor", attributes.bgcolor);
      const style = safeEmailStyle(attributes.style || "");
      if (style) attr("style", style);
      if (/^(ltr|rtl|auto)$/.test(attributes.dir || "")) attr("dir", attributes.dir);
      out.push(`<${name}${attrs.length ? " " + attrs.join(" ") : ""}>`);
      if (!voids.has(name)) entry.emitted = name;
    },
    ontext(value) { if (!stack.at(-1)?.hidden) out.push(escapeHtml(value)); },
    onclosetag() { const entry = stack.pop(); if (entry?.emitted) out.push(`</${entry.emitted}>`); },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.end(html);
  return out.join("");
}

function imageReferences(html: string) {
  const references: { source: string; name: string }[] = [];
  const hidden: boolean[] = [];
  const parser = new Parser({
    onopentag(name, attributes) {
      const invisible = Boolean(hidden.at(-1)) || ["head", "script", "style", "template", "svg", "math", "iframe", "object", "noscript"].includes(name) || "hidden" in attributes || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attributes.style || "");
      hidden.push(invisible);
      const width = Number.parseFloat(attributes.width || "");
      const height = Number.parseFloat(attributes.height || "");
      if (!invisible && name === "img" && attributes.src && !(width > 0 && width <= 2) && !(height > 0 && height <= 2)) references.push({ source: attributes.src, name: attributes.alt?.trim() || "Email image" });
    },
    onclosetag() { hidden.pop(); },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.end(html);
  return references;
}

function safeRemoteImage(value: string) {
  const safe = safeEmailLink(value);
  if (!safe) return undefined;
  const url = new URL(safe);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return undefined;
  return safe;
}

function rasterMime(bytes: Uint8Array): string | undefined {
  const prefix = (...signature: number[]) => signature.every((value, i) => bytes[i] === value);
  const dimensionsFit = (width: number, height: number) => width > 0 && height > 0 && width <= 16000 && height <= 16000 && width * height <= 30_000_000;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && prefix(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return dimensionsFit(view.getUint32(16), view.getUint32(20)) ? "image/png" : undefined;
  if (bytes.length >= 10 && (prefix(0x47, 0x49, 0x46, 0x38, 0x39, 0x61) || prefix(0x47, 0x49, 0x46, 0x38, 0x37, 0x61))) return dimensionsFit(view.getUint16(6, true), view.getUint16(8, true)) ? "image/gif" : undefined;
  if (bytes.length >= 30 && prefix(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    const chunk = new TextDecoder().decode(bytes.subarray(12, 16));
    if (chunk === "VP8X") return dimensionsFit(1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)) ? "image/webp" : undefined;
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return dimensionsFit(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff) ? "image/webp" : undefined;
    if (chunk === "VP8L" && bytes[20] === 0x2f) { const dimensions = view.getUint32(21, true); return dimensionsFit((dimensions & 0x3fff) + 1, ((dimensions >>> 14) & 0x3fff) + 1) ? "image/webp" : undefined; }
  }
  if (bytes.length >= 4 && prefix(0xff, 0xd8, 0xff)) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && offset + 9 < bytes.length) return dimensionsFit(view.getUint16(offset + 7), view.getUint16(offset + 5)) ? "image/jpeg" : undefined;
      const length = view.getUint16(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  return undefined;
}

function base64(bytes: Uint8Array) {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(parts.join(""));
}

function attachmentBytes(attachment: Attachment): Uint8Array | undefined {
  if (typeof attachment.content === "string") return undefined;
  return ArrayBuffer.isView(attachment.content) ? new Uint8Array(attachment.content.buffer, attachment.content.byteOffset, attachment.content.byteLength) : new Uint8Array(attachment.content);
}

function attachmentName(value: string | null | undefined) {
  return (value || "Unnamed attachment").split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").slice(0, 255) || "Unnamed attachment";
}

function attachmentMime(attachment: Attachment, content: Uint8Array) {
  const mime = attachment.mimeType.toLowerCase();
  if (content.byteLength > 20 * 1024 * 1024) return undefined;
  if (mime === "application/pdf" && content.length >= 5 && new TextDecoder().decode(content.subarray(0, 5)) === "%PDF-") return mime;
  const raster = rasterMime(content);
  return raster === mime ? mime : undefined;
}

async function parseMime(raw: EmailInput) {
  const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("This email is too large to preview.");
  return PostalMime.parse(bytes, {
    maxNestingDepth: 40,
    maxHeadersSize: 256 * 1024,
    maxPartCount: 500,
    maxRfc822NestingDepth: 3,
  });
}

export async function readEmailAttachment(raw: EmailInput, index: number): Promise<{ name: string; mime: string; bytes: Uint8Array } | undefined> {
  if (!Number.isSafeInteger(index) || index < 0 || index >= 500) return undefined;
  const parsed = await parseMime(raw);
  const attachment = parsed.attachments[index];
  if (!attachment) return undefined;
  const bytes = attachmentBytes(attachment);
  const mime = bytes && attachmentMime(attachment, bytes);
  if (!bytes || !mime) return undefined;
  return { name: attachmentName(attachment.filename), mime, bytes };
}

function addressText(address?: Address): string {
  if (!address) return "";
  if (address.group) return `${address.name}: ${address.group.map((member) => addressText(member)).join(", ")}`;
  return address.name && address.address ? `${address.name} <${address.address}>` : address.name || address.address || "";
}

/** Read MIME, encoded words, charsets, base64 and quoted-printable locally.
 * Input is bounded before the MIME parser allocates attachment content.
 * The result deliberately contains no raw HTML for a caller to accidentally render.
 */
export async function parseEmail(raw: EmailInput, { loadRemoteImages = false }: { loadRemoteImages?: boolean } = {}): Promise<ReadableEmail> {
  const parsed = await parseMime(raw);
  const references = imageReferences(parsed.html || "");
  const images: ReadableEmail["images"] = [];
  const remoteImages: ReadableEmail["remoteImages"] = [];
  const seen = new Set<string>();
  let omittedImages = 0;
  let totalImageBytes = 0;
  const cidImages = new Map<string, string>();
  const viewableAttachments: ReadableEmail["viewableAttachments"] = [];
  parsed.attachments.forEach((attachment, index) => {
    const content = attachmentBytes(attachment);
    const mime = content && attachmentMime(attachment, content);
    if (mime) viewableAttachments.push({ index, name: attachmentName(attachment.filename), mime });
  });
  for (const attachment of parsed.attachments) {
    if (!attachment.mimeType.toLowerCase().startsWith("image/")) continue;
    const content = attachmentBytes(attachment);
    if (!content) { omittedImages++; continue; }
    const mime = rasterMime(content);
    if (!mime || mime !== attachment.mimeType.toLowerCase() || content.byteLength > 3 * 1024 * 1024 || totalImageBytes + content.byteLength > 10 * 1024 * 1024 || images.length >= 12) { omittedImages++; continue; }
    const contentId = (attachment.contentId || "").replace(/^<|>$/g, "").toLowerCase();
    const reference = references.find((ref) => ref.source.toLowerCase() === `cid:${contentId}`);
    const dataUrl = `data:${mime};base64,${base64(content)}`;
    images.push({ name: reference?.name || attachmentName(attachment.filename), mime, dataUrl, inBody: Boolean(reference) });
    if (contentId) cidImages.set(contentId, dataUrl);
    totalImageBytes += content.byteLength;
  }
  for (const reference of references) {
    const url = safeRemoteImage(reference.source);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    if (remoteImages.length >= 24) { omittedImages++; continue; }
    remoteImages.push({ name: reference.name, url });
  }
  const htmlText = cleanPlainText(parsed.html ? emailHtmlToText(parsed.html) : "");
  const plainText = cleanPlainText(parsed.text || "");
  const meaningfulHtmlText = htmlText.replace(/\[[^\]]*\]/g, "").replace(/https?:\/\/\S+/g, "").trim();
  const text = plainText.length > meaningfulHtmlText.length && (meaningfulHtmlText.length < 80 || plainText.length > htmlText.length * 2) ? plainText : htmlText || plainText;
  return {
    subject: parsed.subject || "",
    from: addressText(parsed.from),
    to: (parsed.to || []).map(addressText).join(", "),
    date: parsed.date || "",
    text,
    attachmentNames: parsed.attachments.map((attachment) => attachmentName(attachment.filename)).slice(0, 50),
    images,
    remoteImages,
    omittedImages,
    viewableAttachments,
    bodyHtml: parsed.html ? sanitizeEmailHtml(parsed.html, cidImages, remoteImages, loadRemoteImages) : undefined,
  };
}
