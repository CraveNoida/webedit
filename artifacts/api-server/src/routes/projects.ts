import { Router } from "express";
import { mongo } from "@workspace/db";
import { injectPlaceholders } from "../utils/inject-placeholders";
import { ZipArchive } from "archiver";
import fs from "fs";
import path from "path";
import { persistDataImageUrls } from "../lib/media-assets";
import {
  ListProjectsQueryParams,
  CreateProjectBody,
  GetProjectParams,
  UpdateProjectParams,
  UpdateProjectBody,
  DeleteProjectParams,
  GenerateProjectParams,
  DuplicateProjectParams,
} from "@workspace/api-zod";

const router = Router();
const DEFAULT_HERO_IMAGE_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 9'%3E%3C/svg%3E";
const DEFAULT_PAYING_GUEST_IMAGE_URLS = [
  "https://images.unsplash.com/photo-1555854877-bab0e564b8d5?auto=format&fit=crop&q=80&w=1400",
  "https://images.unsplash.com/photo-1560448204-603b3fc33ddc?auto=format&fit=crop&q=80&w=1200",
  "https://images.unsplash.com/photo-1560448075-bb485b067938?auto=format&fit=crop&q=80&w=1200",
  "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&q=80&w=1200",
  "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&q=80&w=1200",
  "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&q=80&w=1200",
];

function stripImportedExtraPages(html: string): string {
  return html.replace(
    /[\r\n]*\s*<!--\s*(?:WEBJAL_EXTRA_PAGE|WJ_EXTRA_PAGE|IMPORTED_EXTRA_PAGE)\b[\s\S]*?-->/gi,
    "\n",
  );
}

function hasAttr(tag: string, attr: string): boolean {
  return new RegExp(`(?:^|\\s)${escapeRegExp(attr)}\\s*=`, "i").test(tag);
}

function getAttr(tag: string, attr: string): string | null {
  const name = escapeRegExp(attr);
  const quoted = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  if (quoted) return quoted[2];

  const unquoted = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*([^\\s>]+)`, "i"));
  return unquoted?.[1] ?? null;
}

function removeAttrs(tag: string, attrs: string[]): string {
  let out = tag;
  for (const attr of attrs) {
    out = out.replace(new RegExp(`\\s+${attr}\\s*=\\s*(["']).*?\\1`, "gi"), "");
    out = out.replace(new RegExp(`\\s+${attr}\\s*=\\s*[^\\s>]+`, "gi"), "");
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeDoubleQuotedAttr(value: string): string {
  return value
    .replace(/&(?!(?:[a-z][a-z0-9]+|#\d+|#x[\da-f]+);)/gi, "&amp;")
    .replace(/"/g, "&quot;");
}

function appendDoubleQuotedAttr(tag: string, attr: string, value: string): string {
  return tag.replace(/\s*\/?>$/, (ending) => {
    const close = ending.trim() === "/>" ? " />" : ">";
    return ` ${attr}="${escapeDoubleQuotedAttr(value)}"${close}`;
  });
}

function formatCssUrl(value: string): string {
  return `url('${value.replace(/\r?\n/g, "").replace(/\\/g, "\\\\").replace(/'/g, "%27")}')`;
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function setDoubleQuotedAttr(tag: string, attr: string, value: string): string {
  const name = escapeRegExp(attr);
  if (hasAttr(tag, attr)) {
    let replaced = false;
    const next = tag.replace(new RegExp(`(\\s)${name}\\s*=\\s*(["']).*?\\2`, "i"), (_match, prefix: string) => {
      replaced = true;
      return `${prefix}${attr}="${escapeDoubleQuotedAttr(value)}"`;
    });
    if (replaced) return next;
    return tag.replace(new RegExp(`(\\s)${name}\\s*=\\s*[^\\s>]+`, "i"), `$1${attr}="${escapeDoubleQuotedAttr(value)}"`);
  }
  return appendDoubleQuotedAttr(tag, attr, value);
}

function looksLikeLogoImage(tag: string): boolean {
  const haystack = [
    getAttr(tag, "class"),
    getAttr(tag, "id"),
    getAttr(tag, "alt"),
    getAttr(tag, "src"),
    getAttr(tag, "data-src"),
  ].filter(Boolean).join(" ");

  return /\b(?:logo|brand|navbar-brand|nav-logo)\b/i.test(haystack);
}

function textLogoFromImage(tag: string, businessName: string): string {
  const existingClass = getAttr(tag, "class") ?? "";
  const className = [existingClass, "wj-logo-text"].filter(Boolean).join(" ").trim();
  const roleClass = /\b(?:nav-logo-light|logo-light)\b/i.test(existingClass)
    ? " wj-logo-text-light"
    : /\b(?:nav-logo-dark|logo-dark)\b/i.test(existingClass)
      ? " wj-logo-text-dark"
      : "";
  return `<span class="${escapeDoubleQuotedAttr(`${className}${roleClass}`.trim())}" data-wj-logo-text>${escapeHtmlText(businessName)}</span>`;
}

function textLogoMarkup(businessName: string): string {
  return `<span class="wj-logo-text" data-wj-logo-text>${escapeHtmlText(businessName)}</span>`;
}

function ensureLogoTextStyle(html: string): string {
  if (html.includes('id="wj-logo-text-style"') || !html.includes("data-wj-logo-text")) return html;

  const style = `<style id="wj-logo-text-style">
.wj-logo-text {
  display: inline-flex;
  align-items: center;
  width: auto !important;
  max-width: min(320px, 58vw) !important;
  height: auto !important;
  object-fit: unset !important;
  font: 900 1.55rem/1.05 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0 !important;
  white-space: nowrap;
  text-decoration: none !important;
  background: linear-gradient(135deg, #111827 0%, #2563eb 48%, #7c3aed 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent !important;
}
a .wj-logo-text { text-decoration: none !important; }
.nav-logo .wj-logo-text-dark,
.wj-logo-text-dark { color: #ffffff !important; background: none; text-shadow: 0 1px 8px rgba(0,0,0,.25); }
.nav-logo .wj-logo-text-light,
.wj-logo-text-light { color: #111827 !important; background: none; text-shadow: none; }
.nav-logo .nav-logo-light.wj-logo-text,
.nav-logo .logo-light.wj-logo-text { display: none !important; }
#main-nav.scrolled .nav-logo-dark.wj-logo-text,
#main-nav.scrolled .logo-dark.wj-logo-text { display: none !important; }
#main-nav.scrolled .nav-logo-light.wj-logo-text,
#main-nav.scrolled .logo-light.wj-logo-text { display: inline-flex !important; }
@media (max-width: 640px) { .wj-logo-text { font-size: 1.15rem; max-width: 210px !important; } }
</style>`;

  return html.includes("</head>")
    ? html.replace("</head>", `${style}\n</head>`)
    : `${style}\n${html}`;
}

function applyEditableLogoText(html: string, data: ProjectData): string {
  const businessName = getProjectValue(data, "businessName");
  if (!businessName) return html;

  const out = html.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!looksLikeLogoImage(tag)) return tag;
    return textLogoFromImage(tag, businessName);
  });

  return ensureLogoTextStyle(out);
}

function replaceSimpleElementText(markup: string, selectorWords: string[], value: string): string {
  if (!value) return markup;
  const selector = selectorWords.map(escapeRegExp).join("|");
  return markup.replace(
    new RegExp(`(<([a-z][\\w:-]*)\\b[^>]*(?:class|id)=["'][^"']*(?:${selector})[^"']*["'][^>]*>)([\\s\\S]*?)(<\\/\\2>)`, "gi"),
    (match, open: string, _tag: string, inner: string, close: string) => {
      if (/<(?:img|svg|picture)\b/i.test(inner)) return match;
      return `${open}${escapeHtmlText(value)}${close}`;
    },
  );
}

function replaceLogoBlockText(markup: string, businessName: string): string {
  if (!businessName) return markup;

  return markup.replace(
    /<([a-z][\w:-]*)\b([^>]*(?:class|id)=["'][^"']*(?:logo|brand|navbar-brand|site-title|company-name)[^"']*["'][^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag: string, attrs: string, inner: string) => {
      if (/^(?:header|nav|ul|ol|li)$/i.test(tag)) return match;

      const text = stripHtmlToText(inner);
      const hasLogoMedia = /<(?:img|svg|picture)\b/i.test(inner);
      if (!hasLogoMedia && (!text || text.split(/\s+/).length > 6)) return match;

      return `<${tag}${attrs}>${textLogoMarkup(businessName)}</${tag}>`;
    },
  );
}

function replaceHeaderLogoImages(markup: string, businessName: string): string {
  if (!businessName) return markup;

  return markup.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!looksLikeLogoImage(tag)) return tag;
    return textLogoFromImage(tag, businessName);
  });
}

function isPlausibleBrandName(value: string, businessName: string): boolean {
  const clean = value.trim();
  if (!clean || clean.includes("{{")) return false;
  if (clean.toLowerCase() === businessName.toLowerCase()) return false;
  if (clean.length < 3 || clean.length > 80) return false;
  if (clean.split(/\s+/).length > 6) return false;
  return !/^(home|about|services|service|gallery|contact|contact us|menu|book now|get in touch|learn more|welcome|website|demo|results|courses|why us|quick links|follow us|contact info|our courses|book free demo class|class|classes|exam|exams|competitive exams)$/i.test(clean);
}

function normalizedBrandKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function addBrandCandidate(candidates: Set<string>, value: string | null | undefined, businessName: string): void {
  if (!value) return;
  const clean = stripHtmlToText(value)
    .replace(/\s*[|:-]\s*(?:home|official|website|demo).*$/i, "")
    .trim();
  if (isPlausibleBrandName(clean, businessName)) candidates.add(clean);
}

function addStandaloneBrandCandidate(candidates: Set<string>, html: string, businessName: string): void {
  const clean = stripHtmlToText(html);
  const words = clean.split(/\s+/).filter(Boolean);
  const hasNestedMarkup = /<[^>]+>/.test(html);
  const looksStyledBrand = hasNestedMarkup && words.length <= 3 && words.every((word) => /^[A-Z][A-Za-z0-9&'.-]*$/.test(word));

  if (looksStyledBrand) addBrandCandidate(candidates, clean, businessName);
}

function addInlineBrandCandidates(candidates: Set<string>, text: string, businessName: string): void {
  const clean = stripHtmlToText(text);

  for (const match of clean.matchAll(/\b[A-Z][a-z]+[A-Z][A-Za-z0-9]*(?:\s+(?:Academy|Coaching|Classes|Institute|School|Education|Tutorials|College|University))?\b/g)) {
    addBrandCandidate(candidates, match[0], businessName);
  }
}

function looksLikeReviewerContext(attrs: string, inner = ""): boolean {
  const nestedMarkers = [...inner.matchAll(/\b(?:class|id)=["']([^"']*)["']/gi)].map((match) => match[1]).join(" ");
  return /\b(?:review|reviews|reviewer|testimonial|testimonials|rating|ratings|stars|author|avatar|client|customer|student|parent|alumni)\b/i.test(
    `${attrs} ${nestedMarkers}`,
  );
}

function extractLeadingBrandCandidate(text: string, businessName: string): string | null {
  const clean = stripHtmlToText(text);
  const match = clean.match(/^([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,4})\s+(?:for|classes|class|coaching|academy|school|institute|courses|results)\b/);
  const candidate = match?.[1]?.trim() ?? "";
  return isPlausibleBrandName(candidate, businessName) ? candidate : null;
}

function findBusinessNameCandidates(html: string, businessName: string): string[] {
  const candidates = new Set<string>();

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) addBrandCandidate(candidates, titleMatch[1].split(/\s*(?:\||-|--)\s*/)[0], businessName);

  const headerOrNav = [...html.matchAll(/<(header|nav)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => match[2])
    .join("\n");
  if (headerOrNav) {
    for (const match of headerOrNav.matchAll(/<[^>]+\b(?:class|id)=["'][^"']*(?:logo|brand|navbar-brand|site-title|company-name)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi)) {
      addBrandCandidate(candidates, match[1], businessName);
    }
  }

  for (const match of html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)) {
    addBrandCandidate(candidates, extractLeadingBrandCandidate(match[1], businessName), businessName);
  }

  for (const match of html.matchAll(/<(h[1-6]|p|span|strong|em|li|a|button|small|div)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    if (looksLikeReviewerContext(match[2], match[3])) continue;
    addStandaloneBrandCandidate(candidates, match[3], businessName);
    addInlineBrandCandidates(candidates, match[3], businessName);
  }

  for (const textNode of html.split(/<[^>]+>/g)) {
    addInlineBrandCandidates(candidates, textNode, businessName);
  }

  return [...candidates].sort((a, b) => b.length - a.length);
}

function replaceStandaloneBrandElements(value: string, candidates: string[], businessName: string): string {
  const candidateKeys = new Set(candidates.map(normalizedBrandKey).filter(Boolean));
  if (!candidateKeys.size) return value;

  return value.replace(
    /<(h[1-6]|span|strong|em|a|small)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag: string, attrs: string, inner: string) => {
      if (/<(?:script|style|template|img|picture|svg|video|iframe|form|input|button|ul|ol|li)\b/i.test(inner)) return match;
      const key = normalizedBrandKey(stripHtmlToText(inner));
      if (!candidateKeys.has(key)) return match;
      const replacement = /\b(?:logo|brand|navbar-brand|site-title|company-name)\b/i.test(attrs)
        ? textLogoMarkup(businessName)
        : escapeHtmlText(businessName);
      return `<${tag}${attrs}>${replacement}</${tag}>`;
    },
  );
}

function replaceBusinessNameInText(value: string, candidates: string[], businessName: string): string {
  let out = value;
  for (const candidate of candidates) {
    out = out.replace(new RegExp(escapeRegExp(candidate), "gi"), businessName);
  }
  return out;
}

export function replaceBusinessNameEverywhere(html: string, data: ProjectData): string {
  const businessName = getProjectValue(data, "businessName");
  if (!businessName) return html;

  const candidates = findBusinessNameCandidates(html, businessName);
  if (!candidates.length) return html;

  return html
    .split(/(<(?:script|style|template)\b[\s\S]*?<\/(?:script|style|template)>)/gi)
    .map((part) => {
      if (/^<(?:script|style|template)\b/i.test(part)) return part;
      return replaceBusinessNameInText(replaceStandaloneBrandElements(part, candidates, businessName), candidates, businessName);
    })
    .join("");
}

function personalizeProjectHtml(html: string, data: ProjectData): string {
  const businessName = getProjectValue(data, "businessName");
  const withBusinessName = replaceBusinessNameEverywhere(html, data);
  const withLogoBlocks = replaceHeaderLogoImages(replaceLogoBlockText(withBusinessName, businessName), businessName);
  return applyHeaderProjectDetails(withLogoBlocks, data);
}

function replaceLinkedContactText(markup: string, hrefPrefix: string, hrefValue: string, textValue: string): string {
  if (!hrefValue && !textValue) return markup;
  return markup.replace(
    new RegExp(`<a\\b([^>]*\\bhref=["']${escapeRegExp(hrefPrefix)}[^"']*["'][^>]*)>([\\s\\S]*?)<\\/a>`, "gi"),
    (_match, attrs: string, inner: string) => {
      const nextAttrs = hrefValue
        ? attrs.replace(/\bhref=(["']).*?\1/i, `href="${escapeDoubleQuotedAttr(hrefValue)}"`)
        : attrs;
      const nextText = textValue || inner;
      return `<a${nextAttrs}>${escapeHtmlText(nextText)}</a>`;
    },
  );
}

function applyHeaderProjectDetails(html: string, data: ProjectData): string {
  const businessName = getProjectValue(data, "businessName");
  const phone = getProjectValue(data, "phone");
  const whatsapp = getProjectValue(data, "whatsapp", phone);
  const email = getProjectValue(data, "email");
  const phoneLink = phone ? `tel:${phone}` : "";
  const whatsappDigits = whatsapp.replace(/[^0-9]/g, "");
  const whatsappLink = whatsappDigits ? `https://wa.me/${whatsappDigits}` : "";
  const emailLink = email ? `mailto:${email}` : "";

  const outHtml = html.replace(/<(header|nav)\b[^>]*>[\s\S]*?<\/\1>/gi, (section) => {
    let out = section;

    out = replaceSimpleElementText(out, ["logo-text", "brand-name", "brand-title", "site-title", "company-name"], businessName);
    out = replaceLogoBlockText(out, businessName);
    out = replaceHeaderLogoImages(out, businessName);

    out = out.replace(
      /<a\b([^>]*(?:class|id)=["'][^"']*(?:logo|brand|navbar-brand|site-title|company)[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi,
      (match, attrs: string, inner: string) => {
        if (!businessName) return match;
        const text = stripHtmlToText(inner);
        if (!/<(?:img|svg|picture)\b/i.test(inner) && text.split(/\s+/).length > 6) return match;
        return `<a${attrs}>${textLogoMarkup(businessName)}</a>`;
      },
    );

    out = replaceLinkedContactText(out, "tel:", phoneLink, phone);
    out = replaceLinkedContactText(out, "mailto:", emailLink, email);
    out = replaceLinkedContactText(out, "https://wa.me/", whatsappLink, whatsapp || phone);
    out = replaceLinkedContactText(out, "https://api.whatsapp.com/", whatsappLink, whatsapp || phone);

    if (phone) {
      out = out.replace(/(\+91[\s-]?)?[6-9][0-9]{4}[\s-]?[0-9]{5}/g, phone);
    }
    if (email) {
      out = out.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, email);
    }

    return out;
  });

  return ensureLogoTextStyle(outHtml);
}

function promoteRenderableImages(html: string): string {
  const lazyAttrs = ["data-src", "data-lazy-src", "data-original", "data-image"];
  const bgAttrs = ["data-bg", "data-background", "data-bg-src"];

  return html
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const lazyValue = lazyAttrs.map((attr) => getAttr(tag, attr)).find((value) => value && !value.includes("{{"));
      let out = tag;

      if (lazyValue && (!getAttr(out, "src") || getAttr(out, "src")?.startsWith("data:image/svg+xml,%3Csvg"))) {
        if (hasAttr(out, "src")) {
          out = out.replace(/(\s)src\s*=\s*(["']).*?\2/i, `$1src="${escapeDoubleQuotedAttr(lazyValue)}"`);
          out = out.replace(/(\s)src\s*=\s*[^\s>]+/i, `$1src="${escapeDoubleQuotedAttr(lazyValue)}"`);
        } else {
          out = appendDoubleQuotedAttr(out, "src", lazyValue);
        }
      }

      if (getAttr(out, "src")?.startsWith("data:")) {
        out = removeAttrs(out, ["srcset", "data-srcset"]);
      }

      return out;
    })
    .replace(/<source\b[^>]*>/gi, (tag) => {
      const srcset = getAttr(tag, "srcset") ?? getAttr(tag, "data-srcset");
      if (!srcset?.includes("data:")) return tag;
      return removeAttrs(tag, ["srcset", "data-srcset"]);
    })
    .replace(/<([a-z][\w:-]*)\b[^>]*>/gi, (tag) => {
      const bgValue = bgAttrs.map((attr) => getAttr(tag, attr)).find((value) => value && !value.includes("{{"));
      if (!bgValue || /<img\b/i.test(tag)) return tag;

      const style = getAttr(tag, "style");
      const backgroundImage = `background-image: ${formatCssUrl(bgValue)};`;
      const cleanedStyle = style
        ?.replace(/background(?:-image)?\s*:\s*url\([^)]*\)\s*;?/i, "")
        .trim()
        .replace(/;$/, "");
      const nextStyle = style
        ? [cleanedStyle, backgroundImage].filter(Boolean).join("; ")
        : backgroundImage;

      if (hasAttr(tag, "style")) {
        return tag.replace(/(\s)style\s*=\s*(["']).*?\2/i, `$1style="${escapeDoubleQuotedAttr(nextStyle)}"`);
      }

      return appendDoubleQuotedAttr(tag, "style", nextStyle);
    });
}

/**
 * Prepares generated HTML for offline use:
 * - Removes relative-path CSS/JS refs that don't exist in the ZIP
 * - Hides loading-screen overlays in the markup so they don't block content
 * - Injects a script that continuously forces content visible, overriding
 *   GSAP/ScrollTrigger/AOS/WOW.js animations that keep sections at opacity:0
 */
export function prepareDownloadHtml(html: string, options: { stripLocalAssets?: boolean } = {}): string {
  const stripLocalAssets = options.stripLocalAssets ?? true;
  let out = promoteRenderableImages(stripImportedExtraPages(html));

  // Replace older preview guards so existing generated projects receive the newest fix.
  out = out
    .replace(/<style\b[^>]*\bid=["']wj-reveal-style["'][^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*\bid=["']wj-reveal["'][^>]*>[\s\S]*?<\/script>/gi, "");

  if (stripLocalAssets) {
    // 1. Strip relative-path <link> stylesheets (not http/https/protocol-relative)
    out = out.replace(/<link\b[^>]*\bhref=["'](?!https?:\/\/|\/\/)([^"']+\.css)["'][^>]*>/gi, '');

    // 2. Strip relative-path <script src> tags
    out = out.replace(/<script\b[^>]*\bsrc=["'](?!https?:\/\/|\/\/)([^"']+\.js)["'][^>]*><\/script>/gi, '');
  }

  // 3. Hide loading-screen overlay in markup (both id="loader" and class="loading-screen" patterns)
  out = out.replace(/(<div\b[^>]*\bid=["']loader["'])([^>]*>)/gi, '$1 style="display:none!important"$2');
  out = out.replace(/(<div\b[^>]*\bclass=["'][^"']*loading[-_]screen[^"']*["'])([^>]*>)/gi, '$1 style="display:none!important"$2');

  const revealStyle = `<style id="wj-reveal-style">
#loader,
#preloader,
#loading-screen,
#splash,
#overlay-loader,
.preloader,
.pre-loader,
.page-loader,
.page-loading,
.site-loader,
.loader-wrapper,
.loading-screen,
.loading-overlay,
.loader-overlay,
.spinner-wrapper,
.pace,
.pace-active,
.pace-inactive {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
html,
body {
  overflow: auto !important;
  cursor: auto !important;
}
[data-aos],
.wow,
.animated,
[class*="fade"],
[class*="reveal"],
[class*="scroll"] {
  opacity: 1 !important;
  visibility: visible !important;
  transform: none !important;
}
</style>`;

  // 4. Inject a reveal script into <head> that:
  //    - Marks body with .no-gsap so CSS fallbacks kick in
  //    - Polls every 100ms for 5s, forcing near-invisible elements visible
  //    (covers GSAP inline-style overrides, AOS, WOW.js, ScrollTrigger, custom JS)
  const revealScript = `<script id="wj-reveal">
(function(){
  var LOADERS=[
    '#loader','#preloader','#loading-screen','#splash','#overlay-loader',
    '.preloader','.pre-loader','.page-loader','.page-loading','.site-loader',
    '.loader-wrapper','.loading-screen','.loading-overlay','.loader-overlay',
    '.spinner-wrapper','.pace','.pace-active','.pace-inactive'
  ];
  var SHOW_SELS=[
    'section','article','header','footer','main',
    '.hero-subtitle','.hero-title','.hero-desc','.hero-btns','.hero-glass-card',
    '.section-header','.section-header *',
    '.service-card','.gallery-item','.about-img','.about-text',
    '.booking-info','.booking-form','.price-card','.insta-item',
    '.testi-track','.stat-num','.footer-grid > div',
    '[data-aos]','.wow','.animated','[class*="fade"]','[class*="reveal"]','[class*="scroll"]'
  ];
  function looksLikeBlockingLoader(el){
    var text=(el.textContent||'').trim().toLowerCase();
    var marker=((el.id||'')+' '+(el.className||'')).toLowerCase();
    if(!/(loader|loading|preloader|pre-loader|spinner|splash)/.test(marker)){ return false; }
    var cs=window.getComputedStyle(el);
    var rect=el.getBoundingClientRect();
    var highLayer=parseInt(cs.zIndex||'0',10)>10;
    var big=rect.width>window.innerWidth*0.35&&rect.height>window.innerHeight*0.25;
    var fixedOrAbsolute=cs.position==='fixed'||cs.position==='absolute'||cs.position==='sticky';
    return fixedOrAbsolute||highLayer||big||text==='loading'||text==='loading...';
  }
  function preservesHiddenState(el){
    var marker=((el.id||'')+' '+(el.className||'')+' '+el.tagName).toLowerCase();
    if(/(loader|loading|preloader|pre-loader|spinner|splash)/.test(marker)){ return false; }
    if(/(mobile|menu|nav|drawer|sidebar|offcanvas|off-canvas|modal|popup|sheet|dropdown)/.test(marker)){ return true; }
    var cs=window.getComputedStyle(el);
    return (cs.position==='fixed'||cs.position==='absolute'||cs.position==='sticky')&&parseInt(cs.zIndex||'0',10)>10;
  }
  function fix(){
    // Remove loading overlays
    LOADERS.forEach(function(s){
      document.querySelectorAll(s).forEach(function(el){
        el.style.setProperty('display','none','important');
        el.style.setProperty('opacity','0','important');
        el.style.setProperty('visibility','hidden','important');
        el.style.setProperty('pointer-events','none','important');
      });
    });
    document.querySelectorAll('[id*="loader" i],[class*="loader" i],[id*="loading" i],[class*="loading" i],[id*="preloader" i],[class*="preloader" i],[class*="spinner" i]').forEach(function(el){
      try{
        if(looksLikeBlockingLoader(el)){
          el.style.setProperty('display','none','important');
          el.style.setProperty('opacity','0','important');
          el.style.setProperty('visibility','hidden','important');
          el.style.setProperty('pointer-events','none','important');
        }
      }catch(e){}
    });
    if(!document.body){ return; }
    // Restore body scroll and cursor
    document.body.style.overflow='auto';
    document.body.style.cursor='auto';
    document.documentElement.style.overflow='auto';
    ['loading','preload','preloading','is-loading','no-scroll','overflow-hidden'].forEach(function(c){
      document.body.classList.remove(c);
      document.documentElement.classList.remove(c);
    });
    // Add no-gsap class so CSS fallbacks apply
    document.body.classList.add('no-gsap');
    // Force all animation-hidden elements visible
    SHOW_SELS.forEach(function(sel){
      try{
        document.querySelectorAll(sel).forEach(function(el){
          if(preservesHiddenState(el)){ return; }
          var cs=window.getComputedStyle(el);
          var op=parseFloat(cs.opacity);
          if(op<0.05){ el.style.setProperty('opacity','1','important'); }
          if(cs.visibility==='hidden'){ el.style.setProperty('visibility','visible','important'); }
          if(cs.transform&&cs.transform!=='none'&&op<0.5){ el.style.setProperty('transform','none','important'); }
          el.removeAttribute('data-aos');
        });
      }catch(e){}
    });
  }
  // Start polling on DOMContentLoaded
  document.addEventListener('DOMContentLoaded',function(){
    var ticks=0;
    fix();
    var iv=setInterval(function(){ fix(); if(++ticks>=50) clearInterval(iv); },100);
  });
  // Also run at load time
  window.addEventListener('load',function(){ fix(); setTimeout(fix,300); setTimeout(fix,1000); setTimeout(fix,3500); });
})();
</script>`;

  const revealAssets = `${revealStyle}\n${revealScript}`;

  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (tag) => `${tag}\n${revealAssets}`);
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html[^>]*>/i, (tag) => `${tag}\n<head>\n${revealAssets}\n</head>`);
  } else {
    out = `${revealAssets}\n${out}`;
  }

  return out;
}

type ProjectTemplate = {
  id: number;
  name?: string;
  htmlContent: string;
  cssContent?: string | null;
  jsContent?: string | null;
  placeholders?: string[] | null;
};

type ProjectData = {
  businessName: string;
  tagline?: string | null;
  about?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  googleMapsLink?: string | null;
  instagramLink?: string | null;
  ctaText?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  logoUrl?: string | null;
  heroImageUrl?: string | null;
  services?: string[] | null;
  packages?: unknown;
  galleryImages?: string[] | null;
};

async function persistProjectImageFields(
  data: Record<string, unknown>,
  req: Parameters<typeof persistDataImageUrls>[1],
): Promise<Record<string, unknown>> {
  const out = { ...data };

  for (const field of ["logoUrl", "heroImageUrl", "generatedHtml"] as const) {
    const value = out[field];
    if (typeof value === "string" && value.includes("data:image")) {
      out[field] = await persistDataImageUrls(value, req);
    }
  }

  if (Array.isArray(out.galleryImages)) {
    out.galleryImages = await Promise.all(
      out.galleryImages.map((value) =>
        typeof value === "string" && value.includes("data:image")
          ? persistDataImageUrls(value, req)
          : value,
      ),
    );
  }

  return out;
}

function getProjectValue(data: ProjectData, key: keyof ProjectData, fallback = ""): string {
  const value = data[key];
  if (typeof value !== "string") return fallback;
  return value.trim() || fallback;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<head\b[\s\S]*?<\/head>/gi, "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<template\b[\s\S]*?<\/template>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

function bodyContent(html: string): string {
  return html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
}

function hasRenderableHtml(html: string): boolean {
  const body = bodyContent(html);
  return /<(?:main|section|article|header|footer|nav|div|p|h[1-6]|img|form|ul|ol|li|a|button)\b/i.test(body)
    || stripHtmlToText(body).length > 0;
}

function hasTemplateStyling(html: string): boolean {
  const stylesheetLinks = [...html.matchAll(/<link\b[^>]*\brel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi)];
  if (stylesheetLinks.some((match) => {
    const href = getAttr(match[0], "href") ?? "";
    return /^(?:https?:)?\/\//i.test(href) || /^(?:data|blob):/i.test(href) || /^\/?api\/uploads\//i.test(href);
  })) return true;

  const styleTags = [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)];
  return styleTags.some(([, attrs, css]) => {
    const id = getAttr(`<style${attrs}>`, "id") ?? "";
    if (/^wj-(?:logo-text-style|reveal-style)$/i.test(id)) return false;
    return css.replace(/\/\*[\s\S]*?\*\//g, "").trim().length > 0;
  });
}

function hasInlineTemplateStyling(html: string): boolean {
  const styleTags = [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)];
  return styleTags.some(([, attrs, css]) => {
    const id = getAttr(`<style${attrs}>`, "id") ?? "";
    if (/^wj-(?:logo-text-style|reveal-style|fallback-template-style)$/i.test(id)) return false;
    return css.replace(/\/\*[\s\S]*?\*\//g, "").trim().length > 0;
  });
}

function ensureFallbackTemplateStyle(html: string): string {
  if (hasInlineTemplateStyling(html) || html.includes('id="wj-fallback-template-style"')) return html;

  const style = `<style id="wj-fallback-template-style">
:root { --wj-primary: #1a73e8; --wj-dark: #172033; --wj-muted: #5f6b7a; --wj-surface: #ffffff; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--wj-dark); background: #f4f8ff; line-height: 1.6; }
header, nav { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 22px clamp(18px, 5vw, 72px); background: var(--wj-surface); box-shadow: 0 1px 0 rgba(15,23,42,.08); }
nav a, header a { color: #1f2937; text-decoration: none; font-weight: 500; margin: 0 10px; }
nav a:hover, header a:hover { color: var(--wj-primary); }
main, section { padding: clamp(36px, 7vw, 86px) clamp(18px, 5vw, 72px); }
.hero, [class*="hero"], .banner, [class*="banner"] { min-height: 520px; display: grid; align-items: center; background: linear-gradient(135deg, #eef5ff, #ffffff); }
h1 { font-size: clamp(2.4rem, 8vw, 5.6rem); line-height: 1.05; margin: 0 0 20px; letter-spacing: 0; font-weight: 900; }
h2 { font-size: clamp(1.8rem, 5vw, 3.2rem); line-height: 1.15; margin: 0 0 16px; font-weight: 850; }
h3 { font-size: 1.35rem; line-height: 1.25; margin: 0 0 12px; }
p { max-width: 760px; color: var(--wj-muted); font-size: clamp(1rem, 2vw, 1.2rem); }
a[href^="tel"], a[href^="https://wa.me"], button, .btn, [class*="btn"], [class*="button"], .cta, [class*="cta"] { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 12px 24px; border-radius: 12px; background: linear-gradient(135deg, #0ea5e9, #2563eb); color: #fff !important; text-decoration: none; font-weight: 750; box-shadow: 0 14px 32px rgba(37,99,235,.25); border: 0; }
img { max-width: 100%; height: auto; display: block; border-radius: 18px; }
.card, [class*="card"], .box, [class*="box"] { background: var(--wj-surface); border-radius: 18px; padding: 24px; box-shadow: 0 18px 60px rgba(15,23,42,.08); }
footer { padding: clamp(36px, 6vw, 72px) clamp(18px, 5vw, 72px); background: #111827; color: #fff; }
footer p, footer a { color: rgba(255,255,255,.72); }
@media (max-width: 720px) { header, nav { align-items: flex-start; flex-direction: column; gap: 12px; } main, section { padding: 34px 18px; } }
</style>`;

  return html.includes("</head>")
    ? html.replace("</head>", `${style}\n</head>`)
    : `${style}\n${html}`;
}

function looksLikePayingGuestTemplate(template: ProjectTemplate): boolean {
  const haystack = `${template.name ?? ""}\n${template.cssContent ?? ""}\n${template.jsContent ?? ""}`;
  return /paying\s+guest|\bpg\s+accommodation\b|room-card|amenities-grid|WHATSAPP_NUMBER/i.test(haystack);
}

function hasCompletePayingGuestHtml(html: string): boolean {
  return /class=["'][^"']*\bgallery\b/i.test(html)
    && /class=["'][^"']*\bpricing\b/i.test(html)
    && /class=["'][^"']*\blocation\b/i.test(html)
    && /class=["'][^"']*\bfaq\b/i.test(html)
    && /class=["'][^"']*\btestimonials\b/i.test(html);
}

function buildPayingGuestFallbackHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{seoTitle}}</title>
  <meta name="description" content="{{metaDescription}}" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet">
</head>
<body>
  <header class="header">
    <div class="container">
      <a class="logo" href="#home" aria-label="{{businessName}}">
        <span class="logo-mark">PG</span>
        <span class="logo-text">{{businessName}}<small>Paying Guest</small></span>
      </a>
      <nav class="nav">
        <a href="#rooms">Rooms</a>
        <a href="#amenities">Amenities</a>
        <a href="#food">Food</a>
        <a href="#contact">Contact</a>
      </nav>
      <div class="header-right">
        <a class="header-phone" href="{{phoneLink}}">Call {{phone}}</a>
        <button class="hamburger" id="hamburger" type="button" aria-label="Open menu"><span></span><span></span><span></span></button>
      </div>
    </div>
  </header>

  <nav class="mobile-nav" id="mobileNav">
    <a href="#rooms">Rooms</a>
    <a href="#amenities">Amenities</a>
    <a href="#food">Food</a>
    <a href="#rules">Rules</a>
    <a href="#contact">Contact</a>
    <div class="mobile-nav-cta">
      <a class="btn btn-primary" href="{{phoneLink}}">Call</a>
      <a class="btn btn-whatsapp" href="{{whatsappLink}}">WhatsApp</a>
    </div>
  </nav>

  <main id="home">
    <section class="hero">
      <div class="hero-bg"><img src="{{heroImageUrl}}" alt="{{businessName}} rooms"></div>
      <div class="container">
        <div class="hero-inner">
          <div class="hero-price-tag"><span class="dot"></span> Rooms available now</div>
          <h1 class="hero-title">{{businessName}}</h1>
          <p class="hero-subtitle">{{tagline}}</p>
          <div class="hero-cta">
            <a class="btn btn-primary btn-lg" href="{{phoneLink}}">Call {{phone}}</a>
            <a class="btn btn-whatsapp btn-lg" href="{{whatsappLink}}">WhatsApp</a>
          </div>
          <div class="hero-trust-row">
            <span class="trust-badge"><span class="trust-badge-icon">✓</span> Safe stay</span>
            <span class="trust-badge"><span class="trust-badge-icon">★</span> Homely food</span>
            <span class="trust-badge"><span class="trust-badge-icon">⌂</span> Prime location</span>
          </div>
        </div>
      </div>
    </section>

    <section class="about section">
      <div class="container about-grid">
        <div class="about-img-wrap">
          <img src="{{galleryImage1}}" alt="{{businessName}} accommodation">
          <div class="about-stat-float"><span class="num">4.8</span><span class="lbl">Resident rating</span></div>
        </div>
        <div class="about-content">
          <span class="section-label">About Us</span>
          <h2>Comfortable paying guest accommodation made simple.</h2>
          <p>{{about}}</p>
          <div class="about-checks">
            <div class="about-check"><span class="tick">✓</span> Furnished rooms</div>
            <div class="about-check"><span class="tick">✓</span> Wi-Fi available</div>
            <div class="about-check"><span class="tick">✓</span> Daily meals</div>
            <div class="about-check"><span class="tick">✓</span> Secure premises</div>
          </div>
        </div>
      </div>
    </section>

    <section class="stats-strip">
      <div class="container stats-strip-grid">
        <div class="stat-item"><div class="stat-num">24/7</div><div class="stat-lbl">Support</div></div>
        <div class="stat-item"><div class="stat-num">3+</div><div class="stat-lbl">Room types</div></div>
        <div class="stat-item"><div class="stat-num">Wi-Fi</div><div class="stat-lbl">Included</div></div>
        <div class="stat-item"><div class="stat-num">Food</div><div class="stat-lbl">Available</div></div>
      </div>
    </section>

    <section class="rooms section" id="rooms">
      <div class="container">
        <div class="section-header">
          <span class="section-label">Rooms</span>
          <h2 class="section-title">Choose Your Room</h2>
          <p class="section-desc">Clean, practical rooms for students and working professionals.</p>
        </div>
        <div class="rooms-grid">
          <article class="room-card">
            <div class="room-card-img"><img src="{{galleryImage2}}" alt="Single room"><span class="room-avail open">Available</span></div>
            <div class="room-card-body"><h3>Single Sharing</h3><div class="room-price"><span class="amt">Contact</span> <span class="per">for rent</span></div><div class="room-feats"><span class="room-feat">✓ Bed and storage</span><span class="room-feat">✓ Meals optional</span><span class="room-feat">✓ Wi-Fi</span></div><a class="btn btn-primary" href="{{whatsappLink}}">Enquire</a></div>
          </article>
          <article class="room-card">
            <div class="room-card-img"><img src="{{galleryImage3}}" alt="Double sharing room"><span class="room-avail open">Available</span></div>
            <div class="room-card-body"><h3>Double Sharing</h3><div class="room-price"><span class="amt">Contact</span> <span class="per">for rent</span></div><div class="room-feats"><span class="room-feat">✓ Spacious setup</span><span class="room-feat">✓ Study-friendly</span><span class="room-feat">✓ Secure stay</span></div><a class="btn btn-primary" href="{{whatsappLink}}">Enquire</a></div>
          </article>
          <article class="room-card">
            <div class="room-card-img"><img src="{{galleryImage4}}" alt="Triple sharing room"><span class="room-avail few">Few Left</span></div>
            <div class="room-card-body"><h3>Triple Sharing</h3><div class="room-price"><span class="amt">Budget</span> <span class="per">friendly</span></div><div class="room-feats"><span class="room-feat">✓ Affordable rent</span><span class="room-feat">✓ Shared amenities</span><span class="room-feat">✓ Easy access</span></div><a class="btn btn-primary" href="{{whatsappLink}}">Enquire</a></div>
          </article>
        </div>
      </div>
    </section>

    <section class="amenities section" id="amenities">
      <div class="container">
        <div class="section-header"><span class="section-label">Amenities</span><h2 class="section-title">Everything You Need</h2></div>
        <div class="amenities-grid">
          <div class="amenity-item"><div class="amenity-icon">📶</div><div class="amenity-name">Wi-Fi</div></div>
          <div class="amenity-item"><div class="amenity-icon">🍽</div><div class="amenity-name">Meals</div></div>
          <div class="amenity-item"><div class="amenity-icon">🧺</div><div class="amenity-name">Laundry</div></div>
          <div class="amenity-item"><div class="amenity-icon">🔒</div><div class="amenity-name">Security</div></div>
          <div class="amenity-item"><div class="amenity-icon">🧹</div><div class="amenity-name">Housekeeping</div></div>
        </div>
      </div>
    </section>

    <section class="food section" id="food">
      <div class="container food-layout">
        <div class="food-img-wrap"><img src="{{galleryImage5}}" alt="Homely food"></div>
        <div class="food-content">
          <span class="section-label">Food</span>
          <h2 class="section-title">Homely Meals Available</h2>
          <p class="section-desc">Fresh, simple meals and a calm living environment for a comfortable stay.</p>
          <div class="meals-grid">
            <div class="meal-card"><div class="meal-card-top"><span class="meal-emoji">☕</span><span class="meal-time">Breakfast</span></div><p>Tea, paratha, poha and seasonal options.</p></div>
            <div class="meal-card"><div class="meal-card-top"><span class="meal-emoji">🍛</span><span class="meal-time">Lunch</span></div><p>Dal, rice, roti, sabzi and salad.</p></div>
            <div class="meal-card"><div class="meal-card-top"><span class="meal-emoji">🥘</span><span class="meal-time">Dinner</span></div><p>Balanced home-style dinner served daily.</p></div>
          </div>
          <div class="food-specials">
            <h4>Food highlights</h4>
            <div class="food-tags"><span class="food-tag">Freshly cooked</span><span class="food-tag">Veg options</span><span class="food-tag">Hygienic kitchen</span></div>
          </div>
        </div>
      </div>
    </section>

    <section class="gallery section" id="gallery">
      <div class="container">
        <div class="section-header"><span class="section-label">Gallery</span><h2 class="section-title">See the Stay</h2><p class="section-desc">Rooms, common spaces and daily facilities from the property.</p></div>
        <div class="gallery-masonry">
          <div class="gallery-item"><img src="{{galleryImage1}}" alt="PG room"><span class="gallery-label">Rooms</span></div>
          <div class="gallery-item"><img src="{{galleryImage2}}" alt="Study space"><span class="gallery-label">Study Space</span></div>
          <div class="gallery-item"><img src="{{galleryImage3}}" alt="Beds and storage"><span class="gallery-label">Storage</span></div>
          <div class="gallery-item"><img src="{{galleryImage4}}" alt="Common area"><span class="gallery-label">Common Area</span></div>
          <div class="gallery-item"><img src="{{galleryImage5}}" alt="Food service"><span class="gallery-label">Food</span></div>
        </div>
      </div>
    </section>

    <section class="pricing section" id="pricing">
      <div class="container">
        <div class="section-header"><span class="section-label">Pricing</span><h2 class="section-title">Transparent Rent Options</h2><p class="section-desc">Share your requirement and get current room availability with rent details.</p></div>
        <div class="pricing-grid">
          <article class="price-card"><div class="price-card-head"><h3>Single Room</h3><p>Private comfort</p></div><div class="price-amt"><span class="rupee">Rs.</span><span class="val">Contact</span><span class="mo">/month</span></div><div class="price-deposit">Deposit as per property policy</div><div class="price-features"><span class="price-feat"><span class="check">✓</span> Private bed</span><span class="price-feat"><span class="check">✓</span> Storage</span><span class="price-feat"><span class="check">✓</span> Wi-Fi</span></div><a class="btn btn-primary" href="{{whatsappLink}}">Ask Availability</a></article>
          <article class="price-card featured"><span class="price-badge">Popular</span><div class="price-card-head"><h3>Double Sharing</h3><p>Comfort and value</p></div><div class="price-amt"><span class="rupee">Rs.</span><span class="val">Contact</span><span class="mo">/month</span></div><div class="price-deposit">Meals optional</div><div class="price-features"><span class="price-feat"><span class="check">✓</span> Shared room</span><span class="price-feat"><span class="check">✓</span> Study-friendly</span><span class="price-feat"><span class="check">✓</span> Secure stay</span></div><a class="btn btn-accent" href="{{phoneLink}}">Call Now</a></article>
          <article class="price-card"><div class="price-card-head"><h3>Triple Sharing</h3><p>Budget friendly</p></div><div class="price-amt"><span class="rupee">Rs.</span><span class="val">Budget</span><span class="mo">/month</span></div><div class="price-deposit">Subject to availability</div><div class="price-features"><span class="price-feat"><span class="check">✓</span> Affordable rent</span><span class="price-feat"><span class="check">✓</span> Shared amenities</span><span class="price-feat"><span class="check">✓</span> Easy access</span></div><a class="btn btn-primary" href="{{whatsappLink}}">Enquire</a></article>
        </div>
        <p class="pricing-disclaimer">Final rent depends on room type, facilities and current availability.</p>
      </div>
    </section>

    <section class="location section" id="location">
      <div class="container location-grid">
        <div class="location-info">
          <span class="section-label">Location</span>
          <h2 class="section-title">Prime Area, Easy Access</h2>
          <div class="addr-block"><span class="addr-icon">⌂</span><p>{{address}}</p></div>
          <div class="landmarks">
            <h4>Nearby conveniences</h4>
            <div class="landmark-list"><span class="landmark"><span class="lm-icon">✓</span> Market nearby</span><span class="landmark"><span class="lm-icon">✓</span> Public transport</span><span class="landmark"><span class="lm-icon">✓</span> Safe surroundings</span></div>
          </div>
        </div>
        <div class="map-wrap">
          <a class="map-placeholder" href="{{googleMapsLink}}" target="_blank" rel="noopener"><span class="mp-icon">⌖</span><strong>Open Map Location</strong><small>{{address}}</small></a>
        </div>
      </div>
    </section>

    <section class="rules section" id="rules">
      <div class="container">
        <div class="section-header"><span class="section-label">House Rules</span><h2 class="section-title">Simple and Clear</h2></div>
        <div class="rules-grid">
          <div class="rule-card"><div class="rule-icon">🪪</div><div class="rule-body"><h4>ID Required</h4><p>Valid ID and basic verification for every resident.</p></div></div>
          <div class="rule-card"><div class="rule-icon">🕘</div><div class="rule-body"><h4>Visitor Timing</h4><p>Visitor rules keep the property peaceful and safe.</p></div></div>
          <div class="rule-card"><div class="rule-icon">🤝</div><div class="rule-body"><h4>Respectful Stay</h4><p>Clean, cooperative shared-living environment.</p></div></div>
        </div>
      </div>
    </section>

    <section class="testimonials section" id="testimonials">
      <div class="container">
        <div class="section-header"><span class="section-label">Reviews</span><h2 class="section-title">What Residents Say</h2><p class="section-desc">A clean and peaceful stay for students and working professionals.</p></div>
        <div class="testimonials-grid">
          <article class="review-card"><div class="review-stars">★★★★★</div><p class="review-text">Rooms are clean and the location is convenient for daily travel.</p><div class="review-author"><span class="review-avatar">A</span><span><strong class="review-name">Amit</strong><small class="review-role">Working professional</small></span></div></article>
          <article class="review-card"><div class="review-stars">★★★★★</div><p class="review-text">Food and Wi-Fi make it easy to focus on studies and work.</p><div class="review-author"><span class="review-avatar">R</span><span><strong class="review-name">Riya</strong><small class="review-role">Student</small></span></div></article>
          <article class="review-card"><div class="review-stars">★★★★☆</div><p class="review-text">Good support and simple rules. The stay feels managed and safe.</p><div class="review-author"><span class="review-avatar">S</span><span><strong class="review-name">Sameer</strong><small class="review-role">Resident</small></span></div></article>
        </div>
      </div>
    </section>

    <section class="faq section" id="faq">
      <div class="container">
        <div class="section-header"><span class="section-label">FAQ</span><h2 class="section-title">Common Questions</h2></div>
        <div class="faq-list">
          <div class="faq-item"><button class="faq-q" type="button">Is food included?<span class="faq-toggle">+</span></button><div class="faq-a"><div class="faq-a-inner">Food availability depends on the selected room plan. Contact us for current details.</div></div></div>
          <div class="faq-item"><button class="faq-q" type="button">Can I visit before booking?<span class="faq-toggle">+</span></button><div class="faq-a"><div class="faq-a-inner">Yes, you can book a visit and inspect the room before confirming.</div></div></div>
          <div class="faq-item"><button class="faq-q" type="button">What documents are required?<span class="faq-toggle">+</span></button><div class="faq-a"><div class="faq-a-inner">A valid ID and basic verification details are required for every resident.</div></div></div>
        </div>
      </div>
    </section>

    <section class="contact section" id="contact">
      <div class="container contact-grid">
        <div class="contact-info">
          <h3>Book a Visit</h3>
          <p>{{address}}</p>
          <div class="contact-channels">
            <a class="channel" href="{{phoneLink}}"><span class="channel-icon ph">☎</span><span><h4>Phone</h4><p>{{phone}}</p></span></a>
            <a class="channel" href="{{whatsappLink}}"><span class="channel-icon wa">☘</span><span><h4>WhatsApp</h4><p>{{whatsapp}}</p></span></a>
            <a class="channel" href="{{emailLink}}"><span class="channel-icon em">✉</span><span><h4>Email</h4><p>{{email}}</p></span></a>
          </div>
        </div>
        <div class="contact-form-card">
          <form class="contact-form" id="contactForm">
            <div class="form-row"><div class="field"><label>Name <span class="req">*</span></label><input id="fName" placeholder="Your name"></div><div class="field"><label>Phone <span class="req">*</span></label><input id="fPhone" placeholder="Your phone"></div></div>
            <div class="form-row"><div class="field"><label>Room Type</label><select id="fRoom"><option value="">Select room</option><option>Single Sharing</option><option>Double Sharing</option><option>Triple Sharing</option></select></div><div class="field"><label>Visit Date</label><input id="fDate" type="date"></div></div>
            <div class="field"><label>Occupation</label><input id="fOcc" placeholder="Student / Professional"></div>
            <div class="field"><label>Message</label><textarea id="fMsg" placeholder="Tell us what you need"></textarea></div>
            <div class="form-actions"><button class="btn btn-primary" type="submit">{{ctaText}}</button><a class="btn btn-whatsapp" href="{{whatsappLink}}">WhatsApp Now</a></div>
          </form>
          <div class="form-done" id="formDone"><div class="done-icon">✓</div><h3>Thanks!</h3><p>We will connect with you shortly.</p><a class="btn btn-primary" href="{{phoneLink}}">Call Now</a></div>
        </div>
      </div>
    </section>
  </main>

  <div class="mobile-bar">
    <a class="mb-btn mb-call" href="{{phoneLink}}"><span class="mb-icon">☎</span> Call</a>
    <a class="mb-btn mb-wa" href="{{whatsappLink}}"><span class="mb-icon">☘</span> WhatsApp</a>
    <a class="mb-btn mb-visit" href="#contact"><span class="mb-icon">⌂</span> Visit</a>
  </div>

  <footer class="footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand"><a class="logo" href="#home"><span class="logo-mark">PG</span><span class="logo-text">{{businessName}}<small>Paying Guest</small></span></a><p>{{tagline}}</p></div>
        <div class="footer-col"><h4>Quick Links</h4><ul><li><a href="#rooms">Rooms</a></li><li><a href="#amenities">Amenities</a></li><li><a href="#contact">Contact</a></li></ul></div>
        <div class="footer-col"><h4>Contact</h4><div class="footer-contact-row"><span class="fc-icon">☎</span>{{phone}}</div><div class="footer-contact-row"><span class="fc-icon">✉</span>{{email}}</div></div>
      </div>
      <div class="footer-bottom">© {{businessName}}. All rights reserved.</div>
    </div>
  </footer>
</body>
</html>`;
}

function injectIntoHtml(html: string, tag: "head" | "body", content: string): string {
  const closingTag = new RegExp(`</${tag}>`, "i");
  if (closingTag.test(html)) {
    return html.replace(closingTag, `${content}\n</${tag}>`);
  }

  return `${html}\n${content}`;
}

function isLocalImageUrl(url: string): boolean {
  const clean = url.trim();
  if (!clean || clean.includes("{{")) return false;
  if (/^(?:https?:)?\/\//i.test(clean)) return false;
  if (/^(?:data|blob):/i.test(clean)) return false;
  if (/^\/?api\/uploads\//i.test(clean)) return false;
  return /\.(?:jpe?g|png|webp|gif|svg|ico|bmp|avif)(?:[?#].*)?$/i.test(clean);
}

function shouldReplaceImageUrl(url: string): boolean {
  return isLocalImageUrl(url);
}

function isServerUploadUrl(url: string): boolean {
  return /^\/?api\/uploads\//i.test(url.trim()) || /^https?:\/\/[^/]+\/api\/uploads\//i.test(url.trim());
}

function mimeTypeForFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".avif") return "image/avif";
  return "image/png";
}

function dataUrlForServerUpload(url: string): string | null {
  if (!isServerUploadUrl(url)) return null;

  let pathname = url.trim().split(/[?#]/)[0];
  try {
    pathname = new URL(url, "http://local.invalid").pathname;
  } catch {
    // Keep the split path above for relative URLs.
  }

  const marker = "/api/uploads/";
  const index = pathname.toLowerCase().lastIndexOf(marker);
  if (index < 0) return null;

  const rawFilename = pathname.slice(index + marker.length);
  const filename = path.basename(decodeURIComponent(rawFilename));
  const filePath = path.join(process.cwd(), "uploads", filename);
  if (!fs.existsSync(filePath)) return null;

  const base64 = fs.readFileSync(filePath).toString("base64");
  return `data:${mimeTypeForFilename(filename)};base64,${base64}`;
}

function inlineAvailableServerUploads(html: string): string {
  const cache = new Map<string, string | null>();
  const getDataUrl = (url: string) => {
    if (!cache.has(url)) cache.set(url, dataUrlForServerUpload(url));
    return cache.get(url);
  };

  return html
    .replace(
      /\b(src|data-src|data-bg)=["']([^"']+)["']/gi,
      (match, attr: string, url: string) => {
        const dataUrl = getDataUrl(url);
        return dataUrl ? `${attr}="${dataUrl}"` : match;
      },
    )
    .replace(
      /url\((["']?)([^"')]+)\1\)/gi,
      (match, quote: string, url: string) => {
        const dataUrl = getDataUrl(url);
        return dataUrl ? `url(${quote}${dataUrl}${quote})` : match;
      },
    );
}

function replaceUnresolvedLocalImages(html: string): string {
  return html
    .replace(
      /\b(src|data-src|data-bg)=["']([^"']+)["']/gi,
      (match, attr: string, url: string) =>
        shouldReplaceImageUrl(url) ? `${attr}="${DEFAULT_HERO_IMAGE_URL}"` : match,
    )
    .replace(
      /url\((["']?)([^"')]+)\1\)/gi,
      (match, quote: string, url: string) =>
        shouldReplaceImageUrl(url) ? `url(${quote}${DEFAULT_HERO_IMAGE_URL}${quote})` : match,
    );
}

export function generateHtml(template: ProjectTemplate, data: ProjectData): string {
  const isPayingGuestTemplate = looksLikePayingGuestTemplate(template);
  let html = hasRenderableHtml(template.htmlContent)
    && (!isPayingGuestTemplate || hasCompletePayingGuestHtml(template.htmlContent))
    ? template.htmlContent
    : buildPayingGuestFallbackHtml();
  const projectHeroImageUrl = typeof data.heroImageUrl === "string" ? data.heroImageUrl.trim() : "";
  const payingGuestDefaultHero = DEFAULT_PAYING_GUEST_IMAGE_URLS[0] ?? DEFAULT_HERO_IMAGE_URL;
  const heroImageUrl = projectHeroImageUrl
    || (isPayingGuestTemplate ? payingGuestDefaultHero : DEFAULT_HERO_IMAGE_URL);

  // Inject CSS and JS if present
  if (template.cssContent) {
    html = injectIntoHtml(html, "head", `<style>\n${template.cssContent}\n</style>`);
  }
  if (template.jsContent) {
    html = injectIntoHtml(html, "body", `<script>\n${template.jsContent}\n</script>`);
  }

  // Replace all placeholders
  const placeholders: Record<string, string> = {
    "{{businessName}}": getProjectValue(data, "businessName"),
    "{{tagline}}": getProjectValue(data, "tagline"),
    "{{about}}": getProjectValue(data, "about"),
    "{{phone}}": getProjectValue(data, "phone"),
    "{{whatsapp}}": getProjectValue(data, "whatsapp"),
    "{{email}}": getProjectValue(data, "email"),
    "{{address}}": getProjectValue(data, "address"),
    "{{googleMapsLink}}": getProjectValue(data, "googleMapsLink"),
    "{{instagramLink}}": getProjectValue(data, "instagramLink"),
    "{{ctaText}}": getProjectValue(data, "ctaText", "Get In Touch"),
    "{{primaryColor}}": getProjectValue(data, "primaryColor", "#4f46e5"),
    "{{secondaryColor}}": getProjectValue(data, "secondaryColor", "#7c3aed"),
    "{{logoUrl}}": getProjectValue(data, "logoUrl", heroImageUrl),
    "{{heroImage}}": heroImageUrl,
    "{{heroImageUrl}}": heroImageUrl,
    "{{whatsappLink}}": `https://wa.me/${getProjectValue(data, "whatsapp").replace(/[^0-9]/g, "")}`,
    "{{whatsappDigits}}": getProjectValue(data, "whatsapp").replace(/[^0-9]/g, ""),
    "{{phoneLink}}": `tel:${getProjectValue(data, "phone")}`,
    "{{phoneDigits}}": getProjectValue(data, "phone").replace(/[^0-9]/g, ""),
    "{{emailLink}}": `mailto:${getProjectValue(data, "email")}`,
    "{{seoTitle}}": `${getProjectValue(data, "businessName")} - ${getProjectValue(data, "tagline", "Welcome")}`,
    "{{metaDescription}}": getProjectValue(data, "about", `Welcome to ${getProjectValue(data, "businessName")}`),
  };

  // Replace services as HTML list items
  const services = Array.isArray(data.services) ? data.services as string[] : [];
  placeholders["{{services}}"] = services.map((s) => `<li>${s}</li>`).join("\n");
  placeholders["{{servicesList}}"] = services.map((s) => `<li>${s}</li>`).join("\n");

  // Replace gallery images
  const gallery = Array.isArray(data.galleryImages) ? data.galleryImages as string[] : [];
  placeholders["{{galleryImages}}"] = gallery.map((url) => `<img src="${url}" alt="Gallery" />`).join("\n");
  const defaultGallery = isPayingGuestTemplate ? DEFAULT_PAYING_GUEST_IMAGE_URLS : [heroImageUrl];
  const galleryWithHero = [
    heroImageUrl,
    ...gallery.filter((url) => typeof url === "string" && url.trim()),
    ...defaultGallery,
  ];
  for (let index = 1; index <= 8; index += 1) {
    const imageUrl = galleryWithHero[index - 1] ?? galleryWithHero[0] ?? DEFAULT_HERO_IMAGE_URL;
    placeholders[`{{galleryImage${index}}}`] = escapeDoubleQuotedAttr(imageUrl);
  }

  const packages = Array.isArray(data.packages) ? data.packages as Array<Record<string, unknown>> : [];
  placeholders["{{packages}}"] = packages.map((pkg) => {
    const name = String(pkg.name ?? "");
    const price = String(pkg.price ?? "");
    const description = String(pkg.description ?? "");
    return `<div class="package-item"><h3>${name}</h3><p>${description}</p><strong>${price}</strong></div>`;
  }).join("\n");

  for (const [key, value] of Object.entries(placeholders)) {
    html = html.replaceAll(key, value);
  }

  html = personalizeProjectHtml(applyEditableLogoText(html, data), data);
  if (!template.cssContent?.trim()) {
    html = ensureFallbackTemplateStyle(html);
  }

  return promoteRenderableImages(replaceUnresolvedLocalImages(inlineAvailableServerUploads(html)));
}

async function prepareTemplateForProject(template: ProjectTemplate): Promise<ProjectTemplate> {
  const cleanedHtml = stripImportedExtraPages(template.htmlContent);
  const { html: injectedHtml, placeholders: detectedPh } = injectPlaceholders(cleanedHtml);
  const mergedPh = [...new Set([...(template.placeholders ?? []), ...detectedPh])];

  if (injectedHtml === template.htmlContent && mergedPh.length === (template.placeholders ?? []).length) {
    return template;
  }

  const updatedTemplate = await mongo.updateTemplate(template.id, {
    htmlContent: injectedHtml,
    placeholders: mergedPh,
  });

  return updatedTemplate ?? template;
}

async function generatePreparedHtmlForProject(project: ProjectData & { templateId?: number | null }): Promise<string | null> {
  if (!project.templateId) return null;

  const templateRow = await mongo.getTemplate(project.templateId);

  if (!templateRow) return null;

  const template = await prepareTemplateForProject(templateRow);
  return prepareDownloadHtml(generateHtml(template, project), { stripLocalAssets: false });
}

async function getPreviewReadyHtml(project: ProjectData & { templateId?: number | null; generatedHtml?: string | null }): Promise<string | null> {
  if (project.generatedHtml && hasRenderableHtml(project.generatedHtml) && hasTemplateStyling(project.generatedHtml)) {
    return prepareDownloadHtml(personalizeProjectHtml(project.generatedHtml, project), { stripLocalAssets: false });
  }

  return (await generatePreparedHtmlForProject(project))
    ?? (project.generatedHtml
      ? prepareDownloadHtml(personalizeProjectHtml(project.generatedHtml, project), { stripLocalAssets: false })
      : null);
}

router.get("/", async (req, res): Promise<void> => {
  const query = ListProjectsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const projects = await mongo.listProjects({
    category: query.data.category,
    search: query.data.search,
  });

  res.json(projects);
});

router.post("/", async (req, res): Promise<void> => {
  const body = CreateProjectBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const imageFields = await persistProjectImageFields({
    logoUrl: body.data.logoUrl ?? null,
    heroImageUrl: body.data.heroImageUrl ?? null,
    galleryImages: body.data.galleryImages ?? [],
  }, req);

  const project = await mongo.createProject({
    businessName: body.data.businessName,
    category: body.data.category,
    tagline: body.data.tagline ?? null,
    about: body.data.about ?? null,
    phone: body.data.phone ?? null,
    whatsapp: body.data.whatsapp ?? null,
    email: body.data.email ?? null,
    address: body.data.address ?? null,
    googleMapsLink: body.data.googleMapsLink ?? null,
    instagramLink: body.data.instagramLink ?? null,
    services: body.data.services ?? [],
    packages: body.data.packages ?? [],
    ctaText: body.data.ctaText ?? null,
    primaryColor: body.data.primaryColor ?? "#4f46e5",
    secondaryColor: body.data.secondaryColor ?? "#7c3aed",
    logoUrl: imageFields.logoUrl as string | null,
    heroImageUrl: imageFields.heroImageUrl as string | null,
    galleryImages: imageFields.galleryImages as string[],
    templateId: body.data.templateId ?? null,
    generatedHtml: null,
    status: "draft",
  });

  res.status(201).json(project);
});

router.get("/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const project = await mongo.getProject(params.data.id);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const previewHtml = await getPreviewReadyHtml(project);
  if (previewHtml) {
    res.json({ ...project, generatedHtml: previewHtml });
  } else {
    res.json(project);
  }
});

router.get("/:id/preview", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).send("Invalid project id");
    return;
  }

  const project = await mongo.getProject(params.data.id);

  if (!project) {
    res.status(404).send("Project not found");
    return;
  }

  const previewHtml = await getPreviewReadyHtml(project);
  if (!previewHtml) {
    res.status(404).send("Project has not been generated yet.");
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(previewHtml);
});

router.put("/:id", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateProjectBody.safeParse(req.body);

  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  const fields = [
    "businessName", "category", "tagline", "about", "phone", "whatsapp", "email",
    "address", "googleMapsLink", "instagramLink", "services", "packages", "ctaText",
    "primaryColor", "secondaryColor", "logoUrl", "heroImageUrl", "galleryImages",
    "templateId", "generatedHtml", "status",
  ] as const;

  for (const field of fields) {
    if ((body.data as Record<string, unknown>)[field] !== undefined) {
      updateData[field] = (body.data as Record<string, unknown>)[field];
    }
  }

  Object.assign(updateData, await persistProjectImageFields(updateData, req));

  const didExplicitlyUpdateGeneratedHtml = body.data.generatedHtml !== undefined;
  const didUpdateDetails = Object.keys(updateData).some((field) => field !== "generatedHtml" && field !== "status");
  if (didUpdateDetails && !didExplicitlyUpdateGeneratedHtml && body.data.status === undefined) {
    updateData.status = "draft";
  }

  const project = await mongo.updateProject(params.data.id, updateData);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (!didExplicitlyUpdateGeneratedHtml) {
    res.json({ ...project, generatedHtml: await getPreviewReadyHtml(project) });
    return;
  }

  res.json(project);
});

router.delete("/:id", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await mongo.deleteProject(params.data.id);
  res.json({ success: true });
});

router.post("/:id/generate", async (req, res): Promise<void> => {
  const params = GenerateProjectParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const project = await mongo.getProject(params.data.id);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (!project.templateId) {
    res.status(400).json({ error: "Project has no template selected" });
    return;
  }

  const templateRow = await mongo.getTemplate(project.templateId);

  if (!templateRow) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  const template = await prepareTemplateForProject(templateRow);
  const generatedHtml = generateHtml(template, project);

  const updated = await mongo.updateProject(params.data.id, { generatedHtml, status: "generated" });

  res.json(updated);
});

router.post("/:id/duplicate", async (req, res): Promise<void> => {
  const params = DuplicateProjectParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const original = await mongo.getProject(params.data.id);

  if (!original) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const duplicate = await mongo.createProject({
    businessName: `${original.businessName} (Copy)`,
    category: original.category,
    tagline: original.tagline,
    about: original.about,
    phone: original.phone,
    whatsapp: original.whatsapp,
    email: original.email,
    address: original.address,
    googleMapsLink: original.googleMapsLink,
    instagramLink: original.instagramLink,
    services: original.services,
    packages: original.packages,
    ctaText: original.ctaText,
    primaryColor: original.primaryColor,
    secondaryColor: original.secondaryColor,
    logoUrl: original.logoUrl,
    heroImageUrl: original.heroImageUrl,
    galleryImages: original.galleryImages,
    templateId: original.templateId,
    generatedHtml: null,
    status: "draft",
  });

  res.status(201).json(duplicate);
});

// Save edited HTML directly (visual editor changes)
router.put("/:id/html", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { html } = req.body as { html?: string };
  if (typeof html !== "string" || !html.trim()) {
    res.status(400).json({ error: "html must be a non-empty string" });
    return;
  }
  const updated = await mongo.updateProject(id, { generatedHtml: html });
  if (!updated) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(updated);
});

// ZIP download — returns the generated site as a downloadable ZIP
router.get("/:id/download-zip", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const project = await mongo.getProject(id);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (!project.generatedHtml) {
    res.status(400).json({ error: "Project has not been generated yet. Please generate first." });
    return;
  }

  const slug = project.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${slug}-demo.zip"`);

  const downloadSource = project.generatedHtml
    ? personalizeProjectHtml(project.generatedHtml, project)
    : (await generatePreparedHtmlForProject(project)) ?? project.generatedHtml;
  const downloadHtml = prepareDownloadHtml(downloadSource);

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.pipe(res);

  archive.append(downloadHtml, { name: "index.html" });

  // Add a minimal readme
  const readme = `# ${project.businessName} Demo Website\n\nGenerated by Webjal Demo Studio.\nOpen index.html in a browser to preview.\n`;
  archive.append(readme, { name: "README.md" });

  await archive.finalize();
});

export default router;
