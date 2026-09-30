# Player Portal Specification & Features (apps/player)

This document outlines the page-by-page features for the **Player Portal** (`apps/player`), mapping each UI requirement directly to the underlying Supabase database tables and RPC functions that power them.

## 1. Home / Discovery Page (`/`)

**Goal:** Allow players to find turfs based on location, sport, and availability.

### Features
*   **Search & Filter Bar:** Search turfs by city, specific sports (e.g., Cricket, Football), and date.
*   **Featured/Popular Turfs:** Display top-rated or highly booked arenas.
*   **Turf Cards:** Show turf thumbnail (first image), name, city, sports available, and starting price.

### Supabase / Database Links
*   **Tables:** `public.turfs` (name, city), `public.turf_photos` (images where `published = true`), `public.sports` & `public.resource_sports` (mapping sports to the turf's courts).
*   **Note:** Only turfs with `approval_status = 'approved'` should be shown to the public.

---

## 2. Turf Details Page (`/turfs/[id]`)

**Goal:** Provide comprehensive information about a specific arena and allow the user to pick a playing date.

### Features
*   **Image Gallery:** A carousel of all published photos for the venue.
*   **Information Panel:** Description, exact address, and operating hours.
*   **Amenities List:** Icons for available facilities (e.g., Washrooms, Parking, Floodlights).
*   **Cancellation Policy:** Display the rules for refunds if a booking is cancelled.
*   **Date Selector:** A calendar picker to view slots for a specific day.

### Supabase / Database Links
*   **Tables:** `public.turf_photos`, `public.turf_amenities` joined with `public.amenities`, `public.operating_hours`, `public.cancellation_policies`.

---

## 3. Slot Selection & Booking (`/turfs/[id]/book`)

**Goal:** The core booking engine where users pick exact times and initiate checkout.

### Features
*   **Court/Resource Tabs:** If a turf has multiple courts (e.g., Court 1, Court 2), let the user toggle between them.
*   **Slot Grid:** Display available, booked, and blocked time slots for the selected date.
*   **Dynamic Pricing:** Show the exact price for selected slots (handling peak/off-peak rates).
*   **Checkout & Hold:** Temporarily lock the slot for the user (e.g., for 10 minutes) while they complete payment so no one else can book it simultaneously.
*   **Payment Gateway Integration:** Redirect to payment provider (Razorpay, Stripe, etc.).

### Supabase / Database Links
*   **Tables:** `public.resources`, `public.pricing_rules`.
*   **RPC Functions:**
    *   `get_public_slot_allocations`: Returns available vs. unavailable slots for the UI.
    *   `quote_booking`: Calculates the exact, mathematically proven price for the selected slots.
    *   `create_booking_hold`: Creates a temporary hold in `public.inventory_allocations` to prevent double-booking.
    *   `create_or_get_payment_order`: Generates the transaction payload for the payment provider.

---

## 4. My Bookings / Player Dashboard (`/bookings`)

**Goal:** Let users manage their upcoming games and view past history.

### Features
*   **Upcoming Games:** List future bookings with date, time, turf name, and booking reference code.
*   **Past History:** A log of completed games.
*   **Cancellation Flow:** A button to cancel an upcoming booking, showing the calculated refund amount based on the cancellation policy.
*   **Booking Receipt:** View the breakdown of charges (subtotal, platform fee, etc.).

### Supabase / Database Links
*   **Tables:** `public.bookings` (status: `confirmed`, `cancelled`), `public.booking_slots`, `public.booking_events` (for tracking the timeline of the booking).
*   **RPC Functions:** 
    *   `cancel_booking`: Securely processes a cancellation, calculates refunds, and releases the inventory slot back to the public.

---

## 5. Authentication & Profile (`/login`, `/profile`)

**Goal:** User onboarding and account management.

### Features
*   **OTP / Social Login:** Secure login without complex passwords (usually phone OTP or Google).
*   **Profile Editor:** Update display name and preferred timezone.
*   **Notification Center:** An inbox for booking confirmations, cancellation alerts, or promotional messages.

### Supabase / Database Links
*   **Supabase Auth:** Uses built-in `auth.users` for secure session management.
*   **Tables:** `public.profiles` (display name, avatar), `public.players` (timezone preference), `public.notifications`.
*   **RPC Functions:**
    *   `get_my_notifications`: Fetches user's alerts.
    *   `mark_notification_read`: Dismisses an alert.

---

## 6. Real-Time Updates (Bonus Feature)

**Goal:** Make the app feel alive and prevent race conditions.

### Features
*   **Live Slot Status:** If User A is looking at the 6:00 PM slot and User B books it, the slot should instantly turn grey/unavailable on User A's screen without refreshing the page.

### Supabase / Database Links
*   **Supabase Realtime:** Listen to `INSERT` and `UPDATE` events on the `public.inventory_allocations` table via a WebSocket connection.
*   **RPC Functions:** `authorize_realtime_channel` ensures users can securely connect to the websocket.
