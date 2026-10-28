/* =============================================================
  utils/promptBuilder.js
============================================================= */

function buildPrompt(tool, input) {
  switch (tool) {

    case "hashtag":
      return `Generate 20 viral Instagram hashtags for: ${input}. Return only the hashtags, one per line.`;

    case "readme":
      return `Generate a professional GitHub README.md for: ${input}. Include badges, installation, usage, and contributing sections.`;

    case "seo":
      return `Write an SEO-optimized meta title (max 60 chars) and meta description (max 160 chars) for: ${input}.\nFormat:\nTitle: ...\nDescription: ...`;

    case "blog":
      return `Write a detailed, engaging blog article about: ${input}. Include an intro, 3-5 sections with subheadings, and a conclusion.`;

    case "landing": {
      let landingInput;

      try {
        landingInput = JSON.parse(input);
      } catch {
        throw new Error("Landing input must be valid JSON");
      }

      const {
        businessName,
        description,
        industry,
        tone,
        primaryColor,
        sections,
        cta,
        targetAudience,
      } = landingInput;

      return `You are an expert frontend developer and UI/UX designer. Generate a complete, stunning, production-ready single-page HTML landing page.

BUSINESS: ${businessName || "My Business"}
DESCRIPTION: ${description || "A great product or service"}
INDUSTRY: ${industry || "Technology"}
TONE: ${tone || "Professional"}
PRIMARY COLOR: ${primaryColor || "#6366f1"}
CTA TEXT: ${cta || "Get Started"}
TARGET AUDIENCE: ${targetAudience || "General audience"}
SECTIONS TO INCLUDE: ${Array.isArray(sections) ? sections.join(", ") : "hero, features, cta, footer"}

STRICT RULES:
- Return ONLY raw HTML. Start with <!DOCTYPE html> and end with </html>.
- No markdown, no code fences, no explanation text before or after.
- Inline ALL CSS inside a <style> tag. Use Google Fonts via @import.
- Use CSS variables, flexbox, grid, smooth scroll, and fade-in animations via IntersectionObserver (vanilla JS only).
- Fully mobile responsive. Include hamburger menu if nav/header is present.
- Design must be visually stunning: gradients, shadows, modern layout — not generic.
- Primary brand color ${primaryColor || "#6366f1"} must be used throughout.
- CTA buttons must say: "${cta || "Get Started"}".
- Include realistic, relevant placeholder content for the business and industry.
- Animate elements on scroll using IntersectionObserver.
- Design should feel like it was made by a top-tier agency.`;
    }

    default:
      return input;
  }
}

export default buildPrompt;