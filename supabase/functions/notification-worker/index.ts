// Supabase Edge Function: notification-worker
// Handles asynchronous multi-channel notification delivery using the Deterministic Sandbox Adapter

import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

interface DispatchRequest {
  worker_id?: string;
  batch_size?: number;
  lease_duration_sec?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-key",
      },
    });
  }

  // Enforce internal worker authentication strictly via INTERNAL_WORKER_SECRET
  const authHeader = req.headers.get("authorization");
  const workerKey = req.headers.get("x-worker-key");

  // Resolve worker secret strictly from environment (no hardcoded fallback, no service-role key bypass)
  const internalSecret = Deno.env.get("INTERNAL_WORKER_SECRET");

  // Fail closed if internalSecret is not configured or does not match
  const isAuthorized = Boolean(
    internalSecret &&
    internalSecret.trim().length > 0 &&
    (
      (workerKey && workerKey === internalSecret) ||
      (authHeader && authHeader === `Bearer ${internalSecret}`)
    )
  );

  if (!isAuthorized) {
    return new Response(
      JSON.stringify({ error: "UNAUTHORIZED", message: "Missing or invalid worker authorization" }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  const client = new Client(DB_URL);
  try {
    await client.connect();

    let body: DispatchRequest = {};
    try {
      body = await req.json();
    } catch {
      // Use defaults if empty body
    }

    const workerId = body.worker_id || `notif_worker_${crypto.randomUUID().slice(0, 8)}`;
    const batchSize = body.batch_size || 10;
    const leaseDuration = `${body.lease_duration_sec || 30} seconds`;

    // 1. Claim pending outbox events for topic 'notification.dispatch'
    const claimRes = await client.queryObject<{
      id: string;
      topic: string;
      payload: {
        notification_id: string;
        user_id: string;
        kind: string;
        title: string;
        channels: string[];
      };
      attempts: number;
    }>(
      `select id, topic, payload, attempts from private.claim_outbox_batch($1, $2, $3::interval, 'notification.dispatch')`,
      [workerId, batchSize, leaseDuration]
    );

    const claimedEvents = claimRes.rows;
    const results = [];

    for (const event of claimedEvents) {
      const notifId = event.payload.notification_id;

      // 2. Fetch pending or retryable deliveries for this notification
      const delivRes = await client.queryObject<{
        id: string;
        channel: string;
        recipient_key: string;
        attempts: number;
      }>(
        `select id, channel, recipient_key, attempts from private.notification_deliveries 
         where notification_id = $1 and status in ('pending', 'failed')
           and (next_attempt_at is null or next_attempt_at <= now())`,
        [notifId]
      );

      let allResolved = true;

      for (const delivery of delivRes.rows) {
        const { id: delivId, channel, recipient_key, attempts } = delivery;

        // Simulated Failure / Suppression checks
        if (recipient_key.startsWith("suppress_") || recipient_key === "invalid_token_suppressed") {
          // Permanently suppressed (e.g. uninstalled app, bounced email)
          await client.queryArray(
            `update private.notification_deliveries 
             set status = 'suppressed', last_error = 'UNRECOVERABLE_RECIPIENT: Recipient key permanently invalidated',
                 attempts = attempts + 1
             where id = $1`,
            [delivId]
          );

          // Revoke device token if push
          if (channel === "push") {
            await client.queryArray(
              `update private.device_tokens set revoked_at = now() where token = $1`,
              [recipient_key]
            );
          }
        } else if (recipient_key.startsWith("fail_") || recipient_key.includes("error")) {
          // Transient failure -> compute exponential backoff
          const nextAttemptSeconds = Math.min(300, Math.pow(2, attempts + 1));
          await client.queryArray(
            `update private.notification_deliveries 
             set status = 'failed', 
                 attempts = attempts + 1,
                 last_error = 'PROVIDER_TRANSIENT_ERROR: Simulated upstream gateway timeout',
                 next_attempt_at = now() + ($1 || ' seconds')::interval
             where id = $2`,
            [nextAttemptSeconds, delivId]
          );
          allResolved = false;
        } else {
          // Successful delivery using Deterministic Sandbox Adapter
          const providerMsgId = `mock_${channel}_msg_${crypto.randomUUID().slice(0, 16)}`;
          await client.queryArray(
            `update private.notification_deliveries 
             set status = 'delivered', 
                 provider_message_id = $1,
                 delivered_at = now(),
                 last_error = null,
                 attempts = attempts + 1
             where id = $2`,
            [providerMsgId, delivId]
          );
        }
      }

      // If all deliveries are resolved (delivered or suppressed), complete outbox event
      if (allResolved) {
        await client.queryArray(`select private.complete_outbox_event($1)`, [event.id]);
      }

      results.push({
        event_id: event.id,
        notification_id: notifId,
        deliveries_processed: delivRes.rows.length,
        completed: allResolved,
      });
    }

    await client.end();

    return new Response(
      JSON.stringify({
        status: "ok",
        worker_id: workerId,
        claimed_events: claimedEvents.length,
        results,
        adapter_mode: "deterministic_sandbox",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    if (client) {
      try {
        await client.end();
      } catch {
        // ignore
      }
    }
    return new Response(
      JSON.stringify({
        error: "WORKER_ERROR",
        message: (err as Error).message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
