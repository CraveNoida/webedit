import { Router } from "express";
import { db, templatesTable } from "@workspace/db";
import { eq, ilike } from "drizzle-orm";
import { injectPlaceholders } from "../utils/inject-placeholders";
import { logger } from "../lib/logger";
import {
  ListTemplatesQueryParams,
  CreateTemplateBody,
  GetTemplateParams,
  UpdateTemplateParams,
  UpdateTemplateBody,
  DeleteTemplateParams,
} from "@workspace/api-zod";

const router = Router();

function cleanText(value: string | undefined): string | undefined {
  return value?.replace(/\u0000/g, "");
}

function serverErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown server error";
}

router.get("/", async (req, res): Promise<void> => {
  const query = ListTemplatesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const templates = await db
    .select()
    .from(templatesTable)
    .where(query.data.category ? eq(templatesTable.category, query.data.category) : undefined)
    .orderBy(templatesTable.createdAt);

  res.json(templates);
});

router.post("/", async (req, res): Promise<void> => {
  const body = CreateTemplateBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    // Auto-inject placeholders at creation time so hardcoded names/contacts are templatized immediately.
    const htmlContent = cleanText(body.data.htmlContent) ?? "";
    const { html: injectedHtml, placeholders: detectedPh } = injectPlaceholders(htmlContent);
    const mergedPh = [...new Set([...(body.data.placeholders ?? []), ...detectedPh])];

    const [template] = await db
      .insert(templatesTable)
      .values({
        name: body.data.name,
        category: body.data.category,
        description: cleanText(body.data.description) ?? null,
        htmlContent: injectedHtml,
        cssContent: cleanText(body.data.cssContent) ?? null,
        jsContent: cleanText(body.data.jsContent) ?? null,
        thumbnailUrl: body.data.thumbnailUrl ?? null,
        placeholders: mergedPh,
      })
      .returning();

    res.status(201).json(template);
  } catch (err) {
    logger.error({ err }, "Failed to create template");
    res.status(500).json({
      error: `Failed to create template: ${serverErrorMessage(err)}`,
    });
  }
});

router.get("/:id", async (req, res): Promise<void> => {
  const params = GetTemplateParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [template] = await db
    .select()
    .from(templatesTable)
    .where(eq(templatesTable.id, params.data.id));

  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  res.json(template);
});

router.put("/:id", async (req, res): Promise<void> => {
  const params = UpdateTemplateParams.safeParse({ id: Number(req.params.id) });
  const body = UpdateTemplateBody.safeParse(req.body);

  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (body.data.name !== undefined) updateData.name = body.data.name;
  if (body.data.category !== undefined) updateData.category = body.data.category;
  if (body.data.description !== undefined) updateData.description = cleanText(body.data.description) ?? null;
  if (body.data.htmlContent !== undefined) {
    const htmlContent = cleanText(body.data.htmlContent) ?? "";
    const { html: injectedHtml, placeholders: detectedPh } = injectPlaceholders(htmlContent);
    updateData.htmlContent = injectedHtml;
    updateData.placeholders = [...new Set([...(body.data.placeholders ?? []), ...detectedPh])];
  }
  if (body.data.cssContent !== undefined) updateData.cssContent = cleanText(body.data.cssContent) ?? null;
  if (body.data.jsContent !== undefined) updateData.jsContent = cleanText(body.data.jsContent) ?? null;
  if (body.data.thumbnailUrl !== undefined) updateData.thumbnailUrl = body.data.thumbnailUrl;
  if (body.data.placeholders !== undefined && body.data.htmlContent === undefined) updateData.placeholders = body.data.placeholders;

  const [template] = await db
    .update(templatesTable)
    .set(updateData)
    .where(eq(templatesTable.id, params.data.id))
    .returning();

  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  res.json(template);
});

router.delete("/:id", async (req, res): Promise<void> => {
  const params = DeleteTemplateParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.delete(templatesTable).where(eq(templatesTable.id, params.data.id));
  res.json({ success: true });
});

// Smart placeholder auto-injection — detects hardcoded business data and replaces with {{tokens}}
router.post("/:id/inject", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [template] = await db.select().from(templatesTable).where(eq(templatesTable.id, id));
  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  const { html, placeholders, detected } = injectPlaceholders(template.htmlContent);

  const [updated] = await db
    .update(templatesTable)
    .set({ htmlContent: html, placeholders })
    .where(eq(templatesTable.id, id))
    .returning();

  res.json({ template: updated, detected });
});

export default router;
