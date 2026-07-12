# Design Document: AssetFlow Stage 4 — Dashboards & Telemetry

## Overview

Stage 4 adds a telemetry backbone and three new/rebuilt screens on top of the existing Stages 1–3 infrastructure:

- **Screen 2 — Dashboard (rebuilt)**: KPI cards showing live fleet metrics, an overdue-return alert banner, and a live activity feed drawn from the new `activity_logs` table.
- **Screen 9 — Reports & Analytics (new)**: Visual charts (Recharts, static data), actionable idle/maintenance-due asset lists, and one-click CSV export.
- **Screen 10 — Activity Logs (new)**: A fully paginated, filterable audit trail of every system event.

The backbone is the `activity_logs` table — an append-only ledger written exclusively by three PostgreSQL `AFTER` triggers. RLS on the table enforces four-tier role-scoped visibility without any application-layer filtering. All client-side reads go through two new service modules: `activityService.ts` and `dashboardService.ts`.

All new code is TypeScript strict-mode with zero `any` types. Every new service module follows the same pattern as `allocationService.ts` and `assetService.ts`. All database objects land in a new migration file (`supabase/migration_stage4_dashboards_telemetry.sql`) and are also appended to `supabase/schema.sql`.

---

## Architecture

### System Layers

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          React Frontend (Vite)                               │
│                                                                               │
│  Pages (Stage 4)            Components (Stage 4)     Services (Stage 4)      │
│  ──────────────────────     ──────────────────────   ──────────────────────  │
│  Dashboard.tsx (rebuilt)    KPICard                  dashboardService.ts      │
│  Reports.tsx (new)          OverdueAlertBanner        activityService.ts      │
│  ActivityLogs.tsx (new)     RecentActivityFeed                                │
│                             ChartsSection (Recharts)                          │
│                             IdleAssetsList                                    │
│                             MaintenanceDueList                                │
│                             ExportCSVButton                                   │
│                             EventTypeFilterBar                                │
│                             ActivityLogFeed                                   │
│                             PaginationControls                                │
│                                                                               │
│  Existing pages (unchanged): AssetDirectory, AllocationTransfer,             │
│    ResourceBooking, MaintenanceBoard, OrganizationSetup, LoginSignup         │
└───────────────────────────────────────┬─────────────────────────────────────┘
                                        │ @supabase/supabase-js
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Supabase (PostgreSQL)                                 │
│                                                                               │
│  Stage 4 (new)                 Stage 4 Triggers                               │
│  ─────────────────────────     ────────────────────────────────────────────  │
│  activity_log_event_type enum  log_new_allocation()     AFTER INSERT allocations │
│  activity_logs table           log_maintenance_update() AFTER UPDATE maintenance_requests │
│                                log_booking_created()    AFTER INSERT bookings │
│                                                                               │
│  Stage 1–3 (unchanged)         Stage 1–3 Triggers (unchanged)                │
│  profiles, departments         handle_new_user()                              │
│  asset_categories              prevent_booking_overlap()                      │
│  assets, allocations           sync_maintenance_status()                      │
│  transfer_requests             sync_asset_status()                            │
│  bookings                      is_admin(), is_asset_manager() helpers         │
│  maintenance_requests                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Integration with Stages 1–3

Stage 4 is purely additive — no existing migration files, tables, or functions are modified.

| Existing object | How Stage 4 uses it |
|---|---|
| `allocations` table | Source of `AFTER INSERT` trigger for `log_new_allocation()` |
| `maintenance_requests` table | Source of `AFTER UPDATE` trigger for `log_maintenance_update()` |
| `bookings` table | Source of `AFTER INSERT` trigger for `log_booking_created()` |
| `profiles` table | FK target for `activity_logs.actor_id` (ON DELETE SET NULL); joined in trigger bodies for `full_name` lookup |
| `assets` table | Joined in `log_new_allocation()` for `tag` lookup; queried in `dashboardService.ts` and `Reports.tsx` |
| `is_admin()` helper | Not directly reused in Stage 4 RLS — Admin is identified via a profile role check in the new tiered policy |
| `is_asset_manager()` helper | Same — Admin/Asset Manager tier uses an inline role check in the new RLS select policy |
| `asset_status` enum | Used in `dashboardService.getDashboardKPIs()` to filter `'Available'` and `'Allocated'` counts |
| `booking_status` enum | Used in the active-bookings-today KPI query (`'Upcoming'` or `'Ongoing'`) |
| `maintenance_status` enum | Used in the pending-maintenance KPI query (`'Pending'`) |

---

## Components and Interfaces

### Service Layer

#### `src/services/activityService.ts` (new)

```typescript
getRecentActivity(limit: number): Promise<ActivityLog[]>
getActivityLogs(options: GetActivityLogsOptions): Promise<{ data: ActivityLog[]; count: number }>
```

- `getRecentActivity` SELECTs from `activity_logs` ordered by `created_at DESC` with `.limit(limit)`. Throws `new Error(error.message)` on Supabase error.
- `getActivityLogs` SELECTs with `{ count: 'exact' }`, ordered `created_at DESC`. Computes `from = (options.page ?? 1 - 1) * (options.pageSize ?? 20)`, `to = from + (options.pageSize ?? 20) - 1`, calls `.range(from, to)`. When `options.eventType` is provided, appends `.eq('event_type', options.eventType)`. When Supabase returns `null` for count, uses `0`. Throws on error.

#### `src/services/dashboardService.ts` (new)

```typescript
getDashboardKPIs(): Promise<DashboardKPIs>
getOverdueCount(): Promise<number>
```

- `getDashboardKPIs` runs four count queries concurrently via `Promise.all`. Each query uses `{ count: 'exact', head: true }` and returns `data.count ?? 0`. Individual query errors surface as rejected promises, which the caller (Dashboard page) handles per-card via `Promise.allSettled` or individual try/catch wrappers.
- `getOverdueCount` queries `allocations WHERE returned_at IS NULL AND expected_return_date < CURRENT_DATE` with `{ count: 'exact', head: true }`. Returns `0` on any error (silent suppression as required by Req 10.4).

**Design decision — `getDashboardKPIs` vs `Promise.allSettled`:** The service returns a `Promise<DashboardKPIs>` where each field is the resolved count. The Dashboard page calls the four count queries independently (or via `Promise.allSettled`) so that a single failure can set that field to `null`/`"--"` while the others render normally. The service module keeps the query logic; the failure-isolation logic lives in the component.

#### Existing services (unchanged)

`assetService.ts`, `allocationService.ts`, `authService.ts`, `bookingService.ts`, `maintenanceService.ts` — no modifications.

---

### Page Components

#### `src/pages/Dashboard.tsx` (rebuilt)

```
Dashboard (page)
  ├── KPICards section
  │     ├── KPICard "Total Assets Available"   ← dashboardService query 1
  │     ├── KPICard "Total Assets Allocated"   ← dashboardService query 2
  │     ├── KPICard "Active Bookings Today"    ← dashboardService query 3
  │     └── KPICard "Pending Maintenance"      ← dashboardService query 4
  ├── OverdueAlertBanner                       ← dashboardService.getOverdueCount()
  └── RecentActivityFeed                       ← activityService.getRecentActivity(5)
```

**State and data flow:**
- On mount, the page fires all six data-fetching calls concurrently: four KPI queries (via `getDashboardKPIs`), `getOverdueCount()`, and `getRecentActivity(5)`.
- Each section maintains its own `loading` and `error` state — a failure in `getRecentActivity` does not affect KPI card rendering (Req 11.4).
- `KPICard` receives `value: number | null | '—'`, `label: string`, and `loading: boolean`. When `loading` is true it renders a skeleton placeholder. When `value` is `null`/error, it renders `"--"`.
- `OverdueAlertBanner` receives `count: number`. Renders the banner only when `count > 0`. If the overdue query failed, `count` is `0` (the service returns 0 on error) so the banner is silently absent.
- `RecentActivityFeed` receives `logs: ActivityLog[]`, `loading: boolean`, `error: boolean`. Shows a spinner while loading, "No recent activity" on empty, "Could not load activity" on error.

#### `src/pages/Reports.tsx` (new)

```
Reports (page)
  ├── ChartsSection
  │     ├── UtilizationBarChart     ← Recharts BarChart, static data, lazy import
  │     └── MaintenanceLineChart    ← Recharts LineChart, static data, lazy import
  ├── IdleAssetsList                ← assetService query (status='Available', limit 5)
  ├── MaintenanceDueList            ← assetService query (condition='Needs Repair' OR age>3yr, limit 10)
  └── ExportCSVButton               ← full assets query on click, browser Blob download
```

**State and data flow:**
- `IdleAssetsList` and `MaintenanceDueList` each load independently on mount with their own `loading`/`error` states.
- `ChartsSection` uses `React.lazy` + `React.Suspense` wrapped in an `ErrorBoundary` component. If Recharts cannot be imported, the ErrorBoundary catches and renders a `<div>` with "Chart unavailable" (Req 12.5). Static data arrays are module-level constants — no Supabase calls.
- `ExportCSVButton` maintains `loading: boolean` and `error: string | null`. On click: query all assets (no limit), build CSV string, create `Blob`, create `<a>` element, set `href` to `URL.createObjectURL(blob)` and `download` to `assetflow-inventory-YYYY-MM-DD.csv`, append to DOM, `.click()`, then revoke URL. Button is disabled while loading.

**CSV column order (always fixed):** `tag,name,status,condition,location,created_at`

#### `src/pages/ActivityLogs.tsx` (new)

```
ActivityLogs (page)
  ├── EventTypeFilterBar (7 pills: All + 6 event types)
  ├── ActivityLogFeed (list of ActivityLog entries)
  └── PaginationControls (Previous / Next buttons)
```

**State and data flow:**
- Page holds `activeFilter: ActivityLogEventType | null` (null = "All"), `page: number` (starts at 1), `pageSize: number` (fixed 20), `data: ActivityLog[]`, `count: number`, `loading: boolean`, `error: string | null`.
- On any filter change, page is reset to 1 before the new query fires.
- `EventTypeFilterBar` receives `activeFilter` and `onFilterChange(type: ActivityLogEventType | null)`. The "All" pill emits `null`.
- `PaginationControls` receives `page`, `count`, `pageSize`. "Previous" disabled when `page === 1`. "Next" disabled when `page * pageSize >= count` or `count <= pageSize`.
- On error, the feed area shows the error message; pagination controls remain in their pre-error state.

---

## Data Models

### New Enum Type: `activity_log_event_type`

```sql
-- Idempotent creation using DO $$ block (same pattern as Stage 3 enums)
DO $$ BEGIN
  CREATE TYPE activity_log_event_type AS ENUM (
    'Asset Registered',
    'Allocation',
    'Transfer',
    'Booking',
    'Maintenance',
    'Audit'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

### Table: `activity_logs`

```sql
CREATE TABLE IF NOT EXISTS activity_logs (
  id           UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   activity_log_event_type NOT NULL,
  message      TEXT                    NOT NULL
               CHECK (char_length(message) BETWEEN 1 AND 1000),
  actor_id     UUID                    REFERENCES profiles(id) ON DELETE SET NULL,
  reference_id UUID,
  created_at   TIMESTAMPTZ             NOT NULL DEFAULT now()
);
```

**Key design decisions:**
- `actor_id` is nullable with `ON DELETE SET NULL` — deleting a profile preserves the log row with `actor_id = NULL`. This differs from the `ON DELETE CASCADE` / `ON DELETE RESTRICT` patterns on other tables because the audit ledger must survive the lifecycle of its actors (Req 1.3).
- `reference_id` is nullable with no FK constraint — it stores the UUID of the originating row (`allocations.id`, `maintenance_requests.id`, or `bookings.id`) but is intentionally unconstrained, as referenced rows may be deleted while the log entry must remain (Req 1.1).
- No `UPDATE` or `DELETE` path exists in the application — the append-only guarantee is enforced by RLS (`USING (false)` on both operations).
- The table has no explicit FK on `event_type` beyond the enum constraint — any value outside the 6-item enum is rejected by PostgreSQL at insert time.

### TypeScript Types (additions to `src/types/index.ts`)

```typescript
// ─── Stage 4 Enum Types ────────────────────────────────────────────────────

export type ActivityLogEventType =
  | 'Asset Registered'
  | 'Allocation'
  | 'Transfer'
  | 'Booking'
  | 'Maintenance'
  | 'Audit'

// ─── Stage 4 Domain Types ──────────────────────────────────────────────────

export interface ActivityLog {
  id: string
  event_type: ActivityLogEventType
  message: string
  actor_id: string | null
  reference_id: string | null
  created_at: string      // ISO 8601 timestamptz
}

export interface DashboardKPIs {
  totalAvailableAssets: number
  totalAllocatedAssets: number
  activeBookingsToday: number
  pendingMaintenance: number
}

// ─── Stage 4 Service Input Types ──────────────────────────────────────────

export interface GetActivityLogsOptions {
  eventType?: ActivityLogEventType
  page?: number       // integer >= 1, defaults to 1
  pageSize?: number   // integer 1–100 inclusive, defaults to 20
}
```

### Trigger Functions

#### `log_new_allocation()` — AFTER INSERT on `allocations`

```sql
CREATE OR REPLACE FUNCTION log_new_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset_tag       TEXT;
  v_assigned_by_name TEXT;
  v_assigned_to_name TEXT;
  v_message         TEXT;
BEGIN
  BEGIN
    -- Look up asset tag; fall back to 'Unknown' if row not found
    SELECT tag INTO v_asset_tag
      FROM public.assets WHERE id = NEW.asset_id;
    v_asset_tag := COALESCE(v_asset_tag, 'Unknown');

    -- Look up assigner full_name; fall back to 'Unknown'
    SELECT full_name INTO v_assigned_by_name
      FROM public.profiles WHERE id = NEW.assigned_by;
    v_assigned_by_name := COALESCE(v_assigned_by_name, 'Unknown');

    -- Look up assignee full_name; fall back to 'Unknown'
    SELECT full_name INTO v_assigned_to_name
      FROM public.profiles WHERE id = NEW.assigned_to;
    v_assigned_to_name := COALESCE(v_assigned_to_name, 'Unknown');

    v_message := 'Asset ' || v_asset_tag
              || ' allocated by ' || v_assigned_by_name
              || ' to ' || v_assigned_to_name;

    INSERT INTO public.activity_logs (event_type, message, actor_id, reference_id)
    VALUES ('Allocation', v_message, NEW.assigned_by, NEW.id);

  EXCEPTION WHEN OTHERS THEN
    NULL;  -- swallow all exceptions; core allocation INSERT must never be blocked
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_allocation_logged ON allocations;
CREATE TRIGGER on_allocation_logged
  AFTER INSERT ON allocations
  FOR EACH ROW EXECUTE FUNCTION log_new_allocation();
```

#### `log_maintenance_update()` — AFTER UPDATE on `maintenance_requests`

```sql
CREATE OR REPLACE FUNCTION log_maintenance_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset_tag TEXT;
  v_message   TEXT;
BEGIN
  -- Only log Approved (not already Approved) or Resolved (not already Resolved)
  IF (NEW.status = 'Approved'  AND OLD.status != 'Approved')
  OR (NEW.status = 'Resolved'  AND OLD.status != 'Resolved')
  THEN
    BEGIN
      SELECT tag INTO v_asset_tag
        FROM public.assets WHERE id = NEW.asset_id;
      v_asset_tag := COALESCE(v_asset_tag, 'Unknown');

      v_message := 'Maintenance request for ' || v_asset_tag || ' ' || NEW.status;

      INSERT INTO public.activity_logs (event_type, message, actor_id, reference_id)
      VALUES ('Maintenance', v_message, NEW.requested_by, NEW.id);

    EXCEPTION WHEN OTHERS THEN
      NULL;  -- swallow; core maintenance UPDATE must never be blocked
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_maintenance_logged ON maintenance_requests;
CREATE TRIGGER on_maintenance_logged
  AFTER UPDATE ON maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION log_maintenance_update();
```

**Design notes:**
- The `OLD.status != 'Approved'` guard prevents a duplicate log entry if the same row is updated to `'Approved'` a second time (idempotent update protection).
- Transitions to `'Pending'`, `'In Progress'`, `'Rejected'` produce no log entry (Req 3.4).
- The inner `BEGIN … EXCEPTION WHEN OTHERS THEN NULL` block is nested within the outer `IF` check so the guard itself is never silenced — only the log insert is protected.

#### `log_booking_created()` — AFTER INSERT on `bookings`

```sql
CREATE OR REPLACE FUNCTION log_booking_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message TEXT;
BEGIN
  BEGIN
    v_message := 'Resource ' || NEW.title
              || ' booked for ' || NEW.start_time::DATE;

    INSERT INTO public.activity_logs (event_type, message, actor_id, reference_id)
    VALUES ('Booking', v_message, NEW.booked_by, NEW.id);

  EXCEPTION WHEN OTHERS THEN
    NULL;  -- swallow; core bookings INSERT must never be blocked
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_booking_logged ON bookings;
CREATE TRIGGER on_booking_logged
  AFTER INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION log_booking_created();
```

### RLS Policies: `activity_logs`

```sql
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- Drop before recreate (idempotency)
DROP POLICY IF EXISTS "activity_logs_select_admin_asset_manager" ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_select_dept_head"           ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_select_employee"            ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_insert_denied"              ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_update_denied"              ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_delete_denied"              ON activity_logs;

-- Tier 1: Admin / Asset Manager — see all rows
CREATE POLICY "activity_logs_select_admin_asset_manager"
  ON activity_logs FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('Admin', 'Asset Manager')
    )
  );

-- Tier 2: Department Head — see rows where actor belongs to their department
CREATE POLICY "activity_logs_select_dept_head"
  ON activity_logs FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND activity_logs.actor_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles  AS actor
      JOIN public.departments AS dept ON dept.id = actor.department_id
      WHERE actor.id    = activity_logs.actor_id
        AND dept.head_id = auth.uid()
    )
  );

-- Tier 3: Employee — see only their own rows
CREATE POLICY "activity_logs_select_employee"
  ON activity_logs FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND activity_logs.actor_id = auth.uid()
  );

-- INSERT denied — SECURITY DEFINER triggers are the sole insert path
CREATE POLICY "activity_logs_insert_denied"
  ON activity_logs FOR INSERT
  WITH CHECK (false);

-- UPDATE denied — append-only ledger
CREATE POLICY "activity_logs_update_denied"
  ON activity_logs FOR UPDATE
  USING (false);

-- DELETE denied — append-only ledger
CREATE POLICY "activity_logs_delete_denied"
  ON activity_logs FOR DELETE
  USING (false);
```

**Tier precedence note:** PostgreSQL evaluates all `SELECT` policies with `OR` semantics — a row is visible if _any_ matching policy's `USING` clause returns true. An Admin who also happens to be the `actor_id` on a row satisfies the Tier 1 policy, which is the intended behaviour. There is no overlap conflict between tiers.

### Migration File and Schema File

**`supabase/migration_stage4_dashboards_telemetry.sql`** contains all Stage 4 SQL objects in the order: prerequisite guard → enum → table → trigger functions → trigger attachments → RLS enable → RLS policies. The file uses the same idempotency conventions as Stage 3: `IF NOT EXISTS` for the table, `DO $$ EXCEPTION WHEN duplicate_object THEN NULL $$` for the enum, `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`, `DROP POLICY IF EXISTS` before `CREATE POLICY`, and `CREATE OR REPLACE FUNCTION`.

**`supabase/schema.sql`** receives an appended section demarcated by:
```sql
-- =============================================================================
-- AssetFlow Stage 4 — Dashboards & Telemetry
-- =============================================================================
```
This section contains the same objects (without the idempotency guards needed only for migration re-runs), making `schema.sql` usable for fresh-database provisioning.

### Routing

Two new routes added to `src/App.tsx`:

```tsx
{/* Screen 9: Reports & Analytics — all authenticated roles — Requirements: 18.1 */}
<Route path="/reports" element={<Reports />} />

{/* Screen 10: Activity Logs — all authenticated roles — Requirements: 18.2 */}
<Route path="/activity-logs" element={<ActivityLogs />} />
```

Both routes sit inside the existing authentication guard (the same pattern used for `/dashboard`, `/assets`, `/allocations`). Navigation links to `/reports` and `/activity-logs` are added to the Dashboard sidebar/nav (Req 18.3).

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

**Property reflection summary:** The prework analysis identified 10 PROPERTY-class criteria from 18 requirements. After reflection:
- Requirements 2.4 and 4.3 both describe the same trigger isolation guarantee (core INSERT succeeds even when log INSERT fails); they are expressed as two distinct properties because the triggers operate on different tables with slightly different setup, but the test pattern is identical. Kept as P1 and P2 because each exercises a different trigger function.
- Requirements 3.2 + 3.3 + 3.4 describe complementary facets of the same maintenance trigger filter rule — the trigger fires for Approved/Resolved with the OLD.status guard, and does not fire for other statuses. These are merged into P3 (one comprehensive property).
- Requirements 5.2 + 5.3 + 5.4 describe the three non-admin RLS visibility tiers. Each tier is a distinct invariant over a different population of rows; they are merged into P5 (one property covering all four tiers together).
- Requirements 8.2 + 8.4 both describe the pagination range formula — merged into P7.
- Requirements 9.2 + 9.8 describe KPI Promise.all failure isolation — merged into P6.

This yields 10 distinct, non-redundant properties.

---

### Property 1: Allocation trigger isolation — core INSERT always succeeds

*For any* allocation INSERT on the `allocations` table, even when the `log_new_allocation()` trigger's attempt to insert into `activity_logs` fails (raises any exception), the originating `allocations` INSERT SHALL commit successfully and the new allocation row SHALL be present in the database.

**Validates: Requirements 2.4**

---

### Property 2: Booking trigger isolation — core INSERT always succeeds

*For any* booking INSERT on the `bookings` table, even when the `log_booking_created()` trigger's attempt to insert into `activity_logs` fails (raises any exception), the originating `bookings` INSERT SHALL commit successfully and the new booking row SHALL be present in the database.

**Validates: Requirements 4.3**

---

### Property 3: Maintenance trigger filter — correct status guard and idempotency

*For any* `maintenance_requests` UPDATE:
- When transitioning `status` to `'Approved'` from any status other than `'Approved'`, exactly one `'Maintenance'` row SHALL be inserted into `activity_logs`.
- When transitioning `status` to `'Resolved'` from any status other than `'Resolved'`, exactly one `'Maintenance'` row SHALL be inserted into `activity_logs`.
- When transitioning `status` to `'Approved'` from `'Approved'` (idempotent re-approval), zero rows SHALL be inserted.
- When transitioning `status` to any value other than `'Approved'` or `'Resolved'` (e.g., `'Pending'`, `'In Progress'`, `'Rejected'`), zero rows SHALL be inserted into `activity_logs`.

**Validates: Requirements 3.2, 3.3, 3.4**

---

### Property 4: `actor_id` ON DELETE SET NULL — log rows preserved

*For any* `activity_logs` row with a non-null `actor_id` pointing to a valid `profiles` row, deleting that profile SHALL set `actor_id` to `NULL` on all referencing `activity_logs` rows; those rows SHALL still exist in the table (they SHALL NOT be deleted).

**Validates: Requirements 1.3**

---

### Property 5: RLS tier correctness — role-scoped row visibility

*For any* set of `activity_logs` rows with varied `actor_id` values (some matching a given user, some matching other users in different departments, some NULL):
- A user with `role = 'Admin'` or `role = 'Asset Manager'` SHALL be able to SELECT all rows, regardless of `actor_id`.
- A user with `role = 'Department Head'` SHALL be able to SELECT only rows where `actor_id` is a non-NULL UUID belonging to a profile in the department they lead; rows with `actor_id = NULL` or `actor_id` belonging to another department SHALL NOT be visible.
- A user with `role = 'Employee'` SHALL be able to SELECT only rows where `actor_id = auth.uid()`; rows with a different `actor_id` or `actor_id = NULL` SHALL NOT be visible.

**Validates: Requirements 5.2, 5.3, 5.4**

---

### Property 6: KPI isolation — Promise.all partial failure

*For any* combination of the four KPI queries where exactly one query rejects with an error, `getDashboardKPIs` (as used by the Dashboard page) SHALL still resolve the other three counts with their correct numeric values; the failing query's corresponding KPI card SHALL display `"--"` while the remaining three cards display their fetched values.

**Validates: Requirements 9.2, 9.8**

---

### Property 7: Pagination range formula correctness

*For any* valid `page` (integer ≥ 1) and `pageSize` (integer 1–100), `activityService.getActivityLogs({ page, pageSize })` SHALL invoke Supabase's `.range(from, to)` with `from = (page - 1) * pageSize` and `to = from + pageSize - 1`.

**Validates: Requirements 8.2, 8.4**

---

### Property 8: Filter change always resets page to 1

*For any* currently active filter and any new filter selection (including switching to the same filter, switching to "All", or switching to any specific `ActivityLogEventType`), the `ActivityLogs` page SHALL reset `page` to `1` before issuing the new `getActivityLogs` query, regardless of the current page number.

**Validates: Requirements 17.4**

---

### Property 9: CSV column order is always fixed

*For any* non-empty array of `Asset` rows returned by the CSV export query, the UTF-8 CSV string generated by `ExportCSVButton` SHALL have a header row (the first line of the string, split by newline) equal to exactly `"tag,name,status,condition,location,created_at"`, with no extra columns, no reordering, and no omissions.

**Validates: Requirements 15.2, 15.3**

---

### Property 10: `getActivityLogs` count null fallback

*For any* execution of `activityService.getActivityLogs(options)` where Supabase returns `null` for the `count` field (regardless of whether `data` rows are present), the returned object SHALL have `count: 0`, never `null` or `undefined`.

**Validates: Requirements 8.2**

---

## Error Handling

### Service Functions

| Function | Failure scenario | Service behaviour | UI behaviour |
|---|---|---|---|
| `activityService.getRecentActivity` | Supabase error | `throw new Error(error.message)` | `RecentActivityFeed` shows "Could not load activity"; KPI cards unaffected |
| `activityService.getActivityLogs` | Supabase error | `throw new Error(error.message)` | ActivityLogs page shows inline error in feed area; pagination controls stay in pre-error state |
| `dashboardService.getDashboardKPIs` — individual count query | Supabase/network error on one of the 4 queries | Individual query rejects; other 3 resolve normally | Affected `KPICard` shows `"--"`; others render their values |
| `dashboardService.getOverdueCount` | Any error | Returns `0` (silent suppression) | Banner not rendered (count treated as 0) |
| `ExportCSVButton` — query | Supabase error | Error thrown, caught in component | Inline error message adjacent to button; button re-enabled |
| `IdleAssetsList` — query | Supabase error | Error thrown, caught in component | Inline error message in the idle assets section |
| `MaintenanceDueList` — query | Supabase error | Inline error message in the maintenance-due section | |

### Trigger Functions

| Trigger | Failure scenario | Behaviour |
|---|---|---|
| `log_new_allocation()` | Any exception during log INSERT (e.g., RLS denial, constraint violation, table lock) | `EXCEPTION WHEN OTHERS THEN NULL` — exception swallowed; `RETURN NEW` lets the `allocations` INSERT commit |
| `log_maintenance_update()` | Any exception during log INSERT | `EXCEPTION WHEN OTHERS THEN NULL` — exception swallowed; originating UPDATE commits |
| `log_booking_created()` | Any exception during log INSERT | `EXCEPTION WHEN OTHERS THEN NULL` — exception swallowed; originating `bookings` INSERT commits |

### Page-Level Error Boundaries

All three new pages (`Dashboard.tsx`, `Reports.tsx`, `ActivityLogs.tsx`) are wrapped in a React `ErrorBoundary` component. Any unhandled rendering error (e.g., unexpected null dereference in a component) is caught by the boundary and renders a generic "Something went wrong" fallback rather than crashing the whole application.

`ChartsSection` on the Reports page gets its own nested `ErrorBoundary` specifically to catch import failures from Recharts (Req 12.5), so a missing Recharts package degrades gracefully without affecting the rest of the page.

---

## Testing Strategy

### Dual-Layer Approach

Unit tests cover specific scenarios, edge cases, and integration points. Property-based tests (fast-check) verify universal properties across hundreds of generated inputs. Both are complementary — unit tests catch concrete named bugs; property tests verify general invariants.

### Property-Based Testing

Library: **fast-check** (already installed as `devDependency` at `^4.1.1`).
Test runner: **vitest** (`npm test` runs `vitest --run`).
Configuration: minimum **100 iterations** per property test.
Tag format: `// Feature: assetflow-stage4, Property N: <property_text>`

Each correctness property above maps to exactly one property-based test:

| Property | What varies | What's verified | Key fast-check arbitraries |
|---|---|---|---|
| P1: Allocation trigger isolation | Any valid allocation input; simulate log INSERT failure | `allocations` row exists after trigger exception | `fc.uuid()`, `fc.date()`, mock `activity_logs` table to throw |
| P2: Booking trigger isolation | Any valid booking input; simulate log INSERT failure | `bookings` row exists after trigger exception | `fc.uuid()`, `fc.string()`, `fc.date()`, mock `activity_logs` to throw |
| P3: Maintenance trigger filter | Any `maintenance_requests` UPDATE to any `maintenance_status` value, from any prior status | Log row count exactly matches expected (1 for Approved/Resolved transition, 0 for others) | `fc.constantFrom(...MaintenanceStatus values)`, mock DB |
| P4: actor_id ON DELETE SET NULL | N log rows with actor_id pointing to a profile | All N rows survive delete; actor_id = NULL on each | `fc.array(fc.uuid(), {minLength: 1})`, mock DB |
| P5: RLS tier correctness | N log rows with varied actor_ids, including NULL; any UserRole | Correct subset visible per role tier | `fc.uuid()`, `fc.constantFrom(...UserRole)`, `fc.array()`, Supabase test client per role |
| P6: KPI Promise.all isolation | Index of the failing KPI query (0–3) | Other 3 counts resolve; failing count shows "--" | `fc.integer({min:0, max:3})`, mock four count functions |
| P7: Pagination range formula | Any `page` ≥ 1, any `pageSize` 1–100 | `.range(from, to)` called with `from=(page-1)*pageSize`, `to=from+pageSize-1` | `fc.integer({min:1, max:500})`, `fc.integer({min:1, max:100})` |
| P8: Filter reset resets page | Any `activeFilter`, any `newFilter`, any `currentPage` ≥ 1 | Query issued with `page: 1` after filter change | `fc.constantFrom(null, ...ActivityLogEventType)` × 2, `fc.integer({min:1})` |
| P9: CSV column order | Any non-empty array of Asset rows | First CSV line equals `"tag,name,status,condition,location,created_at"` | `fc.array(assetArbitrary, {minLength:1})` |
| P10: count null fallback | Any `GetActivityLogsOptions` | Service returns `count: 0` when Supabase count is null | `fc.record({page: fc.integer({min:1}), pageSize: fc.integer({min:1, max:100})})`, mock Supabase to return `count: null` |

### Unit Tests

**`activityService.ts`:**
- `getRecentActivity` with `limit=5` returns at most 5 rows ordered `created_at DESC`
- `getRecentActivity` throws when Supabase returns an error
- `getActivityLogs` without `eventType` does not call `.eq()`
- `getActivityLogs` with `eventType` calls `.eq('event_type', eventType)`
- `getActivityLogs` returns `count: 0` when Supabase count is `null`

**`dashboardService.ts`:**
- `getDashboardKPIs` calls 4 queries with `{ count: 'exact', head: true }`
- `getDashboardKPIs` uses the correct `WHERE` clauses for each KPI
- Active-bookings-today query uses correct UTC day boundary computation
- `getOverdueCount` returns `0` on error (no throw)

**`Dashboard.tsx`:**
- Shows 4 KPI card slots on render
- Shows skeleton placeholders while data is loading
- Shows `"--"` when a KPI query fails
- Shows overdue banner when count > 0 with correct message
- Shows no banner when count = 0
- Shows "No recent activity" when `getRecentActivity` returns `[]`
- Shows "Could not load activity" when `getRecentActivity` throws

**`Reports.tsx`:**
- Renders Export CSV button visible to all authenticated users
- CSV button enters disabled/loading state on click
- Idle assets shows "No idle assets" on empty result
- Maintenance-due shows "No assets due for maintenance" on empty result
- Chart section renders error boundary fallback when Recharts import fails

**`ActivityLogs.tsx`:**
- Renders exactly 7 filter pills with correct labels
- "All" pill active by default
- Previous button disabled on page 1
- Next button disabled when `count <= pageSize`
- Next button disabled when `page * pageSize >= count`
- Clicking a filter pill resets page to 1
- Shows "No activity recorded yet" when count=0

### Integration Tests (manual, against Supabase)

These require a live Supabase test project or local `supabase start`. Marked optional for MVP:

- `log_new_allocation()` fires on `allocations` INSERT, creates correct log row
- `log_maintenance_update()` fires only for Approved/Resolved transitions; idempotent on re-update
- `log_booking_created()` fires on `bookings` INSERT, creates correct log row
- RLS: Employee cannot SELECT another user's activity log rows
- RLS: Department Head cannot SELECT rows belonging to a different department
- `actor_id` SET NULL after profile deletion
- `getOverdueCount` returns correct count against live overdue allocations
