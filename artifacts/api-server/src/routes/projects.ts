import { Router } from "express";
import { db, projectsTable, templatesTable } from "@workspace/db";
import { eq, ilike, or } from "drizzle-orm";
import { injectPlaceholders } from "../utils/inject-placeholders";
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

function generateHtml(template: { htmlContent: string; cssContent?: string | null; jsContent?: string | null }, data: Record<string, string | string[]>): string {
  let html = template.htmlContent;

  // Inject CSS and JS if present
  if (template.cssContent) {
    html = html.replace("</head>", `<style>\n${template.cssContent}\n</style>\n</head>`);
  }
  if (template.jsContent) {
    html = html.replace("</body>", `<script>\n${template.jsContent}\n</script>\n</body>`);
  }

  // Replace all placeholders
  const placeholders: Record<string, string> = {
    "{{businessName}}": String(data.businessName ?? ""),
    "{{tagline}}": String(data.tagline ?? ""),
    "{{about}}": String(data.about ?? ""),
    "{{phone}}": String(data.phone ?? ""),
    "{{whatsapp}}": String(data.whatsapp ?? ""),
    "{{email}}": String(data.email ?? ""),
    "{{address}}": String(data.address ?? ""),
    "{{googleMapsLink}}": String(data.googleMapsLink ?? ""),
    "{{instagramLink}}": String(data.instagramLink ?? ""),
    "{{ctaText}}": String(data.ctaText ?? "Get In Touch"),
    "{{primaryColor}}": String(data.primaryColor ?? "#4f46e5"),
    "{{secondaryColor}}": String(data.secondaryColor ?? "#7c3aed"),
    "{{logoUrl}}": String(data.logoUrl ?? ""),
    "{{heroImage}}": String(data.heroImageUrl ?? ""),
    "{{heroImageUrl}}": String(data.heroImageUrl ?? ""),
    "{{whatsappLink}}": `https://wa.me/${String(data.whatsapp ?? "").replace(/[^0-9]/g, "")}`,
    "{{phoneLink}}": `tel:${String(data.phone ?? "")}`,
    "{{emailLink}}": `mailto:${String(data.email ?? "")}`,
    "{{seoTitle}}": `${String(data.businessName ?? "")} - ${String(data.tagline ?? "Welcome")}`,
    "{{metaDescription}}": String(data.about ?? `Welcome to ${String(data.businessName ?? "")}`),
  };

  // Replace services as HTML list items
  const services = Array.isArray(data.services) ? data.services as string[] : [];
  placeholders["{{services}}"] = services.map((s) => `<li>${s}</li>`).join("\n");
  placeholders["{{servicesList}}"] = services.map((s) => `<li>${s}</li>`).join("\n");

  // Replace gallery images
  const gallery = Array.isArray(data.galleryImages) ? data.galleryImages as string[] : [];
  placeholders["{{galleryImages}}"] = gallery.map((url) => `<img src="${url}" alt="Gallery" />`).join("\n");

  for (const [key, value] of Object.entries(placeholders)) {
    html = html.replaceAll(key, value);
  }

  return html;
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

  res.json(project);
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

  let [template] = await db
    .select()
    .from(templatesTable)
    .where(eq(templatesTable.id, project.templateId));

  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  // Auto-inject placeholders if the template has none yet
  if (!template.placeholders || template.placeholders.length === 0) {
    const { html: injectedHtml, placeholders } = injectPlaceholders(template.htmlContent);
    const [updated] = await db
      .update(templatesTable)
      .set({ htmlContent: injectedHtml, placeholders })
      .where(eq(templatesTable.id, template.id))
      .returning();
    template = updated;
  }

  const generatedHtml = generateHtml(template, {
    businessName: project.businessName,
    tagline: project.tagline ?? "",
    about: project.about ?? "",
    phone: project.phone ?? "",
    whatsapp: project.whatsapp ?? "",
    email: project.email ?? "",
    address: project.address ?? "",
    googleMapsLink: project.googleMapsLink ?? "",
    instagramLink: project.instagramLink ?? "",
    ctaText: project.ctaText ?? "Get In Touch",
    primaryColor: project.primaryColor ?? "#4f46e5",
    secondaryColor: project.secondaryColor ?? "#7c3aed",
    logoUrl: project.logoUrl ?? "",
    heroImageUrl: project.heroImageUrl ?? "",
    services: project.services ?? [],
    galleryImages: project.galleryImages ?? [],
  });

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

  const archiver = (await import("archiver")).default;

  const slug = project.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${slug}-demo.zip"`);

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res);

  archive.append(project.generatedHtml, { name: "index.html" });

  // Add a minimal readme
  const readme = `# ${project.businessName} Demo Website\n\nGenerated by Webjal Demo Studio.\nOpen index.html in a browser to preview.\n`;
  archive.append(readme, { name: "README.md" });

  await archive.finalize();
});

export default router;
