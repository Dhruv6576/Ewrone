# Feature Specification: Multi-Slot Booking, Owner-Configurable Advance Payment & Venue Balance Collection

## 1. Overview & Architecture Summary

This document specifies the backend contracts, data structures, invariants, and frontend integration guidelines for:
1. **Multi-Slot Contiguous Booking**: Booking contiguous time increments in a single booking hold up to the resource's `maximum_duration_minutes`.
2. **Owner-Configurable Advance Payment**: Supporting both fixed amount per slot (`advance_fixed_per_slot_minor`) and percentage basis points (`advance_basis_points`).
3. **Venue Balance Collection**: Collecting remaining booking balances offline at the venue (cash, UPI, card, other) with audit logging and zero-ledger distortion.

---

## 2. Multi-Slot Booking Constraints & Invariants

### 2.1 Duration Bounds & Increment Alignment
Every resource enforces hard duration and increment constraints:
- `booking_increment_minutes`: All constituent slots must be exact multiples of this increment (typically 30 or 60 minutes).
- `minimum_duration_minutes`: Minimum allowed duration (e.g., 60 minutes).
- `maximum_duration_minutes`: Maximum allowed duration for a single continuous booking (e.g., 240 minutes across all current seeded resources).

> [!IMPORTANT]
> **Frontend Constraint Bound**: Every seeded venue resource currently specifies `maximum_duration_minutes = 240`.
> - For 30-minute increment resources (e.g. The Dugout Match Pitch A), a player can select up to **8 consecutive slots** in a single booking.
> - For 60-minute increment resources (e.g. SmashBox Center Court, Apex Arena Pitch 1 & 2), a player can select up to **4 consecutive slots** in a single booking.
> Requests exceeding `maximum_duration_minutes` are rejected with `DURATION_TOO_LONG (22023)`.

### 2.2 Strict Contiguity & Operating Hours Coverage
- Multi-slot holds must form a strictly contiguous time interval `[starts_at, ends_at)`.
- The entire interval must fall completely within the resource's published `operating_hours` for each day it spans (enforced by `private.assert_within_operating_hours`).
- Inverted or zero-duration ranges (`ends_at <= starts_at`) are rejected with `INVALID_TIME_RANGE (22023)`.

---

## 3. Advance Payment Model

### 3.1 Precedence & Calculation Logic
Turfs configure advance payment rules in `public.turf_booking_settings`:
1. **Fixed Advance Per Slot (`advance_fixed_per_slot_minor`)**:
   - If non-null, this policy takes precedence.
   - Calculation: `required_online_minor = advance_fixed_per_slot_minor * slot_count`.
2. **Percentage Advance (`advance_basis_points`)**:
   - Used when `advance_fixed_per_slot_minor` is null and `advance_basis_points` is configured (1 to 10000 bps, where 10000 = 100%).
   - Calculation: `required_online_minor = round((total_minor * advance_basis_points) / 10000.0)`.
3. **Default / Full Payment**:
   - If neither setting is configured, or if the caller explicitly specifies payment mode `'full'`, `required_online_minor := total_minor`.

### 3.2 Clamping & Zero-Advance Policy (Option (i) Decision)
- **Zero-Advance Policy**: To prevent uncollectable bookings and ambiguous zero-rupee payment orders, `advance_fixed_per_slot_minor` must be strictly positive:
  ```sql
  CHECK (advance_fixed_per_slot_minor IS NULL OR advance_fixed_per_slot_minor > 0)
  ```
- **Clamping**: `required_online_minor` is clamped to `[0, total_minor]`.
- **Balance Due**: `balance_due_minor = total_minor - required_online_minor`.

---

## 4. API & RPC Contracts

### 4.1 `public.quote_booking`
Calculates authoritative pricing, constituent increments, and required online payment.

```sql
public.quote_booking(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_payment_mode text DEFAULT 'auto' -- 'auto' | 'advance' | 'full'
) RETURNS jsonb
```

#### Return Payload Schema:
```json
{
  "resource_id": "5381fbc0-9ca9-4de7-bd58-294ea4e76ea0",
  "starts_at": "2026-11-26T01:30:00+00:00",
  "ends_at": "2026-11-26T03:00:00+00:00",
  "total_minor": 300000,
  "required_online_minor": 90000,
  "balance_due_minor": 210000,
  "payment_mode": "advance",
  "advance_mode": "fixed_per_slot",
  "slot_count": 3,
  "currency": "INR",
  "pricing_snapshot": {
    "resource_id": "5381fbc0-9ca9-4de7-bd58-294ea4e76ea0",
    "increment_minutes": 30,
    "increments_count": 3,
    "slot_count": 3,
    "advance_mode": "fixed_per_slot",
    "increments": [
      {
        "starts_at": "2026-11-26T01:30:00+00:00",
        "ends_at": "2026-11-26T02:00:00+00:00",
        "amount_minor": 100000,
        "priority": 0,
        "rule_id": "..."
      },
      {
        "starts_at": "2026-11-26T02:00:00+00:00",
        "ends_at": "2026-11-26T02:30:00+00:00",
        "amount_minor": 100000,
        "priority": 0,
        "rule_id": "..."
      },
      {
        "starts_at": "2026-11-26T02:30:00+00:00",
        "ends_at": "2026-11-26T03:00:00+00:00",
        "amount_minor": 100000,
        "priority": 0,
        "rule_id": "..."
      }
    ]
  },
  "cancellation_snapshot": {
    "policy_id": "...",
    "name": "Standard Flexible",
    "version": 1,
    "rules": [{ "hours_before": 24, "refund_percent": 100 }]
  }
}
```

### 4.2 `public.create_booking_hold`
Creates an atomic hold reservation across all constituent slots.

```sql
public.create_booking_hold(
  p_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_idempotency_key text,
  p_contact_name text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_contact_email text DEFAULT NULL,
  p_payment_mode text DEFAULT 'auto' -- 'auto' | 'advance' | 'full'
) RETURNS jsonb
```

### 4.3 Online Checkout & Payment Orders
Online payments use `public.create_or_get_payment_order(p_booking_id, p_idempotency_key, p_purpose)`.
- `p_purpose` allowed: `'initial'`, `'advance'`, `'full'`.
- **Venue-Only Invariant**: Calling `create_or_get_payment_order` with `p_purpose = 'balance'` is strictly blocked and raises:
  ```
  BALANCE_VENUE_ONLY: Outstanding balance must be collected at the venue (errcode: 22023)
  ```
- **Positive Amount Guard**: Zero or negative payment order amounts raise `NO_BALANCE_DUE (22023)`.

### 4.4 `public.owner_record_balance_collection`
Enables counter staff and venue managers to record offline cash, UPI, or card collections.

```sql
public.owner_record_balance_collection(
  p_booking_id uuid,
  p_amount_minor bigint,
  p_method text, -- 'cash' | 'upi' | 'card' | 'other'
  p_idempotency_key text
) RETURNS jsonb
```

#### Authorization & Guards:
- **Capability**: Caller must possess `payments.record_offline` capability on the turf.
- **Booking Status**: Must be `'confirmed'`.
- **Validation**: `p_amount_minor > 0` and `p_amount_minor <= balance_due_minor`. Attempting to collect more than outstanding balance or after full collection raises `NO_BALANCE_DUE` or `AMOUNT_EXCEEDS_BALANCE`.
- **Audit Logging**: Emits immutable business audit event `booking.balance_collected` with actor type `'user'`.

### 4.5 `public.get_booking_payment_summary`
Returns an authoritative summary of paid and remaining balances.

```sql
public.get_booking_payment_summary(
  p_booking_id uuid
) RETURNS jsonb
```

---

## 5. Double-Entry Financial Ledger Invariants

### 5.1 Full Commission Recognition at Advance Capture
When the online advance $A$ is captured, Box Codex recognizes the full-booking platform commission $C$ from `commission_snapshot->>'estimated_commission_minor'`:
- **Debit** `gateway_clearing`: $+A$
- **Credit** `platform_commission`: $-C$
- **Credit** `owner_payable`: $-(A - C)$
- **Net Journal Balance**: $A - C - (A - C) = 0$

### 5.2 Venue Cash Collection Posts NO Ledger Journal
Because the offline venue balance collection $B = T - A$ is collected directly in cash/card by the venue operator:
- No funds pass through Razorpay or the platform gateway.
- Total net receipts retained by owner:
  $$\text{Venue Cash } B + \text{Settled Payable } (A - C) = (T - A) + (A - C) = T - C$$
- Therefore, `owner_record_balance_collection` posts **NO ledger journal**, preserving double-entry zero-sum invariants without distorting gateway clearing accounts.
