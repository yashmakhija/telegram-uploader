import crypto from "crypto";
import { config } from "../config/index.js";
import logger from "./logger.js";

const SECRET_KEY = config.security.urlSignatureSecret;
const SIGNATURE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Generates a signed URL for secure file access
 * Simplified to use only fileId and expiry for more reliable signatures
 */
export function generateSignedUrl(
  fileId: string,
  ipAddress?: string
): {
  expires: number;
  signature: string;
} {
  const expires = Date.now() + SIGNATURE_EXPIRY_MS;

  // Create the string to sign - simplified to just use fileId and expires
  const stringToSign = `fileId=${fileId}&expires=${expires}${
    ipAddress ? `&ip=${ipAddress}` : ""
  }`;

  // Generate HMAC signature
  const signature = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(stringToSign)
    .digest("hex");

  return {
    expires,
    signature,
  };
}

/**
 * Validates a signed URL
 * Simplified to match the generation function
 */
export function validateSignedUrl(
  fileId: string,
  expires: number,
  signature: string,
  ipAddress?: string
): boolean {
  // Check if URL has expired
  if (Date.now() > expires) {
    logger.warn(`URL expired for file ${fileId}`);
    return false;
  }

  // Recreate the string that was signed - same format as generation
  const stringToSign = `fileId=${fileId}&expires=${expires}${
    ipAddress ? `&ip=${ipAddress}` : ""
  }`;

  // Generate HMAC signature to compare
  const expectedSignature = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(stringToSign)
    .digest("hex");

  // Compare signatures (constant-time comparison to prevent timing attacks)
  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );

    if (!isValid) {
      logger.warn(`Invalid signature for file ${fileId}`);
    }

    return isValid;
  } catch (error) {
    // Handle potential buffer length mismatches
    logger.warn(
      `Signature validation error for file ${fileId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
  }
}

/**
 * Creates a signed redirect URL
 */
export function createSignedRedirectUrl(
  baseUrl: string,
  fileId: string
): string {
  const { expires, signature } = generateSignedUrl(fileId);

  // Create URL with query parameters
  const redirectUrl = new URL(`${baseUrl}/download/redirect/${fileId}`);
  redirectUrl.searchParams.append("expires", expires.toString());
  redirectUrl.searchParams.append("signature", signature);

  return redirectUrl.toString();
}
