import { corsHeaders } from "../_shared/cors.ts";
import { verifyRazorpaySignature } from "../_shared/crypto.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 0. Fail-Closed Authentication Configuration Guard
  const rawWebhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  const configuredSecrets = (rawWebhookSecret || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (configuredSecrets.length === 0) {
    console.error("[payment-webhook] FATAL: RAZORPAY_WEBHOOK_SECRET is unset or empty; refusing request (503).");
    return new Response(
      JSON.stringify({
        error: "CONFIGURATION_ERROR",
        message: "Webhook authentication is not configured on this server."
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature");
    console.log(`[payment-webhook] Incoming webhook received.`);
    console.log(`[payment-webhook] x-razorpay-signature: ${signature}`);
    console.log(`[payment-webhook] rawBody: ${rawBody}`);

    // 1. Strict Cryptographic HMAC-SHA256 Signature Verification (with secret rotation support)
    let isValid = false;
    let matchedSecret = "";
    for (const secretCandidate of configuredSecrets) {
      if (await verifyRazorpaySignature(rawBody, signature, secretCandidate)) {
        isValid = true;
        matchedSecret = secretCandidate;
        break;
      }
    }

    if (!isValid) {
      console.warn(`[payment-webhook] REJECTED: Invalid HMAC signature. Tested secrets count: ${configuredSecrets.length}`);
      return new Response(
        JSON.stringify({
          error: "INVALID_SIGNATURE",
          message: "Cryptographic HMAC-SHA256 signature verification failed"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[payment-webhook] HMAC-SHA256 signature VERIFIED successfully with secret (length: ${matchedSecret.length}).`);

    // 2. Parse payload & extract event metadata
    const payload = JSON.parse(rawBody);
    const eventType = payload.event || "unknown";

    // Compute SHA-256 body hash for integrity
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(rawBody)
    );
    const bodyHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Provider event ID (from headers or payload)
    const providerEventId =
      req.headers.get("x-razorpay-event-id") ||
      payload.event_id ||
      payload.payload?.payment?.entity?.id ||
      `evt_${bodyHash.slice(0, 20)}`;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 3. Durable Inbox Persistence: private.webhook_events
    const { data: procRes, error: procErr } = await supabase.rpc(
      "persist_webhook_event",
      {
        p_provider: "razorpay",
        p_scope: "standard",
        p_event_id: providerEventId,
        p_event_type: eventType,
        p_raw_body: rawBody,
        p_body_hash: bodyHash,
      }
    );

    if (procErr) {
      console.error("persist_webhook_event error:", procErr);
      throw procErr;
    }

    const eventRecordId = procRes.id;
    const isNew = procRes.is_new;

    // 4. Duplicate Delivery Handling (§10.2)
    if (!isNew) {
      console.log(`Idempotent webhook replay detected for event ${providerEventId}. Returning 200 OK.`);
      return new Response(
        JSON.stringify({
          status: "already_received",
          provider_event_id: providerEventId,
          webhook_event_id: eventRecordId
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Process Event Synchronously
    const { data: processRes, error: processErr } = await supabase.rpc(
      "process_webhook_event",
      {
        p_webhook_event_id: eventRecordId
      }
    );

    if (processErr) {
      console.error("Webhook processing error:", processErr);
      return new Response(
        JSON.stringify({
          status: "error",
          error: processErr.message,
          webhook_event_id: eventRecordId
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        status: processRes.status,
        provider_event_id: providerEventId,
        webhook_event_id: eventRecordId,
        details: processRes
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Internal webhook handler error:", err);
    return new Response(
      JSON.stringify({
        error: "INTERNAL_ERROR",
        message: (err as Error).message
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
