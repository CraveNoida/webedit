const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function injectPlaceholders(html: string): {
  html: string;
  placeholders: string[];
  detected: Record<string, string>;
} {
  let result = html;
  const detected: Record<string, string> = {};
  const ph = new Set<string>();

  // 1. Business name — try <title> first, then <h1> as fallback
  const titleMatch = result.match(/<title>([^<]+)<\/title>/);
  const h1Match = result.match(/<h1[^>]*>\s*(?:<[^>]+>)*\s*([^<]{3,}?)\s*(?:<\/[^>]+>)*\s*<\/h1>/i);

  let extractedName: string | null = null;

  if (titleMatch && !titleMatch[1].includes("{{")) {
    const candidate = titleMatch[1].trim().split(/\s*[—–|\-]\s*/)[0].trim();
    if (candidate && candidate.length > 2) extractedName = candidate;
  }

  // Fallback: use <h1> content if title was generic or missing
  if (!extractedName && h1Match && !h1Match[1].includes("{{")) {
    const candidate = h1Match[1].replace(/<[^>]+>/g, "").trim();
    if (candidate && candidate.length > 2 && candidate.split(/\s+/).length <= 6) {
      extractedName = candidate;
    }
  }

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
      result = result.replace(/href="tel:[^"]*"/g, 'href="tel:{{phone}}"');
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

  // 4. Hero / background image
  const bgMatch = result.match(/background(?:-image)?\s*:\s*url\(['"]?([^'")\s]+)['"]?\)/);
  if (bgMatch && !bgMatch[1].includes("{{")) {
    detected.heroImageUrl = bgMatch[1];
    result = result.replace(new RegExp(esc(bgMatch[1]), "g"), "{{heroImageUrl}}");
    ph.add("{{heroImageUrl}}");
  } else {
    const imgMatch = result.match(/<img[^>]+src="([^"]+)"/);
    if (imgMatch && !imgMatch[1].includes("{{") && !/cdnjs|font|icon|svg|data:/.test(imgMatch[1])) {
      detected.heroImageUrl = imgMatch[1];
      result = result.replace(imgMatch[1], "{{heroImageUrl}}");
      ph.add("{{heroImageUrl}}");
    }
  }

  // 5. Logo image
  const logoMatch =
    result.match(/<img[^>]+class="[^"]*logo[^"]*"[^>]+src="([^"]+)"/i) ??
    result.match(/<img[^>]+src="([^"]+)"[^>]+class="[^"]*logo[^"]*"/i);
  if (logoMatch && !logoMatch[1].includes("{{")) {
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
