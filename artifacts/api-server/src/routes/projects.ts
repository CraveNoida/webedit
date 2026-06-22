import { Router } from "express";
import { db, projectsTable, templatesTable } from "@workspace/db";
import { eq, ilike, or } from "drizzle-orm";
import { injectPlaceholders } from "../utils/inject-placeholders";
import { ZipArchive } from "archiver";
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
  "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1600&q=80";

function stripImportedExtraPages(html: string): string {
  return html.replace(/[\r\n]*\s*<!--\s*═══[\s\S]*?(?=<\/body>)/i, "\n");
}

/**
 * Prepares generated HTML for offline use:
 * - Removes relative-path CSS/JS refs that don't exist in the ZIP
 * - Hides loading-screen overlays in the markup so they don't block content
 * - Injects a script that continuously forces content visible, overriding
 *   GSAP/ScrollTrigger/AOS/WOW.js animations that keep sections at opacity:0
 */
function prepareDownloadHtml(html: string): string {
  let out = stripImportedExtraPages(html);

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
    'section','article','header','footer','main','nav',
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

function getProjectValue(data: ProjectData, key: keyof ProjectData, fallback = ""): string {
  const value = data[key];
  if (typeof value !== "string") return fallback;
  return value.trim() || fallback;
}

function isLocalImageUrl(url: string): boolean {
  const clean = url.trim();
  if (!clean || clean.includes("{{")) return false;
  if (/^(?:https?:)?\/\//i.test(clean)) return false;
  if (/^(?:data|blob):/i.test(clean)) return false;
  if (/^\/?api\/uploads\//i.test(clean)) return false;
  return /\.(?:jpe?g|png|webp|gif|svg|ico|bmp|avif)(?:[?#].*)?$/i.test(clean);
}

function replaceUnresolvedLocalImages(html: string): string {
  return html
    .replace(
      /\b(src|data-src|data-bg)=["']([^"']+)["']/gi,
      (match, attr: string, url: string) =>
        isLocalImageUrl(url) ? `${attr}="${DEFAULT_HERO_IMAGE_URL}"` : match,
    )
    .replace(
      /url\((["']?)([^"')]+)\1\)/gi,
      (match, quote: string, url: string) =>
        isLocalImageUrl(url) ? `url(${quote}${DEFAULT_HERO_IMAGE_URL}${quote})` : match,
    );
}

function generateHtml(template: { htmlContent: string; cssContent?: string | null; jsContent?: string | null }, data: ProjectData): string {
  let html = template.htmlContent;
  const heroImageUrl = getProjectValue(data, "heroImageUrl", DEFAULT_HERO_IMAGE_URL);

  // Inject CSS and JS if present
  if (template.cssContent) {
    html = html.replace("</head>", `<style>\n${template.cssContent}\n</style>\n</head>`);
  }
  if (template.jsContent) {
    html = html.replace("</body>", `<script>\n${template.jsContent}\n</script>\n</body>`);
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
    "{{logoUrl}}": getProjectValue(data, "logoUrl"),
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

  return replaceUnresolvedLocalImages(html);
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
      logoUrl: body.data.logoUrl ?? null,
      heroImageUrl: body.data.heroImageUrl ?? null,
      galleryImages: body.data.galleryImages ?? [],
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

  // Always serve preview-ready HTML so existing projects don't show stuck loaders.
  // prepareDownloadHtml is idempotent (wj-reveal script guards against double-inject).
  if (project.generatedHtml) {
    res.json({ ...project, generatedHtml: prepareDownloadHtml(project.generatedHtml) });
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

  if (!project.generatedHtml) {
    res.status(404).send("Project has not been generated yet.");
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(prepareDownloadHtml(project.generatedHtml));
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

  const [project] = await db
    .update(projectsTable)
    .set(updateData)
    .where(eq(projectsTable.id, params.data.id))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const didExplicitlyUpdateGeneratedHtml = body.data.generatedHtml !== undefined;
  const didUpdateDetails = Object.keys(updateData).some((field) => field !== "generatedHtml" && field !== "status");

  if (didUpdateDetails && !didExplicitlyUpdateGeneratedHtml && project.templateId) {
    const generatedHtml = await generatePreparedHtmlForProject(project);
    if (generatedHtml) {
      const [regenerated] = await db
        .update(projectsTable)
        .set({ generatedHtml, status: "generated" })
        .where(eq(projectsTable.id, project.id))
        .returning();
      res.json(regenerated);
      return;
    }
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

  const downloadHtml = prepareDownloadHtml(project.generatedHtml);

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.pipe(res);

  archive.append(downloadHtml, { name: "index.html" });

  // Add a minimal readme
  const readme = `# ${project.businessName} Demo Website\n\nGenerated by Webjal Demo Studio.\nOpen index.html in a browser to preview.\n`;
  archive.append(readme, { name: "README.md" });

  await archive.finalize();
});

export default router;
