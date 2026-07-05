import { Router } from "express";
import { db, projectsTable, templatesTable } from "@workspace/db";
import { eq, ilike, or } from "drizzle-orm";
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

function stripImportedExtraPages(html: string): string {
  return html.replace(/[\r\n]*\s*<!--\s*═══[\s\S]*?(?=<\/body>)/i, "\n");
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

function applyEditableLogoText(html: string, data: ProjectData): string {
  const businessName = getProjectValue(data, "businessName");
  const logoUrl = getProjectValue(data, "logoUrl");
  if (!businessName && !logoUrl) return html;

  let usedTextLogo = false;
  const out = html.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!looksLikeLogoImage(tag)) return tag;
    if (logoUrl) {
      return setDoubleQuotedAttr(setDoubleQuotedAttr(tag, "src", logoUrl), "alt", businessName);
    }
    usedTextLogo = true;
    return textLogoFromImage(tag, businessName);
  });

  if (!usedTextLogo) return out;

  const style = `<style id="wj-logo-text-style">
.wj-logo-text {
  display: inline-flex;
  align-items: center;
  width: auto !important;
  max-width: min(260px, 52vw) !important;
  height: auto !important;
  object-fit: unset !important;
  font: 800 1.45rem/1.05 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0 !important;
  white-space: nowrap;
  text-decoration: none;
}
.nav-logo .wj-logo-text-dark,
.wj-logo-text-dark { color: #ffffff; text-shadow: 0 1px 8px rgba(0,0,0,.25); }
.nav-logo .wj-logo-text-light,
.wj-logo-text-light { color: #111827; text-shadow: none; }
.nav-logo .nav-logo-light.wj-logo-text,
.nav-logo .logo-light.wj-logo-text { display: none !important; }
#main-nav.scrolled .nav-logo-dark.wj-logo-text,
#main-nav.scrolled .logo-dark.wj-logo-text { display: none !important; }
#main-nav.scrolled .nav-logo-light.wj-logo-text,
#main-nav.scrolled .logo-light.wj-logo-text { display: inline-flex !important; }
@media (max-width: 640px) { .wj-logo-text { font-size: 1.15rem; max-width: 180px !important; } }
</style>`;

  return out.includes("</head>")
    ? out.replace("</head>", `${style}\n</head>`)
    : `${style}\n${out}`;
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
function prepareDownloadHtml(html: string): string {
  let out = promoteRenderableImages(stripImportedExtraPages(html));

  // Replace older preview guards so existing generated projects receive the newest fix.
  out = out
    .replace(/<style\b[^>]*\bid=["']wj-reveal-style["'][^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script\b[^>]*\bid=["']wj-reveal["'][^>]*>[\s\S]*?<\/script>/gi, "");

  // 1. Strip relative-path <link> stylesheets (not http/https/protocol-relative)
  out = out.replace(/<link\b[^>]*\bhref=["'](?!https?:\/\/|\/\/)([^"']+\.css)["'][^>]*>/gi, '');

  // 2. Strip relative-path <script src> tags
  out = out.replace(/<script\b[^>]*\bsrc=["'](?!https?:\/\/|\/\/)([^"']+\.js)["'][^>]*><\/script>/gi, '');

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

function looksLikePayingGuestTemplate(template: ProjectTemplate): boolean {
  const haystack = `${template.name ?? ""}\n${template.cssContent ?? ""}\n${template.jsContent ?? ""}`;
  return /paying\s+guest|\bpg\s+accommodation\b|room-card|amenities-grid|WHATSAPP_NUMBER/i.test(haystack);
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
        <div class="about-img-wrap"><img src="{{heroImageUrl}}" alt="{{businessName}} accommodation"></div>
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
            <div class="room-card-img"><img src="{{heroImageUrl}}" alt="Single room"><span class="room-avail open">Available</span></div>
            <div class="room-card-body"><h3>Single Sharing</h3><div class="room-price"><span class="amt">Contact</span> <span class="per">for rent</span></div><div class="room-feats"><span class="room-feat">✓ Bed and storage</span><span class="room-feat">✓ Meals optional</span><span class="room-feat">✓ Wi-Fi</span></div><a class="btn btn-primary" href="{{whatsappLink}}">Enquire</a></div>
          </article>
          <article class="room-card">
            <div class="room-card-img"><img src="{{heroImageUrl}}" alt="Double sharing room"><span class="room-avail open">Available</span></div>
            <div class="room-card-body"><h3>Double Sharing</h3><div class="room-price"><span class="amt">Contact</span> <span class="per">for rent</span></div><div class="room-feats"><span class="room-feat">✓ Spacious setup</span><span class="room-feat">✓ Study-friendly</span><span class="room-feat">✓ Secure stay</span></div><a class="btn btn-primary" href="{{whatsappLink}}">Enquire</a></div>
          </article>
          <article class="room-card">
            <div class="room-card-img"><img src="{{heroImageUrl}}" alt="Triple sharing room"><span class="room-avail few">Few Left</span></div>
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
        <div class="food-img-wrap"><img src="{{heroImageUrl}}" alt="Homely food"></div>
        <div>
          <span class="section-label">Food</span>
          <h2 class="section-title">Homely Meals Available</h2>
          <p class="section-desc">Fresh, simple meals and a calm living environment for a comfortable stay.</p>
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

function generateHtml(template: ProjectTemplate, data: ProjectData): string {
  let html = hasRenderableHtml(template.htmlContent) || !looksLikePayingGuestTemplate(template)
    ? template.htmlContent
    : buildPayingGuestFallbackHtml();
  const heroImageUrl = getProjectValue(data, "heroImageUrl", DEFAULT_HERO_IMAGE_URL);

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
    "{{phoneLink}}": `tel:${getProjectValue(data, "phone")}`,
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

  html = applyEditableLogoText(html, data);

  return promoteRenderableImages(replaceUnresolvedLocalImages(inlineAvailableServerUploads(html)));
}

async function prepareTemplateForProject(template: ProjectTemplate): Promise<ProjectTemplate> {
  const cleanedHtml = stripImportedExtraPages(template.htmlContent);
  const { html: injectedHtml, placeholders: detectedPh } = injectPlaceholders(cleanedHtml);
  const mergedPh = [...new Set([...(template.placeholders ?? []), ...detectedPh])];

  if (injectedHtml === template.htmlContent && mergedPh.length === (template.placeholders ?? []).length) {
    return template;
  }

  const [updatedTemplate] = await db
    .update(templatesTable)
    .set({ htmlContent: injectedHtml, placeholders: mergedPh })
    .where(eq(templatesTable.id, template.id))
    .returning();

  return updatedTemplate;
}

async function generatePreparedHtmlForProject(project: ProjectData & { templateId?: number | null }): Promise<string | null> {
  if (!project.templateId) return null;

  const [templateRow] = await db
    .select()
    .from(templatesTable)
    .where(eq(templatesTable.id, project.templateId));

  if (!templateRow) return null;

  const template = await prepareTemplateForProject(templateRow);
  return prepareDownloadHtml(generateHtml(template, project));
}

async function getPreviewReadyHtml(project: ProjectData & { templateId?: number | null; generatedHtml?: string | null }): Promise<string | null> {
  if (project.generatedHtml && hasRenderableHtml(project.generatedHtml)) {
    return prepareDownloadHtml(project.generatedHtml);
  }

  return (await generatePreparedHtmlForProject(project))
    ?? (project.generatedHtml ? prepareDownloadHtml(project.generatedHtml) : null);
}

router.get("/", async (req, res): Promise<void> => {
  const query = ListProjectsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const projects = await db
    .select()
    .from(projectsTable)
    .where(query.data.category ? eq(projectsTable.category, query.data.category) : undefined)
    .orderBy(projectsTable.updatedAt);

  const result = query.data.search
    ? projects.filter((p) =>
        p.businessName.toLowerCase().includes(query.data.search!.toLowerCase())
      )
    : projects;

  res.json(result.reverse());
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

  const [project] = await db
    .insert(projectsTable)
    .values({
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
      status: "draft",
    })
    .returning();

  res.status(201).json(project);
});

router.get("/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.id));

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

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.id));

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

  const [project] = await db
    .update(projectsTable)
    .set(updateData)
    .where(eq(projectsTable.id, params.data.id))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (!didExplicitlyUpdateGeneratedHtml) {
    res.json({ ...project, generatedHtml: null });
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

  await db.delete(projectsTable).where(eq(projectsTable.id, params.data.id));
  res.json({ success: true });
});

router.post("/:id/generate", async (req, res): Promise<void> => {
  const params = GenerateProjectParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.id));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (!project.templateId) {
    res.status(400).json({ error: "Project has no template selected" });
    return;
  }

  const [templateRow] = await db
    .select()
    .from(templatesTable)
    .where(eq(templatesTable.id, project.templateId));

  if (!templateRow) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  const template = await prepareTemplateForProject(templateRow);
  const generatedHtml = prepareDownloadHtml(generateHtml(template, project));

  const [updated] = await db
    .update(projectsTable)
    .set({ generatedHtml, status: "generated" })
    .where(eq(projectsTable.id, params.data.id))
    .returning();

  res.json(updated);
});

router.post("/:id/duplicate", async (req, res): Promise<void> => {
  const params = DuplicateProjectParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [original] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.id));

  if (!original) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const [duplicate] = await db
    .insert(projectsTable)
    .values({
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
    })
    .returning();

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
  const [updated] = await db
    .update(projectsTable)
    .set({ generatedHtml: html, updatedAt: new Date() })
    .where(eq(projectsTable.id, id))
    .returning();
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

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, id));

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

  const downloadHtml = await getPreviewReadyHtml(project) ?? prepareDownloadHtml(project.generatedHtml);

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.pipe(res);

  archive.append(downloadHtml, { name: "index.html" });

  // Add a minimal readme
  const readme = `# ${project.businessName} Demo Website\n\nGenerated by Webjal Demo Studio.\nOpen index.html in a browser to preview.\n`;
  archive.append(readme, { name: "README.md" });

  await archive.finalize();
});

export default router;
