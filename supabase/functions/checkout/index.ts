import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET");

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

  try {
    const authHeader = req.headers.get("Authorization");
    const idempotencyHeader = req.headers.get("x-idempotency-key");
    const body = await req.json().catch(() => ({}));

    const bookingId = body.booking_id;
    const idempotencyKey = body.idempotency_key || idempotencyHeader;
    const purpose = body.purpose || "initial";

    if (!bookingId || !idempotencyKey) {
      return new Response(
        JSON.stringify({
          error: "BAD_REQUEST",
          message: "booking_id and idempotency_key are required"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Client with user JWT if provided, otherwise service role client
    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      authHeader ? { global: { headers: { Authorization: authHeader } } } : {}
    );

    // 1. Durable Payment Order Intent via transactional DB procedure
    const { data: orderData, error: orderErr } = await supabase.rpc(
      "create_or_get_payment_order",
      {
        p_booking_id: bookingId,
        p_idempotency_key: idempotencyKey,
        p_purpose: purpose
      }
    );

    if (orderErr) {
      console.error("create_or_get_payment_order error:", orderErr);
      const statusCode = orderErr.code === "P0002" ? 404 :
                         orderErr.code === "42501" ? 403 : 400;
      return new Response(
        JSON.stringify({ error: orderErr.message, code: orderErr.code }),
        { status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Idempotency Check: if order already exists and has provider order ID, return it immediately
    const isLiveGateway = Boolean(
      RAZORPAY_KEY_ID &&
      RAZORPAY_KEY_SECRET &&
      !RAZORPAY_KEY_ID.startsWith("rzp_test_placeholder")
    );

    if (orderData.provider_order_id && orderData.status === "ready") {
      console.log(`Idempotent replay for order ${orderData.order_id}: returning existing provider_order_id ${orderData.provider_order_id}`);
      return new Response(
        JSON.stringify({
          order_id: orderData.order_id,
          provider_order_id: orderData.provider_order_id,
          amount_minor: orderData.amount_minor,
          currency: orderData.currency,
          status: orderData.status,
          is_existing: true,
          adapter_mode: isLiveGateway ? "real" : "sandbox",
          key_id: RAZORPAY_KEY_ID || "rzp_test_sandbox_dummy_key"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Provider Order Creation
    let providerOrderId: string;
    let adapterMode: "real" | "sandbox";
    let rzpData: any = null;

    if (isLiveGateway) {
      // Live Gateway call to Razorpay
      adapterMode = "real";
      const basicAuth = btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);
      let rzpRes: Response;
      try {
        rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: {
            "Authorization": `Basic ${basicAuth}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            amount: orderData.amount_minor,
            currency: orderData.currency,
            receipt: `rcpt_${orderData.order_id.slice(0, 12)}`,
            notes: {
              booking_id: bookingId,
              order_id: orderData.order_id
            }
          })
        });
      } catch (fetchErr: any) {
        console.error("Razorpay network error:", fetchErr);
        return new Response(
          JSON.stringify({
            error: "GATEWAY_ERROR",
            details: fetchErr?.message || String(fetchErr),
            message: `Payment gateway network error: ${fetchErr?.message || String(fetchErr)}`
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!rzpRes.ok) {
        const errBody = await rzpRes.text();
        console.error("Razorpay API error:", errBody);
        let parsedErr: any = null;
        try { parsedErr = JSON.parse(errBody); } catch (_) {}
        const errorDesc = parsedErr?.error?.description || errBody;
        return new Response(
          JSON.stringify({
            error: "GATEWAY_ERROR",
            details: errBody,
            message: `Razorpay Error: ${errorDesc}`
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      rzpData = await rzpRes.json();
      console.log("Raw Razorpay Order Response:", JSON.stringify(rzpData));
      providerOrderId = rzpData.id;
    } else {
      // Deterministic Sandbox Adapter: Realistic Razorpay order identifier format
      adapterMode = "sandbox";
      providerOrderId = `order_rzp_mock_${idempotencyKey.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 24)}`;
    }

    // 4. Update order with provider_order_id and status = 'ready'
    const { error: updateErr } = await supabase.rpc(
      "update_payment_order_provider",
      {
        p_order_id: orderData.order_id,
        p_provider_order_id: providerOrderId,
        p_status: "ready"
      }
    );

    if (updateErr) {
      console.error("update_payment_order_provider error:", updateErr);
      throw updateErr;
    }

    return new Response(
      JSON.stringify({
        order_id: orderData.order_id,
        provider_order_id: providerOrderId,
        amount_minor: orderData.amount_minor,
        currency: orderData.currency,
        status: "ready",
        is_existing: false,
        adapter_mode: adapterMode,
        key_id: RAZORPAY_KEY_ID || "rzp_test_sandbox_dummy_key",
        raw_order: isLiveGateway ? rzpData : null
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Internal checkout error:", err);
    return new Response(
      JSON.stringify({ error: "INTERNAL_ERROR", message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
