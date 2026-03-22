import { TokenMetadata } from "../types.js";

const TYPE_COLORS: Record<string, { bg: string; accent: string; text: string }> = {
  Identity:    { bg: "#0c1220", accent: "#60a5fa", text: "#93bbfc" },
  Attestation: { bg: "#0a1510", accent: "#22c55e", text: "#6ee7a0" },
  Credential:  { bg: "#100c1e", accent: "#a78bfa", text: "#c4b5fd" },
  Receipt:     { bg: "#151008", accent: "#fb923c", text: "#fdba74" },
  Pass:        { bg: "#0a1518", accent: "#22d3ee", text: "#67e8f9" },
};

function generateDefaultImage(metadata: TokenMetadata): string {
  const colors = TYPE_COLORS[metadata.tokenType] || TYPE_COLORS.Attestation;
  const name = metadata.name || "mint.day token";
  const tokenType = metadata.tokenType || "Token";
  const soulbound = metadata.soulbound;

  // Truncate name for display
  const displayName = name.length > 40 ? name.slice(0, 37) + "..." : name;
  // Split into lines if long
  const words = displayName.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > 22) {
      lines.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current.trim());

  const nameLines = lines.slice(0, 3).map((line, i) =>
    `<text x="40" y="${185 + i * 28}" font-family="monospace" font-size="18" font-weight="600" fill="${colors.text}">${escapeXml(line)}</text>`
  ).join("\n    ");

  // Subtle pattern based on token type
  const patternId = `p-${tokenType.toLowerCase()}`;
  let pattern = "";
  if (tokenType === "Identity") {
    pattern = `<pattern id="${patternId}" width="40" height="40" patternUnits="userSpaceOnUse">
      <circle cx="20" cy="20" r="1" fill="${colors.accent}" opacity="0.08"/>
    </pattern>`;
  } else if (tokenType === "Attestation") {
    pattern = `<pattern id="${patternId}" width="32" height="32" patternUnits="userSpaceOnUse">
      <line x1="0" y1="32" x2="32" y2="0" stroke="${colors.accent}" stroke-width="0.5" opacity="0.06"/>
    </pattern>`;
  } else if (tokenType === "Credential") {
    pattern = `<pattern id="${patternId}" width="24" height="24" patternUnits="userSpaceOnUse">
      <rect x="11" y="11" width="2" height="2" fill="${colors.accent}" opacity="0.08"/>
    </pattern>`;
  } else if (tokenType === "Receipt") {
    pattern = `<pattern id="${patternId}" width="36" height="36" patternUnits="userSpaceOnUse">
      <line x1="0" y1="18" x2="36" y2="18" stroke="${colors.accent}" stroke-width="0.5" opacity="0.06"/>
    </pattern>`;
  } else {
    pattern = `<pattern id="${patternId}" width="28" height="28" patternUnits="userSpaceOnUse">
      <circle cx="14" cy="14" r="0.8" fill="${colors.accent}" opacity="0.08"/>
    </pattern>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    ${pattern}
  </defs>
  <rect width="400" height="400" fill="${colors.bg}"/>
  <rect width="400" height="400" fill="url(#${patternId})"/>

  <!-- Top accent line -->
  <rect x="40" y="40" width="48" height="3" rx="1.5" fill="${colors.accent}" opacity="0.8"/>

  <!-- Token type label -->
  <text x="40" y="80" font-family="monospace" font-size="12" fill="${colors.accent}" opacity="0.6" text-transform="uppercase" letter-spacing="2">${escapeXml(tokenType.toUpperCase())}</text>

  <!-- Soulbound badge -->
  ${soulbound ? `<text x="40" y="100" font-family="monospace" font-size="10" fill="${colors.accent}" opacity="0.35">SOULBOUND</text>` : ""}

  <!-- Token name -->
  ${nameLines}

  <!-- Bottom branding -->
  <text x="40" y="350" font-family="monospace" font-size="11" fill="${colors.accent}" opacity="0.2">mint.day</text>

  <!-- Bottom accent line -->
  <rect x="40" y="362" width="320" height="1" rx="0.5" fill="${colors.accent}" opacity="0.1"/>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function encodeMetadata(metadata: TokenMetadata): string {
  // Auto-generate image if none provided
  if (!metadata.image) {
    metadata.image = generateDefaultImage(metadata);
  }

  // Build OpenSea-compatible attributes array
  const attributes: Array<{ trait_type: string; value: string }> = [
    { trait_type: "Token Type", value: metadata.tokenType },
    { trait_type: "Soulbound", value: metadata.soulbound ? "Yes" : "No" },
  ];
  if (metadata.creator && metadata.creator !== "0x0000000000000000000000000000000000000000") {
    attributes.push({ trait_type: "Creator", value: metadata.creator });
  }
  if (metadata.recipient) {
    attributes.push({ trait_type: "Recipient", value: metadata.recipient });
  }
  // Add any capabilities as traits
  if (Array.isArray((metadata as Record<string, unknown>).capabilities)) {
    for (const cap of (metadata as Record<string, unknown>).capabilities as string[]) {
      attributes.push({ trait_type: "Capability", value: cap });
    }
  }

  const enriched = {
    ...metadata,
    attributes,
    external_url: "https://mint.day",
  };

  const json = JSON.stringify(enriched);
  const base64 = Buffer.from(json).toString("base64");
  return `data:application/json;base64,${base64}`;
}
