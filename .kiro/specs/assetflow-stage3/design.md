# Design Document: AssetFlow Stage 3 — Resource Booking & Maintenance Workflows

## Overview

Stage 3 adds two operational workflows on top of the existing Stages 1 & 2 infrastructure:

- **Screen 6 — Resource Booking**: lets any authenticated employee reserve a bookable asset for a specific time window. Overlap prevention is enforced in PostgreSQL via a `BEFORE` trigger, making race-condition double-bookings impossible at the database level.
- **Screen 7 — Maintenance Kanban**: a click-to-move CSS Grid board (no drag-and-drop) where any employee can raise a repair ticket and Admin/Asset Manager roles drive it through Pending → Approved → In Progress → Resolved. A PostgreSQL `AFTER` trigger keeps the parent asset's status in sync automatically.

Both features are purely additive. They live in a new migration file (`supabase/migration_stage3_booking_maintenance.sql`) and never modify `schema.sql` or the Stage 2 migration. All TypeScript is strict-mode with zero `any` types, following the identical service-layer and type-definition patterns already established in Stage 2.

---

## Architecture

### System Layers

```
┌───────────────────────────────────────────────────────────┐
│                    React Frontend (Vite)                   │
│                                                            │
│  Pages            Components           Services            │
│  ─────────────    ──────────────────   ──────────────────  │
│  ResourceBooking  BookingForm          bookingService.ts   │
│  (Screen 6)       BookableAssetSelect  maintenanceService  │
│                   ScheduleView         .ts                 │
│  MaintenanceBoard KanbanColumn                             │
│  (Screen 7)       MaintenanceCard                          │
│                   RaiseRequestModal                        │
└───────────────────────────────┬───────────────────────────┘
                                │ @supabase/supabase-js
                                ▼
┌───────────────────────────────────────────────────────────┐
│                   Supabase (PostgreSQL)                    │
│                                                            │
│  Tables                  Triggers                          │
│  ─────────────────────   ───────────────────────────────  │
│  bookings                prevent_booking_overlap()  BEFORE │
│  maintenance_requests    sync_maintenance_status()  AFTER  │
│                                                            │
│  Existing (unchanged)    Existing SECURITY DEFINER helpers │
│  assets                  is_admin()                        │
│  profiles                is_asset_manager()               │
│  allocations                                               │
│  transfer_requests       RLS on every new table            │
└───────────────────────────────────────────────────────────┘
```

### Integration with Stage 1 & 2

Stage 3 builds on top of the existing infrastructure without touching it:

| Stage 1 object | How Stage 3 uses it |
|---|---|
| `profiles` table | FK target for `bookings.booked_by` and `maintenance_requests.requested_by` |
| `is_admin()` helper | Reused in bookings RLS update policy |
| `auth.uid()` | `booked_by` and `requested_by` populated from session |

| Stage 2 object | How Stage 3 uses it |
|---|---|
| `assets` table | FK target for both new tables; `assets.status` mutated by `sync_maintenance_status()` trigger |
| `assets.is_bookable` column | Drives bookable-asset filter in `bookingService.listBookableAssets()` |
| `is_asset_manager()` helper | Reused in maintenance_requests RLS update policy and UI role checks |
| `asset_status` enum | Extended values `'Under Maintenance'` and `'Available'` used by the sync trigger |
| `AssetWithCategory`, `Asset` types | Extended/reused in `BookingWithAsset`, service layer |
| `authService.ts` pattern | `bookingService.ts` and `maintenanceService.ts` follow the same module/function structure |

---

## Components and Interfaces

### Service Layer

#### `src/services/bookingService.ts`

```
listBookableAssets()          → Promise<Asset[]>
getTodaysBookings(assetId)    → Promise<Booking[]>
createBooking(input)          → Promise<Booking>     throws BookingOverlapError
cancelBooking(bookingId)      → Promise<void>
```

- `listBookableAssets` filters `assets WHERE is_bookable = true`.
- `getTodaysBookings` filters where `date(start_time) = current_date` using a `.gte`/`.lt` bracket on the UTC day boundaries.
- `createBooking` catches Supabase errors whose message includes `'Booking time slot overlaps with an existing reservation'` and re-throws `BookingOverlapError`.
- `cancelBooking` sets `status = 'Cancelled'` via UPDATE.

#### `src/services/maintenanceService.ts`

```
listMaintenanceRequests()                              → Promise<MaintenanceRequestWithDetails[]>
createMaintenanceRequest(input)                        → Promise<MaintenanceRequest>
updateMaintenanceStatus(id, status, technicianName?)   → Promise<void>
```

- `listMaintenanceRequests` SELECTs `maintenance_requests WHERE status != 'Rejected'`, JOINs `assets` for `tag` and `profiles` for `requested_by_name`, ordered `created_at DESC`.
- `updateMaintenanceStatus` UPDATEs both `status` and optionally `technician_name`.

### UI Components

#### Screen 6 — Resource Booking (`src/pages/ResourceBooking.tsx`)

```
ResourceBooking (page)
  ├── BookableAssetSelect     — populated via listBookableAssets()
  ├── BookingForm             — title / date / start time / end time / submit
  │     └── inline error display (overlap or generic)
  └── ScheduleView            — today's bookings for selected asset
```

**Props and state flow:**
- Page holds `selectedAsset: Asset | null` and `todaysBookings: Booking[]`.
- `BookableAssetSelect` emits `onSelect(asset: Asset | null)`.
- When `selectedAsset` changes, page calls `getTodaysBookings(selectedAsset.id)` and updates `todaysBookings`.
- `BookingForm` receives `selectedAsset` and `onSuccess(newBooking: Booking)` callback; on success, page appends `newBooking` to `todaysBookings` without a full refetch.
- `ScheduleView` receives `bookings: Booking[]` and renders empty-state when array is empty.

#### Screen 7 — Maintenance Board (`src/pages/MaintenanceBoard.tsx`)

```
MaintenanceBoard (page)
  ├── FAB / "Raise Request" button     — visible to all authenticated users
  ├── RaiseRequestModal                — asset selector + issue + priority
  └── KanbanBoard (CSS Grid, 4 cols)
        ├── KanbanColumn "Pending"
        │     └── MaintenanceCard[]
        ├── KanbanColumn "Approved"
        │     └── MaintenanceCard[]
        ├── KanbanColumn "In Progress"
        │     └── MaintenanceCard[]
        └── KanbanColumn "Resolved"
              └── MaintenanceCard[]
```

**Props and state flow:**
- Page holds `requests: MaintenanceRequestWithDetails[]` loaded via `listMaintenanceRequests()`.
- Page derives four arrays by filtering `requests` on `status` — no separate fetch per column.
- `KanbanColumn` receives its filtered array and renders `MaintenanceCard` for each item.
- `MaintenanceCard` receives `request`, `currentUserRole`, and `onStatusChange(id, status, technicianName?)` callback. Card renders action buttons only when `isAssetManager(currentUserRole)`.
- On any status change, page re-fetches `listMaintenanceRequests()` to get the updated state.
- `RaiseRequestModal` receives `onSuccess(newRequest)` callback; on success, page prepends the new request to local state (it will be `Pending`, so it lands in the first column without refetch).

#### Shared Helper

```typescript
// src/utils/roleUtils.ts  (or added to existing utils)
export function isAssetManager(role: UserRole): boolean {
  return role === 'Admin' || role === 'Asset Manager'
}
```

---

## Data Models

### New Enum Types

```sql
CREATE TYPE booking_status AS ENUM (
  'Upcoming', 'Ongoing', 'Completed', 'Cancelled'
);

CREATE TYPE maintenance_priority AS ENUM (
  'Low', 'Medium', 'High'
);

CREATE TYPE maintenance_status AS ENUM (
  'Pending', 'Approved', 'In Progress', 'Resolved', 'Rejected'
);
```

### Table: `bookings`

```sql
CREATE TABLE bookings (
  id         UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id   UUID           NOT NULL REFERENCES assets(id)   ON DELETE CASCADE,
  booked_by  UUID           NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title      TEXT           NOT NULL,
  start_time TIMESTAMPTZ    NOT NULL,
  end_time   TIMESTAMPTZ    NOT NULL,
  status     booking_status NOT NULL DEFAULT 'Upcoming',
  CONSTRAINT bookings_time_order CHECK (start_time < end_time)
);
```

**Key design decisions:**
- `ON DELETE CASCADE` on both FKs — deleting an asset or profile cleans up its bookings automatically. Unlike `allocations` (which uses `RESTRICT` to preserve audit history), bookings have no audit requirement per the PRD.
- `start_time < end_time` CHECK is a last line of defence; the service layer also validates this before calling Supabase.
- No `created_at` column is required per the requirements, but can be added without breaking anything.

### Table: `maintenance_requests`

```sql
CREATE TABLE maintenance_requests (
  id                UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id          UUID                 NOT NULL REFERENCES assets(id)   ON DELETE CASCADE,
  requested_by      UUID                 NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  issue_description TEXT                 NOT NULL,
  priority          maintenance_priority NOT NULL DEFAULT 'Medium',
  status            maintenance_status   NOT NULL DEFAULT 'Pending',
  technician_name   TEXT,
  created_at        TIMESTAMPTZ          NOT NULL DEFAULT now()
);
```

**Key design decisions:**
- `technician_name` is a plain TEXT field (nullable) rather than a FK to `profiles`. This avoids requiring a separate "technicians" management UI for the hackathon timeline.
- `ON DELETE CASCADE` on both FKs matches the bookings pattern — maintenance tickets are operational records tied to the lifecycle of the asset and the requesting user.

### TypeScript Types (additions to `src/types/index.ts`)

```typescript
// ─── Stage 3 Enum Types ────────────────────────────────────────────────────

export type BookingStatus = 'Upcoming' | 'Ongoing' | 'Completed' | 'Cancelled'
export type MaintenancePriority = 'Low' | 'Medium' | 'High'
export type MaintenanceStatus = 'Pending' | 'Approved' | 'In Progress' | 'Resolved' | 'Rejected'

// ─── Stage 3 Domain Types ──────────────────────────────────────────────────

export interface Booking {
  id: string
  asset_id: string
  booked_by: string
  title: string
  start_time: string      // ISO 8601 timestamptz
  end_time: string        // ISO 8601 timestamptz
  status: BookingStatus
}

export interface BookingWithAsset extends Booking {
  asset_name: string
  asset_tag: string
}

export interface MaintenanceRequest {
  id: string
  asset_id: string
  requested_by: string
  issue_description: string
  priority: MaintenancePriority
  status: MaintenanceStatus
  technician_name: string | null
  created_at: string
}

export interface MaintenanceRequestWithDetails extends MaintenanceRequest {
  asset_tag: string
  requested_by_name: string | null
}

// ─── Stage 3 Service Input Types ──────────────────────────────────────────

export interface CreateBookingInput {
  asset_id: string
  title: string
  start_time: string
  end_time: string
}

export interface CreateMaintenanceRequestInput {
  asset_id: string
  issue_description: string
  priority: MaintenancePriority
}

// ─── Stage 3 Error Types ──────────────────────────────────────────────────

export class BookingOverlapError extends Error {
  constructor(message = 'This time slot is already booked.') {
    super(message)
    this.name = 'BookingOverlapError'
  }
}
```

### `database.types.ts` Regeneration

After applying the Stage 3 migration, `src/lib/database.types.ts` **must** be regenerated via:

```bash
npx supabase gen types typescript --project-id <project_id> --schema public \
  > src/lib/database.types.ts
```

This will automatically add:
- `bookings` and `maintenance_requests` `Row` / `Insert` / `Update` shapes to `Tables`
- `booking_status`, `maintenance_priority`, `maintenance_status` to `Enums`

**Do not hand-edit `database.types.ts`** — it is a generated file.

### Trigger Functions

#### `prevent_booking_overlap()` — BEFORE trigger on `bookings`

```sql
CREATE OR REPLACE FUNCTION prevent_booking_overlap()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE  asset_id   = NEW.asset_id
      AND  id        != NEW.id          -- exclude self on UPDATE
      AND  status    != 'Cancelled'
      AND  NEW.start_time < end_time
      AND  NEW.end_time   > start_time
  ) THEN
    RAISE EXCEPTION 'Booking time slot overlaps with an existing reservation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_booking_overlap_check
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION prevent_booking_overlap();
```

**Design notes:**
- `id != NEW.id` guard prevents a row from conflicting with itself on UPDATE (e.g., changing only the title).
- The half-open interval check `NEW.start_time < end_time AND NEW.end_time > start_time` means **adjacent bookings are permitted** — a booking ending at 10:00 does not block one starting at 10:00.
- `SECURITY DEFINER` with `SET search_path = public` follows the same safety convention as all existing Stage 1/2 trigger functions.
- Runs as `BEFORE`, so if it raises, the originating INSERT/UPDATE is aborted and the error propagates to the Supabase client as a PostgreSQL exception.

#### `sync_maintenance_status()` — AFTER trigger on `maintenance_requests`

```sql
CREATE OR REPLACE FUNCTION sync_maintenance_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'Approved' AND OLD.status != 'Approved' THEN
    UPDATE public.assets SET status = 'Under Maintenance' WHERE id = NEW.asset_id;
  ELSIF NEW.status = 'Resolved' AND OLD.status != 'Resolved' THEN
    UPDATE public.assets SET status = 'Available' WHERE id = NEW.asset_id;
  ELSIF NEW.status = 'Rejected' THEN
    -- Only reset if the asset is currently Under Maintenance to avoid
    -- accidentally changing status when rejecting a Pending ticket
    UPDATE public.assets
    SET status = 'Available'
    WHERE id = NEW.asset_id AND status = 'Under Maintenance';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_maintenance_status_change
  AFTER UPDATE ON maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION sync_maintenance_status();
```

**Design notes:**
- `OLD.status != 'Approved'` guard makes the Approved branch idempotent — re-approving an already-approved ticket does not fire a redundant UPDATE.
- The `Resolved` branch sets `assets.status = 'Available'` unconditionally (does **not** restore prior `'Allocated'` state — this is an acknowledged design simplification per the requirements).
- The `Rejected` branch only resets to `'Available'` when the asset is currently `'Under Maintenance'`, preventing an inadvertent status change when rejecting a `Pending` ticket whose asset is still `'Available'`.
- Runs as `AFTER`, consistent with Stage 2's `sync_asset_status()` trigger.

### State Transition Diagram — Maintenance Workflow

```
                        ┌─────────────────────────────────┐
                        │          Asset Status            │
                        │  (driven by maintenance trigger) │
                        └─────────────────────────────────┘

  Employee clicks                                      Asset Manager
  "Raise Request"                                      approves ticket
       │                                                     │
       ▼                                                     ▼
  ┌─────────┐   Approve   ┌──────────┐  Start Work  ┌─────────────┐  Resolve  ┌──────────┐
  │ Pending │ ──────────► │ Approved │ ────────────► │  In Progress│ ─────────►│ Resolved │
  └─────────┘             └──────────┘               └─────────────┘           └──────────┘
       │                       │                           │                        │
       │ Reject                │ (asset → Under            │ (no asset              │ (asset →
       │                       │  Maintenance)             │  status change)        │  Available)
       ▼                       ▼                           ▼                        ▼
  ┌──────────┐        assets.status =              assets.status              assets.status =
  │ Rejected │         'Under Maintenance'          unchanged                  'Available'
  └──────────┘
  (removed from
   Kanban board)

  ─── Ticket status transitions (DB column: maintenance_requests.status)
  ─── Asset status transitions (DB column: assets.status, via AFTER trigger)
```

**Kanban board column mapping:**

| DB status | Kanban column | Action buttons (Asset Manager only) |
|---|---|---|
| `Pending` | Pending | Approve, Reject |
| `Approved` | Approved | Start Work (+ optional technician_name input) |
| `In Progress` | In Progress | Resolve |
| `Resolved` | Resolved | _(none)_ |
| `Rejected` | _(filtered out — not shown)_ | _(none)_ |

### RLS Policies

#### `bookings` table

```sql
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read bookings
CREATE POLICY "bookings_select_authenticated"
  ON bookings FOR SELECT
  USING (auth.role() = 'authenticated');

-- Any authenticated user can book, provided the asset is bookable
CREATE POLICY "bookings_insert_bookable_asset"
  ON bookings FOR INSERT
  WITH CHECK (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.assets
      WHERE id = bookings.asset_id AND is_bookable = true
    )
  );

-- Booking owner or Admin can update (cancel) their booking
CREATE POLICY "bookings_update_owner_or_admin"
  ON bookings FOR UPDATE
  USING (booked_by = auth.uid() OR is_admin())
  WITH CHECK (booked_by = auth.uid() OR is_admin());

-- DELETE permanently denied
CREATE POLICY "bookings_delete_denied"
  ON bookings FOR DELETE
  USING (false);
```

#### `maintenance_requests` table

```sql
ALTER TABLE maintenance_requests ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read maintenance requests
CREATE POLICY "maintenance_requests_select_authenticated"
  ON maintenance_requests FOR SELECT
  USING (auth.role() = 'authenticated');

-- Any authenticated user can raise a request
CREATE POLICY "maintenance_requests_insert_authenticated"
  ON maintenance_requests FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Only Admin or Asset Manager can update status / technician_name
CREATE POLICY "maintenance_requests_update_asset_manager"
  ON maintenance_requests FOR UPDATE
  USING (is_asset_manager())
  WITH CHECK (is_asset_manager());

-- DELETE permanently denied
CREATE POLICY "maintenance_requests_delete_denied"
  ON maintenance_requests FOR DELETE
  USING (false);
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

**Property reflection summary:** The prework analysis identified 22 PROPERTY-class criteria. After reflection:
- 1.3, 1.4, 2.2, 2.3 (FK cascade deletions on both tables) are structurally identical and merged into Property 1.
- 3.2 + 3.3 (overlap logic + error message) are inseparable and form Property 2.
- 7.1 + 16.1 (bookable-asset filter in UI and service) are the same invariant at two layers; the combined Property 3 covers both.
- 10.4 + 10.5 (fetch filter + board display) — the board test implicitly covers the fetch; merged into Property 8.
- 12.1 + 12.9 (buttons shown for managers / hidden for others) are two sides of one invariant; merged into Property 9.
- 9.1 + 9.3 (schedule shows today's bookings + each item contains required fields) are complementary and merged into Property 10.
- 4.4 + 4.5 (non-triggering transitions) are merged into Property 7 with a precise specification of the Rejected edge case.

This yields 10 distinct, non-redundant properties.

---

### Property 1: FK cascade deletions remove all child records

*For any* asset or profile that is deleted, all `bookings` rows referencing that asset via `asset_id` or that profile via `booked_by`, and all `maintenance_requests` rows referencing that asset via `asset_id` or that profile via `requested_by`, shall be automatically deleted from the database.

**Validates: Requirements 1.3, 1.4, 2.2, 2.3**

---

### Property 2: Overlap prevention rejects conflicting non-cancelled bookings

*For any* two bookings on the same asset both having `status != 'Cancelled'`, if their time intervals overlap (i.e., `b1.start_time < b2.end_time AND b2.start_time < b1.end_time`), the database SHALL reject the second insert/update with the exception message `'Booking time slot overlaps with an existing reservation'`.

**Validates: Requirements 3.2, 3.3**

---

### Property 3: Bookable-asset filter is enforced at every layer

*For any* list of assets containing a mix of `is_bookable = true` and `is_bookable = false` entries, `bookingService.listBookableAssets()` shall return **only** the `is_bookable = true` assets, and the resource selector component on Screen 6 shall list **only** those same assets.

**Validates: Requirements 7.1, 16.1**

---

### Property 4: Adjacent bookings are permitted (half-open interval)

*For any* existing non-cancelled booking `b1`, a new booking `b2` on the same asset where `b2.start_time = b1.end_time` (touching but not overlapping) shall be accepted by the overlap guard without raising an exception.

**Validates: Requirements 3.4**

---

### Property 5: Cancelled bookings vacate the time slot

*For any* booking `b` with `status = 'Cancelled'`, a new booking `b2` on the same asset covering any overlapping time window shall be accepted by the overlap guard.

**Validates: Requirements 3.5**

---

### Property 6: Booking overlap error propagates as typed error

*For any* `CreateBookingInput` that would produce an overlap with an existing non-cancelled booking, `bookingService.createBooking()` shall throw an instance of `BookingOverlapError` (i.e., `err instanceof BookingOverlapError === true`) rather than a generic `Error` or an unhandled rejection.

**Validates: Requirements 8.5, 16.3**

---

### Property 7: Maintenance trigger updates asset status on Approved and Resolved only

*For any* `maintenance_requests` row:
- Transitioning `status` to `'Approved'` shall set the corresponding `assets.status` to `'Under Maintenance'`.
- Transitioning `status` to `'Resolved'` shall set the corresponding `assets.status` to `'Available'`.
- Transitioning `status` to `'Rejected'` while `assets.status = 'Under Maintenance'` shall set `assets.status` to `'Available'`.
- Transitioning `status` to `'Rejected'` while `assets.status != 'Under Maintenance'` shall leave `assets.status` unchanged.
- Transitioning `status` to any value other than `'Approved'`, `'Resolved'`, or `'Rejected'` shall leave `assets.status` unchanged.

**Validates: Requirements 4.2, 4.3, 4.4, 4.5**

---

### Property 8: Kanban board shows each non-rejected request in exactly one column

*For any* set of `MaintenanceRequestWithDetails` records including some with `status = 'Rejected'`, the rendered Kanban board shall contain zero cards corresponding to rejected requests, and each non-rejected request shall appear in **exactly one** column corresponding to its `status` value.

**Validates: Requirements 10.2, 10.4, 10.5**

---

### Property 9: Action button visibility is role-gated

*For any* `MaintenanceRequestWithDetails` and *any* `UserRole`, action buttons (Approve, Reject, Start Work, Resolve) shall be rendered on the card **if and only if** `role === 'Admin' || role === 'Asset Manager'`. For `'Employee'` and `'Department Head'` roles, no action buttons shall be present in the DOM.

**Validates: Requirements 12.1, 12.9**

---

### Property 10: Schedule view renders all of today's bookings with required fields

*For any* array of `Booking` records, the `ScheduleView` component shall render exactly one booking item per record, and each rendered item shall contain the booking's `title`, `start_time`, and `end_time`. When passed an empty array, the component shall render an empty-state message.

**Validates: Requirements 9.1, 9.3**

---

## Error Handling

### Booking Service

| Scenario | DB signal | Service response | UI response |
|---|---|---|---|
| Overlap detected | PostgreSQL EXCEPTION from trigger | `BookingOverlapError` | Inline: "This time slot is already booked." |
| `start_time >= end_time` | CHECK constraint violation (code `23514`) | `Error` re-thrown | Inline generic error |
| Asset is not bookable | RLS INSERT denial | Supabase `PostgrestError` | Inline generic error |
| Network/timeout | Supabase client error | `Error` re-thrown | Inline generic error, form stays populated |

Detecting the overlap error uses message substring matching (`error.message.includes('Booking time slot overlaps with an existing reservation')`) — the same pattern used in Stage 2 for `AllocationConflictError`.

### Maintenance Service

| Scenario | Service response | UI response |
|---|---|---|
| Insert fails | `Error` re-thrown | Inline error in modal, modal stays open |
| `updateMaintenanceStatus` fails | `Error` re-thrown | Toast or inline error; board state unchanged |
| `listMaintenanceRequests` fails | `Error` re-thrown | Page shows error state |

### General Error Boundary

Both new pages should be wrapped in React error boundaries (or the existing pattern from Stage 2 pages) to catch unexpected rendering errors and prevent the whole app from crashing.

---

## Testing Strategy

### Dual-Layer Approach

Unit tests cover specific scenarios, edge cases, and integration points. Property-based tests (fast-check) verify universal properties across hundreds of generated inputs. The two are complementary — unit tests catch concrete named bugs; property tests verify general invariants.

### Property-Based Testing

Library: **fast-check** (already installed as a devDependency from Stage 2 tasks).
Configuration: minimum **100 iterations** per property test.
Tag format: `// Feature: assetflow-stage3, Property N: <property_text>`

Each correctness property above maps to exactly one property-based test.

**Properties and their test strategies:**

| Property | What varies | What's verified |
|---|---|---|
| P1: FK cascade deletions | Arbitrary asset/profile with N child records | All child rows absent after parent deleted |
| P2: No active overlap | Arbitrary pairs of non-cancelled bookings with overlapping intervals | Second insert rejected with specific error message |
| P3: Bookable-asset filter | Asset lists with mixed `is_bookable` values | Service and selector component return only `is_bookable = true` |
| P4: Adjacent bookings permitted | Arbitrary existing booking; new booking `start == existing.end` | Overlap guard accepts the adjacent booking |
| P5: Cancelled slot vacated | Arbitrary booking cancelled; new booking on same window | New booking accepted |
| P6: Overlap error propagates as typed error | Arbitrary overlapping `CreateBookingInput` | `bookingService.createBooking()` throws `BookingOverlapError` (not generic Error) |
| P7: Maintenance trigger all cases | Any `maintenance_requests` row transitioned to each status value | Asset status matches expected outcome for each transition |
| P8: Kanban shows each non-rejected in exactly one column | Arbitrary mix of `MaintenanceRequestWithDetails` incl. Rejected | 0 Rejected cards; each non-Rejected appears exactly once in its column |
| P9: Action button role gate | Any `UserRole` × any card status combination | Buttons present iff `role ∈ {Admin, Asset Manager}` |
| P10: Schedule view renders all items with required fields | Arbitrary `Booking[]` arrays (including empty) | Count matches, each item has title/start/end, empty array shows empty state |

### Unit Tests

**`bookingService.ts`:**
- `listBookableAssets` returns only assets with `is_bookable = true`
- `createBooking` happy path returns `Booking`
- `createBooking` throws `BookingOverlapError` when error message matches overlap text
- `cancelBooking` calls UPDATE with `status = 'Cancelled'`
- `getTodaysBookings` passes correct date range filter

**`maintenanceService.ts`:**
- `listMaintenanceRequests` excludes Rejected rows
- `createMaintenanceRequest` inserts with `status = 'Pending'` and `requested_by = auth.uid()`
- `updateMaintenanceStatus` updates both `status` and `technician_name` when provided

**`ResourceBooking.tsx`:**
- Form fields disabled when no asset selected
- Schedule_View shows "No bookings today" on empty array
- Overlap error renders inline message
- On booking success, new booking appears in Schedule_View without page reload

**`MaintenanceBoard.tsx`:**
- Cards distributed to correct columns by status
- No Rejected cards rendered
- Action buttons absent for Employee/Department Head roles
- On "Raise Request" success, new card appears in Pending column
- On status update, card moves to correct column

### Integration Tests (manual, against Supabase)

Per the Stage 2 convention, DB-backed tests that invoke real trigger functions require a live Supabase test project or local `supabase start`. These are marked optional (`*`) in the tasks file for MVP:

- `prevent_booking_overlap()` rejects overlap, permits adjacent, permits after cancel
- `sync_maintenance_status()` sets `'Under Maintenance'` on Approve, `'Available'` on Resolve
- RLS: employee cannot UPDATE bookings they don't own; non-Asset-Manager cannot UPDATE maintenance status
