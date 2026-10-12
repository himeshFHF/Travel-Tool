import { parseEmail, safeEmailLink, type EmailInput, type ReadableEmail } from "../src/email";

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

function readableLinks(text: string) {
  const matches = text.matchAll(/https?:\/\/[^\s<>"']+/gi);
  let result = "";
  let position = 0;
  for (const match of matches) {
    const index = match.index!;
    result += escape(text.slice(position, index));
    const visible = match[0].replace(/[).,;!?]+$/, "");
    const trailing = match[0].slice(visible.length);
    const url = safeEmailLink(visible);
    result += url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${escape(visible)}</a>${escape(trailing)}` : escape(match[0]);
    position = index + match[0].length;
  }
  return result + escape(text.slice(position));
}

function downloadPath(value: string) {
  try {
    const url = new URL(value, "https://wayfarer.invalid");
    if (url.origin !== "https://wayfarer.invalid" || !/^\/api\/documents\/[^/]+$/.test(url.pathname) || url.searchParams.get("download") !== "1") return undefined;
    return url.pathname + url.search;
  } catch { return undefined; }
}

function emailDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date) + " UTC";
}

export async function buildEmailPreview({ name, raw, downloadUrl, loadRemoteImages = false }: {
  name: string;
  raw: EmailInput;
  downloadUrl: string;
  loadRemoteImages?: boolean;
}): Promise<Response> {
  let email: ReadableEmail | undefined;
  let failed = false;
  try { email = await parseEmail(raw, { loadRemoteImages }); } catch { failed = true; }
  const subject = email?.subject || name || "Saved email";
  const download = downloadPath(downloadUrl);
  const remotePreview = download ? new URL(download, "https://wayfarer.invalid") : undefined;
  remotePreview?.searchParams.delete("download");
  remotePreview?.searchParams.set("images", "1");
  const imageLink = remotePreview ? remotePreview.pathname + remotePreview.search : undefined;
  const attachmentLink = (index: number) => {
    if (!download) return undefined;
    const url = new URL(download, "https://wayfarer.invalid");
    url.searchParams.delete("download");
    url.searchParams.delete("images");
    url.searchParams.set("attachment", String(index));
    return url.pathname + url.search;
  };
  const row = (label: string, value?: string) => value ? `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>` : "";
  const imageFigure = (source: string, label: string, remote = false) => `<figure><img src="${escape(source)}" alt="${escape(label)}" referrerpolicy="no-referrer"${remote ? ' loading="lazy"' : ""}><figcaption>${escape(label)}</figcaption></figure>`;
  const unplacedImages = email?.images.filter((image) => !email.bodyHtml || !image.inBody) || [];
  const embeddedImages = unplacedImages.length ? `<section class="email-images" aria-label="Embedded email images"><h2>Attached images</h2>${unplacedImages.map((image) => imageFigure(image.dataUrl, image.name)).join("")}</section>` : "";
  const externalImages = email?.remoteImages.length && !loadRemoteImages ? `<section class="email-images external-images" aria-label="Images hosted by the sender"><p>Images from the sender are hidden. Load them to see any ticket barcode and the complete email.</p>${imageLink ? `<a class="load-images" href="${escape(imageLink)}">Load email images</a>` : ""}<p class="image-note">Loading images connects to the sender’s image hosts.</p></section>` : "";
  const attachmentLinks = email?.viewableAttachments.map((attachment) => {
    const href = attachmentLink(attachment.index);
    return href ? `<a class="attachment-link" href="${escape(href)}" target="_blank" rel="noopener noreferrer"><span>Open ${escape(attachment.name)}</span><small>${attachment.mime === "application/pdf" ? "PDF" : "Image"}</small></a>` : "";
  }).join("") || "";
  const attachments = email?.attachmentNames.length ? `<section class="attachments" aria-label="Email attachments"><h2>Attachments</h2>${attachmentLinks}<ul>${email.attachmentNames.map((filename) => `<li>${escape(filename)}</li>`).join("")}</ul><p>Download the original email to keep the original message and other files.</p>${email.omittedImages ? `<p>${email.omittedImages} ${email.omittedImages === 1 ? "image is" : "images are"} not included in this preview. Open an attachment above or the original email to view ${email.omittedImages === 1 ? "it" : "them"}.</p>` : ""}</section>` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(subject)} · Wayfarer</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f8f2;color:#253f37;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.65}a{color:#315e49;text-underline-offset:3px}header.top{max-width:920px;margin:0 auto;display:flex;gap:16px;align-items:center;justify-content:space-between;padding:27px 24px}.brand{font-weight:750;font-size:23px;letter-spacing:-1px;text-decoration:none}.download{border:1px solid #d8e1d1;padding:9px 14px;border-radius:8px;text-decoration:none;font-size:13px;background:white}main{max-width:872px;margin:5px auto 48px;border:1px solid #dfe6d7;border-radius:15px;background:#fff;overflow:hidden}.email-header{padding:29px 34px 25px;border-bottom:1px solid #e8eddf}.eyebrow{text-transform:uppercase;font-size:10px;letter-spacing:1.8px;font-weight:650;color:#79836d;margin:0 0 13px}h1{font-size:25px;line-height:1.3;margin:0 0 21px;overflow-wrap:anywhere;letter-spacing:-.5px}dl{font-size:12px;margin:0;color:#667362}dl>div{display:flex;gap:13px;margin:5px 0}dt{min-width:38px;color:#8a9380}dd{margin:0;overflow-wrap:anywhere}.body{padding:30px 34px;white-space:pre-wrap;font-size:14px;color:#3c4c3e;overflow-wrap:anywhere}.attachments{margin:0 34px 30px;padding:18px 20px;background:#f5f7f0;border-radius:9px;font-size:12px;color:#667362}.attachments h2{font-size:13px;margin:0}.attachments ul{padding-left:18px;overflow-wrap:anywhere}.attachments p{margin-bottom:0}.foot{font-size:11px;color:#87907e;margin:0;padding:0 34px 25px}@media(max-width:600px){header.top{padding:17px 16px}.brand{font-size:21px}.download{font-size:11px;padding:8px 10px}main{margin:0 12px 30px}.email-header,.body{padding:23px 21px}h1{font-size:21px}.attachments{margin:0 21px 24px}.foot{padding:0 21px 22px}}
.email-images{margin:25px 34px 0;padding:16px 20px;border:1px solid #dfe6d7;background:#fafbf7;border-radius:10px}.email-images h2{font-size:15px;line-height:1.4;margin:0 0 12px}.email-images p{font-size:12px;color:#667362;margin:0 0 12px}.email-images figure{margin:16px 0 0}.email-images img{display:block;max-width:100%;height:auto;background:white;border-radius:4px}.email-images figcaption{font-size:11px;margin-top:7px;color:#667362;overflow-wrap:anywhere}.load-images{display:inline-block;background:#315e49;color:white;text-decoration:none;padding:9px 14px;border-radius:7px;font-size:12px}.email-images .image-note{font-size:10px;color:#87907e;margin:10px 0 0}.attachment-link{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:9px;padding:10px 12px;border:1px solid #d9e2d0;border-radius:7px;background:white;text-decoration:none}.attachment-link span{overflow-wrap:anywhere}.attachment-link small{font-size:10px;color:#7a8970}.email-original{white-space:normal;overflow-x:auto;max-width:100%;padding:25px 20px}.email-original table{max-width:100%}.email-original img{max-width:100%!important;height:auto!important}.email-original a{overflow-wrap:anywhere}.email-original .email-mobile,.email-original .email-mobile-row{display:none!important}@media(max-width:480px){.email-original .email-desktop{display:none!important}.email-original .email-mobile{display:block!important}.email-original .email-mobile-row{display:table-row!important}}.email-image-placeholder{display:inline-block;font-size:10px;color:#87907e;padding:2px 4px;line-height:1.4}.plain-alternative{margin:0 34px 25px;font-size:12px;color:#667362}.plain-alternative summary{cursor:pointer}.plain-alternative div{white-space:pre-wrap;overflow-wrap:anywhere;padding-top:12px}@media(max-width:600px){.email-images{margin:20px 21px 0;padding:15px}.email-original{padding:18px 12px}.plain-alternative{margin:0 21px 23px}}
</style></head><body><header class="top"><a class="brand" href="/">wayfarer.</a>${download ? `<a class="download" href="${escape(download)}" download>Download original email</a>` : ""}</header><main><section class="email-header"><p class="eyebrow">Saved email</p><h1>${escape(subject)}</h1><dl>${row("From", email?.from)}${row("To", email?.to)}${row("Date", email?.date ? emailDate(email.date) : "")}</dl></section>${externalImages}<section class="body${email?.bodyHtml ? " email-original" : ""}" aria-label="Email message">${failed ? "This email couldn’t be previewed. Download the original email to open it in your email app." : email?.bodyHtml || (email?.text ? readableLinks(email.text) : email?.images.length || email?.remoteImages.length ? "This message includes email images." : "This email has no readable message body. Download the original email to view its contents.")}</section>${email?.bodyHtml && email.text ? `<details class="plain-alternative"><summary>Plain text version</summary><div>${readableLinks(email.text)}</div></details>` : ""}${embeddedImages}${attachments}<p class="foot">Readable email view · original email remains available to download.</p></main></body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; img-src data:${loadRemoteImages ? " https:" : ""}; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; object-src 'none'`,
    },
  });
}
