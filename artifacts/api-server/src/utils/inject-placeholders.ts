const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MEDIA_ATTRS =
  "src|srcset|poster|data-src|data-srcset|data-bg|data-background|data-bg-src|data-lazy-src|data-original|data-image|style";

function isImportedAsset(url: string): boolean {
  return (
    /^(?:data|blob):/i.test(url) ||
    /^\/?api\/uploads\//i.test(url) ||
    /^https?:\/\/[^/]+\/api\/uploads\//i.test(url)
  );
}

function maskMediaValues(html: string): { html: string; restore: (masked: string) => string } {
  const values: string[] = [];
  const tokenFor = (value: string) => {
    const token = `__WJ_MEDIA_${values.length}__`;
    values.push(value);
    return token;
  };

  const masked = html
    .replace(
      new RegExp(`\\b(${MEDIA_ATTRS})\\s*=\\s*(["'])(.*?)\\2`, "gi"),
      (_match, attr: string, quote: string, value: string) => `${attr}=${quote}${tokenFor(value)}${quote}`,
    )
    .replace(
      new RegExp(`\\b(${MEDIA_ATTRS})\\s*=\\s*([^"'\\s>]+)`, "gi"),
      (_match, attr: string, value: string) => `${attr}="${tokenFor(value)}"`,
    )
    .replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (_match, quote: string, value: string) => {
      return `url(${quote}${tokenFor(value)}${quote})`;
    });

  return {
    html: masked,
    restore(maskedHtml: string) {
      return maskedHtml.replace(/__WJ_MEDIA_(\d+)__/g, (_match, index: string) => values[Number(index)] ?? "");
    },
  };
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

function stripTags(value: string): string {
  return decodeBasicEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyBusinessName(value: string): boolean {
  const clean = value.trim();
  if (clean.includes("{{")) return false;
  if (clean.length < 3 || clean.length > 80) return false;
  if (clean.split(/\s+/).length > 8) return false;
  return !/^(home|about|services|service|gallery|contact|contact us|menu|book now|get in touch|learn more|welcome|website|demo)$/i.test(clean);
}

function addNameCandidate(candidates: string[], value: string | undefined | null): void {
  if (!value) return;
  const clean = stripTags(value).replace(/\s*[|:-]\s*(?:home|official|website|demo).*$/i, "").trim();
  if (isLikelyBusinessName(clean) && !candidates.some((candidate) => candidate.toLowerCase() === clean.toLowerCase())) {
    candidates.push(clean);
  }
}

function extractBusinessName(html: string): string | null {
  const candidates: string[] = [];
  const headerOrNav = [...html.matchAll(/<(header|nav)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((match) => match[2])
    .join("\n");

  if (headerOrNav) {
    const brandBlocks = [
      ...headerOrNav.matchAll(/<a\b[^>]*(?:class|id)=["'][^"']*(?:logo|brand|navbar-brand|site-title|company)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi),
      ...headerOrNav.matchAll(/<[^>]+\b(?:class|id)=["'][^"']*(?:logo-text|brand-name|brand-title|site-title|company-name)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi),
    ];
    for (const match of brandBlocks) addNameCandidate(candidates, match[1]);
  }

  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) addNameCandidate(candidates, titleMatch[1].trim().split(/\s*(?:\||-|--)\s*/)[0]);

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) addNameCandidate(candidates, h1Match[1]);

  return candidates[0] ?? null;
}

export function injectPlaceholders(html: string): {
  html: string;
  placeholders: string[];
  detected: Record<string, string>;
} {
  let result = html;
  const detected: Record<string, string> = {};
  const ph = new Set<string>();

  // 1. Business name — try <title> first, then <h1> as fallback
  const mediaMask = maskMediaValues(result);
  result = mediaMask.html;
  const extractedName = extractBusinessName(result);

  if (extractedName) {
    const businessName = extractedName;
    detected.businessName = businessName;
    // Replace full name (case-insensitive)
    result = result.replace(new RegExp(esc(businessName), "gi"), "{{businessName}}");
    // Also replace shorter 2-word prefix if name is 3+ words (e.g. "Reyna Salon Academy" → also replace "Reyna Salon")
    const words = businessName.split(/\s+/);
    if (words.length >= 3) {
      const shortName = words.slice(0, 2).join(" ");
      result = result.replace(new RegExp(esc(shortName), "gi"), "{{businessName}}");
    }
    result = result.replace(/<title>[^<]*<\/title>/, "<title>{{seoTitle}}</title>");
    result = result.replace(
      /<meta\s+name="description"\s+content="[^"]*"/,
      '<meta name="description" content="{{metaDescription}}"'
    );
    ph.add("{{businessName}}"); ph.add("{{seoTitle}}"); ph.add("{{metaDescription}}");
  }

  // 2. Phone numbers — Indian 10-digit mobile (skip if already injected)
  const phoneMatches = result.includes("{{phone}}") ? [] : [...result.matchAll(/(\+91[\s\-]?)?[6-9][0-9]{4}[\s\-]?[0-9]{5}/g)];
  if (phoneMatches.length > 0) {
    const freq: Record<string, number> = {};
    phoneMatches.forEach((m) => {
      const d = m[0].replace(/\D/g, "");
      const norm = d.length === 12 ? d.slice(2) : d;
      freq[norm] = (freq[norm] ?? 0) + 1;
    });
    const topDigits = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    if (topDigits.length === 10) {
      detected.phone = `+91 ${topDigits.slice(0, 5)} ${topDigits.slice(5)}`;
      const a = topDigits.slice(0, 5);
      const b = topDigits.slice(5);
      result = result.replace(new RegExp(`(\\+91[\\s\\-]?)?${a}[\\s\\-]?${b}`, "g"), "{{phone}}");
      result = result.replace(/href="https?:\/\/wa\.me\/[0-9]+(\?[^"]*)?"/, 'href="{{whatsappLink}}"');
      result = result.replace(/href="https?:\/\/api\.whatsapp\.com\/send\?phone=[0-9]+([^"]*)?"/, 'href="{{whatsappLink}}"');
      result = result.replace(/href="tel:[^"]*"/g, 'href="{{phoneLink}}"');
      ph.add("{{phone}}"); ph.add("{{whatsapp}}"); ph.add("{{whatsappLink}}"); ph.add("{{phoneLink}}");
    }
  }

  // 3. Email
  const emailMatch = result.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) {
    detected.email = emailMatch[0];
    result = result.replace(new RegExp(esc(emailMatch[0]), "g"), "{{email}}");
    result = result.replace(/href="mailto:[^"]*"/g, 'href="mailto:{{email}}"');
    ph.add("{{email}}"); ph.add("{{emailLink}}");
  }

  result = mediaMask.restore(result);

  // 4. Hero / background image
  const bgMatch = result.match(/background(?:-image)?\s*:\s*url\(['"]?([^'")\s]+)['"]?\)/);
  if (bgMatch && !bgMatch[1].includes("{{") && !isImportedAsset(bgMatch[1])) {
    detected.heroImageUrl = bgMatch[1];
    result = result.replace(new RegExp(esc(bgMatch[1]), "g"), "{{heroImageUrl}}");
    ph.add("{{heroImageUrl}}");
  } else {
    const imgMatch = result.match(/<img[^>]+src="([^"]+)"/);
    if (imgMatch && !imgMatch[1].includes("{{") && !isImportedAsset(imgMatch[1]) && !/cdnjs|font|icon|svg|data:/.test(imgMatch[1])) {
      detected.heroImageUrl = imgMatch[1];
      result = result.replace(imgMatch[1], "{{heroImageUrl}}");
      ph.add("{{heroImageUrl}}");
    }
  }

  // 5. Logo image
  const logoMatch =
    result.match(/<img[^>]+class="[^"]*logo[^"]*"[^>]+src="([^"]+)"/i) ??
    result.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*logo[^"]*"/i);
  if (logoMatch && !logoMatch[1].includes("{{") && !isImportedAsset(logoMatch[1])) {
    detected.logoUrl = logoMatch[1];
    result = result.replace(new RegExp(esc(logoMatch[1]), "g"), "{{logoUrl}}");
    ph.add("{{logoUrl}}");
  }

  // 6. Theme color meta
  const themeMatch = result.match(/<meta\s+name="theme-color"\s+content="([^"]+)"/);
  if (themeMatch) {
    detected.primaryColor = themeMatch[1];
    result = result.replace(
      /<meta\s+name="theme-color"\s+content="[^"]*"/,
      '<meta name="theme-color" content="{{primaryColor}}"'
    );
    ph.add("{{primaryColor}}");
  }

  // Always add standard fields so workspace form shows them
  ["{{tagline}}", "{{address}}", "{{instagramLink}}", "{{ctaText}}", "{{services}}"].forEach((p) => ph.add(p));

  return { html: result, placeholders: [...ph], detected };
}
