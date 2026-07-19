import { Router } from "express";
import { mongo } from "@workspace/db";
import { injectPlaceholders } from "../utils/inject-placeholders";
import { logger } from "../lib/logger";
import { persistDataImageUrls } from "../lib/media-assets";
import {
  ListTemplatesQueryParams,
  CreateTemplateBody,
  GetTemplateParams,
  UpdateTemplateParams,
  UpdateTemplateBody,
  DeleteTemplateParams,
} from "@workspace/api-zod";

const router = Router();
const PLACEHOLDER_IMAGE = "https://placehold.co/16x9?text=";
const DATA_IMAGE_PATTERN = /data:image\/[a-z0-9.+-]+(?:;charset=[^;,]+|;utf-?8|;base64)*,[^"'\s>)]+/gi;
const MAX_HTML_CHARS = 1_800_000;
const MAX_CSS_CHARS = 700_000;
const MAX_JS_CHARS = 500_000;

function cleanText(value: string | undefined): string | undefined {
  return value?.replace(/\u0000/g, "");
}

function stripInlineImages(value: string): string {
  return value.replace(DATA_IMAGE_PATTERN, PLACEHOLDER_IMAGE);
}

function limitText(value: string | null, maxChars: number, label: string): string | null {
  if (value === null || value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n/* ${label} truncated to fit deployment storage limits. */`;
}

function prepareHtmlContent(value: string | undefined): string {
  return limitText(stripInlineImages(cleanText(value) ?? ""), MAX_HTML_CHARS, "HTML") ?? "";
}

function prepareOptionalContent(value: string | undefined, maxChars: number, label: string): string | null {
  if (value === undefined) return null;
  return limitText(stripInlineImages(cleanText(value) ?? ""), maxChars, label);
}

function serverErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown server error";
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

function validateRenderableHtml(html: string): string | null {
  return hasRenderableHtml(html)
    ? null
    : "Template HTML has no visible body content. Import the folder containing the real index.html, or paste the page body before saving.";
}

router.get("/", async (req, res): Promise<void> => {
  const query = ListTemplatesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  try {
    res.json(await mongo.listTemplates(query.data.category));
  } catch (err) {
    req.log?.warn({ err }, "Templates list unavailable");
    logger.warn({ err }, "Templates list unavailable");
    res.json([]);
  }
});

router.post("/", async (req, res): Promise<void> => {
  const body = CreateTemplateBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    // Auto-inject placeholders at creation time so hardcoded names/contacts are templatized immediately.
    const htmlContent = await persistDataImageUrls(prepareHtmlContent(body.data.htmlContent), req);
    const htmlError = validateRenderableHtml(htmlContent);
    if (htmlError) {
      res.status(400).json({ error: htmlError });
      return;
    }

    const preparedCss = prepareOptionalContent(body.data.cssContent, MAX_CSS_CHARS, "CSS");
    const cssContent = preparedCss !== null ? await persistDataImageUrls(preparedCss, req) : null;
    const thumbnailUrl = body.data.thumbnailUrl?.startsWith("data:image")
      ? null
      : body.data.thumbnailUrl ?? null;
    const { html: injectedHtml, placeholders: detectedPh } = injectPlaceholders(htmlContent);
    const mergedPh = [...new Set([...(body.data.placeholders ?? []), ...detectedPh])];

    const template = await mongo.createTemplate({
      name: body.data.name,
      category: body.data.category,
      description: cleanText(body.data.description) ?? null,
      htmlContent: injectedHtml,
      cssContent,
      jsContent: prepareOptionalContent(body.data.jsContent, MAX_JS_CHARS, "JavaScript"),
      thumbnailUrl,
      placeholders: mergedPh,
    });

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

  const template = await mongo.getTemplate(params.data.id);

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
    const htmlContent = await persistDataImageUrls(prepareHtmlContent(body.data.htmlContent), req);
    const htmlError = validateRenderableHtml(htmlContent);
    if (htmlError) {
      res.status(400).json({ error: htmlError });
      return;
    }

    const { html: injectedHtml, placeholders: detectedPh } = injectPlaceholders(htmlContent);
    updateData.htmlContent = injectedHtml;
    updateData.placeholders = [...new Set([...(body.data.placeholders ?? []), ...detectedPh])];
  }
  if (body.data.cssContent !== undefined) {
    const preparedCss = prepareOptionalContent(body.data.cssContent, MAX_CSS_CHARS, "CSS");
    updateData.cssContent = preparedCss !== null ? await persistDataImageUrls(preparedCss, req) : null;
  }
  if (body.data.jsContent !== undefined) updateData.jsContent = prepareOptionalContent(body.data.jsContent, MAX_JS_CHARS, "JavaScript");
  if (body.data.thumbnailUrl !== undefined) {
    updateData.thumbnailUrl = body.data.thumbnailUrl.startsWith("data:image")
      ? null
      : body.data.thumbnailUrl;
  }
  if (body.data.placeholders !== undefined && body.data.htmlContent === undefined) updateData.placeholders = body.data.placeholders;

  const template = await mongo.updateTemplate(params.data.id, updateData);

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

  await mongo.deleteTemplate(params.data.id);
  res.json({ success: true });
});

// Smart placeholder auto-injection — detects hardcoded business data and replaces with {{tokens}}
router.post("/:id/inject", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const template = await mongo.getTemplate(id);
  if (!template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  const { html, placeholders, detected } = injectPlaceholders(template.htmlContent);

  const updated = await mongo.updateTemplate(id, { htmlContent: html, placeholders });

  res.json({ template: updated, detected });
});

export default router;
