/**
 * Cryptographic HMAC-SHA256 Signature Verification for Razorpay Webhooks.
 * Uses W3C Web Cryptography API (crypto.subtle).
 */
export async function verifyRazorpaySignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string
): Promise<boolean> {
  if (!signature || !secret || !rawBody) {
    return false;
  }

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(rawBody)
    );

    const computedHex = Array.from(new Uint8Array(signatureBuffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    const normalizedSig = signature.trim().toLowerCase();

    // Constant-time comparison to prevent timing attacks
    if (computedHex.length !== normalizedSig.length) {
      return false;
    }

    let mismatch = 0;
    for (let i = 0; i < computedHex.length; i++) {
      mismatch |= computedHex.charCodeAt(i) ^ normalizedSig.charCodeAt(i);
    }

    return mismatch === 0;
  } catch (err) {
    console.error("Signature verification internal error:", err);
    return false;
  }
}
