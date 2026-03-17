import { readFileSync, existsSync } from "fs";
import { basename } from "path";

function isLocalPath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("~/") ||
    value.startsWith("./") ||
    value.startsWith("../")
  );
}

function isDataUri(value: string): boolean {
  return value.startsWith("data:");
}

function isUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function resolvePath(path: string): string {
  return path.startsWith("~/")
    ? path.replace("~", process.env.HOME || "")
    : path;
}

/**
 * Resolve an image value to a URL suitable for on-chain metadata.
 *
 * - URLs pass through unchanged.
 * - Local file paths and data URIs are uploaded to 0x0.st (no API key needed).
 * - Falls back to base64 data URI if upload fails.
 */
export async function resolveImage(image: string): Promise<{ url: string; uploaded: boolean }> {
  if (isUrl(image)) {
    return { url: image, uploaded: false };
  }

  let fileBuffer: Buffer;
  let fileName = "image.png";

  if (isLocalPath(image)) {
    const resolved = resolvePath(image);
    if (!existsSync(resolved)) {
      throw new Error(`Image file not found: ${resolved}`);
    }
    fileBuffer = readFileSync(resolved);
    fileName = basename(resolved);
  } else if (isDataUri(image)) {
    const match = image.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error("Invalid data URI format");
    }
    fileBuffer = Buffer.from(match[2], "base64");
    const ext = match[1].split("/")[1] || "png";
    fileName = `image.${ext}`;
  } else {
    return { url: image, uploaded: false };
  }

  const url = await uploadTo0x0(fileBuffer, fileName);
  return { url, uploaded: true };
}

async function uploadTo0x0(buffer: Buffer, fileName: string): Promise<string> {
  const uint8 = new Uint8Array(buffer);
  const blob = new Blob([uint8]);
  const formData = new FormData();
  formData.append("file", blob, fileName);

  const res = await fetch("https://0x0.st", {
    method: "POST",
    headers: { "User-Agent": "mint.day/0.2.0" },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`0x0.st upload failed (${res.status})`);
  }

  return (await res.text()).trim();
}
