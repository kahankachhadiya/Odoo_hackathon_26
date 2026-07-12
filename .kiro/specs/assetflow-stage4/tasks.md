# Implementation Plan: AssetFlow Stage 4 — Dashboards & Telemetry

## Overview

Implement Stage 4 telemetry backbone and three new/rebuilt screens on top of the existing Stages 1–3 infrastructure: **Dashboard (rebuilt)** with KPI cards, overdue banner, and live activity feed; **Reports & Analytics (new)** with Recharts charts, idle/maintenance-due asset lists, and CSV export; **Activity Logs (new)** with a paginated, filterable audit trail.

**Key constraints:**
- All DB changes go in `supabase/migration_stage4_dashboards_telemetry.sql` AND are reflected in `supabase/schema.sql` (append Stage 4 section) — never modify prior migration files
- TypeScript strict mode, zero `any` types
- Triggers use `SECURITY DEFINER SET search_path = public` and `EXCEPTION WHEN OTHERS THEN NULL` pattern
- PBT tag format: `// Feature: assetflow-stage4, Property N: <text>`
- Install `recharts` as a production dependency before building Reports.tsx
- Test framework: Vitest + fast-check + React Testing Library (already installed)

---

## Tasks

- [x] 1. Write the Stage 4 database migration file and update schema.sql
  - Create `supabase/migration_stage4_dashboards_telemetry.sql` (additive only — never touch prior migration files)
  - Add `activity_log_event_type` enum using idempotent `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` block with exactly 6 values: `'Asset Registered'`, `'Allocation'`, `'Transfer'`, `'Booking'`, `'Maintenance'`, `'Audit'`
  - Create `activity_logs` table using `CREATE TABLE IF NOT EXISTS` with columns: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `event_type activity_log_event_type NOT NULL`, `message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000)`, `actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL`, `reference_id UUID`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - Create `log_new_allocation()` trigger function: `SECURITY DEFINER SET search_path = public`, `AFTER INSERT ON allocations FOR EACH ROW`, look up `assets.tag` and both `profiles.full_name` values with `COALESCE(..., 'Unknown')` fallback, insert into `activity_logs` with `event_type = 'Allocation'`, wrap entire body in `EXCEPTION WHEN OTHERS THEN NULL`, return `NEW`
  - Attach trigger: `DROP TRIGGER IF EXISTS on_allocation_logged ON allocations; CREATE TRIGGER on_allocation_logged AFTER INSERT ON allocations FOR EACH ROW EXECUTE FUNCTION log_new_allocation()`
  - Create `log_maintenance_update()` trigger function: `SECURITY DEFINER SET search_path = public`, `AFTER UPDATE ON maintenance_requests FOR EACH ROW`, guard `IF (NEW.status = 'Approved' AND OLD.status != 'Approved') OR (NEW.status = 'Resolved' AND OLD.status != 'Resolved')`, look up `assets.tag` with `COALESCE(..., 'Unknown')`, insert `'Maintenance'` log row, wrap insert in `EXCEPTION WHEN OTHERS THEN NULL`, return `NEW`
  - Attach trigger: `DROP TRIGGER IF EXISTS on_maintenance_logged ON maintenance_requests; CREATE TRIGGER on_maintenance_logged AFTER UPDATE ON maintenance_requests FOR EACH ROW EXECUTE FUNCTION log_maintenance_update()`
  - Create `log_booking_created()` trigger function: `SECURITY DEFINER SET search_path = public`, `AFTER INSERT ON bookings FOR EACH ROW`, build message `'Resource ' || NEW.title || ' booked for ' || NEW.start_time::DATE`, insert `'Booking'` log row with `actor_id = NEW.booked_by`, wrap in `EXCEPTION WHEN OTHERS THEN NULL`, return `NEW`
  - Attach trigger: `DROP TRIGGER IF EXISTS on_booking_logged ON bookings; CREATE TRIGGER on_booking_logged AFTER INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION log_booking_created()`
  - Enable RLS: `ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY`
  - Add 6 RLS policies (using `DROP POLICY IF EXISTS` before each `CREATE POLICY`): select for Admin/Asset Manager (`role IN ('Admin', 'Asset Manager')` with `auth.role() = 'authenticated'` guard); select for Department Head (actor's `department_id` matches dept where `head_id = auth.uid()`, `actor_id IS NOT NULL` guard); select for Employee (`actor_id = auth.uid()`); insert denied (`WITH CHECK (false)`); update denied (`USING (false)`); delete denied (`USING (false)`)
  - Append Stage 4 section to `supabase/schema.sql` demarcated by `-- ===...=== AssetFlow Stage 4 — Dashboards & Telemetry ===...===` header comment, containing all the same objects (enum, table, trigger functions, trigger attachments, RLS enable, RLS policies)
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 2. Add Stage 4 TypeScript types to `src/types/index.ts`
  - [x] 2.1 Add `ActivityLogEventType` union type and `ActivityLog`, `DashboardKPIs`, `GetActivityLogsOptions` interfaces
    - Add `// ─── Stage 4 Enum Types ───` section header
    - Add `export type ActivityLogEventType = 'Asset Registered' | 'Allocation' | 'Transfer' | 'Booking' | 'Maintenance' | 'Audit'`
    - Add `// ─── Stage 4 Domain Types ───` section header
    - Add `export interface ActivityLog { id: string; event_type: ActivityLogEventType; message: string; actor_id: string | null; reference_id: string | null; created_at: string }`
    - Add `export interface DashboardKPIs { totalAvailableAssets: number; totalAllocatedAssets: number; activeBookingsToday: number; pendingMaintenance: number }`
    - Add `// ─── Stage 4 Service Input Types ───` section header
    - Add `export interface GetActivityLogsOptions { eventType?: ActivityLogEventType; page?: number; pageSize?: number }`
    - Zero `any` — all fields explicitly typed
    - _Requirements: 7.1, 7.2, 7.3, 7.4_


- [x] 3. Implement `activityService.ts`
  - [x] 3.1 Create `src/services/activityService.ts`
    - Implement `getRecentActivity(limit: number): Promise<ActivityLog[]>` — SELECT from `activity_logs` ordered by `created_at DESC` with `.limit(limit)`; throw `new Error(error.message)` on Supabase error
    - Implement `getActivityLogs(options: GetActivityLogsOptions): Promise<{ data: ActivityLog[]; count: number }>` — SELECT with `{ count: 'exact' }`, ordered `created_at DESC`; compute `from = (page - 1) * pageSize` and `to = from + pageSize - 1` using defaults (page=1, pageSize=20); call `.range(from, to)`; when `options.eventType` provided append `.eq('event_type', options.eventType)`; when Supabase returns `null` for count use `0`; throw `new Error(error.message)` on error
    - Use `import type { ActivityLog, GetActivityLogsOptions } from '../types'` — zero `any`
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 3.2 Write unit tests for `activityService.ts`
    - Mock `src/lib/supabaseClient` with `vi.mock`
    - Test `getRecentActivity` calls `.limit(limit)` and returns mapped `ActivityLog[]`
    - Test `getRecentActivity` throws `Error` when Supabase returns an error object
    - Test `getActivityLogs` calls `.range(0, 19)` for default page=1, pageSize=20
    - Test `getActivityLogs` calls `.range(20, 39)` for page=2, pageSize=20
    - Test `getActivityLogs` appends `.eq('event_type', ...)` when `eventType` provided
    - Test `getActivityLogs` returns `count: 0` when Supabase returns `null` for count
    - Test `getActivityLogs` throws `Error` on Supabase error
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 3.3 Write property test — P7: pagination range formula correctness (fast-check)
    - **Property 7: Pagination range formula correctness**
    - Generate arbitrary `page` (integer ≥ 1) and `pageSize` (integer 1–100) using `fc.integer`
    - Assert `getActivityLogs({ page, pageSize })` invokes `.range(from, to)` with `from = (page - 1) * pageSize` and `to = from + pageSize - 1`
    - Tag comment: `// Feature: assetflow-stage4, Property 7: Pagination range formula correctness`
    - **Validates: Requirements 8.2, 8.4**

  - [ ]* 3.4 Write property test — P10: getActivityLogs count null fallback (fast-check)
    - **Property 10: getActivityLogs count null fallback**
    - Generate arbitrary `GetActivityLogsOptions`; mock Supabase to return `count: null` regardless of options
    - Assert returned object has `count: 0`, never `null` or `undefined`
    - Tag comment: `// Feature: assetflow-stage4, Property 10: getActivityLogs count null fallback`
    - **Validates: Requirements 8.2**


- [x] 4. Implement `dashboardService.ts`
  - [x] 4.1 Create `src/services/dashboardService.ts`
    - Implement `getDashboardKPIs(): Promise<DashboardKPIs>` — run four count queries concurrently via `Promise.all`, each using `{ count: 'exact', head: true }`:
      - Query 1: `assets` WHERE `status = 'Available'` → `totalAvailableAssets`
      - Query 2: `assets` WHERE `status = 'Allocated'` → `totalAllocatedAssets`
      - Query 3: `bookings` WHERE `(status = 'Upcoming' OR status = 'Ongoing')` AND `start_time >= today 00:00:00 UTC` AND `start_time < tomorrow 00:00:00 UTC` → `activeBookingsToday`
      - Query 4: `maintenance_requests` WHERE `status = 'Pending'` → `pendingMaintenance`
      - Each count defaults to `data.count ?? 0`; individual query errors propagate as rejected promises (caller handles per-card isolation)
    - Implement `getOverdueCount(): Promise<number>` — query `allocations` WHERE `returned_at IS NULL AND expected_return_date < CURRENT_DATE` with `{ count: 'exact', head: true }`; return `0` on any error (silent suppression)
    - Use `import type { DashboardKPIs } from '../types'` — zero `any`
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.4_

  - [ ]* 4.2 Write unit tests for `dashboardService.ts`
    - Mock `src/lib/supabaseClient` with `vi.mock`
    - Test `getDashboardKPIs` returns correct counts when all four queries resolve
    - Test `getDashboardKPIs` — one query rejecting causes `Promise.all` to reject (caller handles isolation)
    - Test `getOverdueCount` returns correct integer count
    - Test `getOverdueCount` returns `0` when Supabase returns an error (silent suppression)
    - Test `getOverdueCount` returns `0` when count is `null`
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.4_

  - [ ]* 4.3 Write property test — P6: KPI isolation — Promise.all partial failure (fast-check)
    - **Property 6: KPI isolation — Promise.all partial failure**
    - Generate arbitrary sets of 4 query results where exactly one is a rejection and three resolve with numeric counts
    - Assert the Dashboard page (calling queries individually with `Promise.allSettled` or per-card try/catch) renders `"--"` for the failed card and correct values for the remaining three
    - Tag comment: `// Feature: assetflow-stage4, Property 6: KPI isolation — Promise.all partial failure`
    - **Validates: Requirements 9.2, 9.8**

- [ ] 5. Checkpoint — service layer complete
  - Ensure all service unit tests and property tests pass (`npm run test`)
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 6. Install Recharts and rebuild `src/pages/Dashboard.tsx`
  - [ ] 6.1 Install `recharts` production dependency
    - Run `npm install recharts@2.15.3` (pin exact version)
    - Verify `recharts` appears in `package.json` `dependencies`
    - _Requirements: 12.1, 12.4_

  - [ ] 6.2 Rebuild `src/pages/Dashboard.tsx` with KPI cards, overdue banner, and recent activity feed
    - On mount fire all data fetches concurrently: four KPI queries (via `dashboardService.getDashboardKPIs` called as four separate invocations with `Promise.allSettled`, or individual try/catch), `dashboardService.getOverdueCount()`, and `activityService.getRecentActivity(5)`
    - State: `kpis: (number | null)[]` (length 4, null = failed), `overdueCount: number`, `activityLogs: ActivityLog[]`, per-section `loading` and `error` booleans
    - Render exactly four KPI cards labelled: "Total Assets Available", "Total Assets Allocated", "Active Bookings Today", "Pending Maintenance"; while loading show skeleton/placeholder; on error show `"--"` in affected card only
    - Render overdue alert banner (red/danger colour) with text `"[N] asset(s) overdue for return — flagged for follow-up"` only when `overdueCount > 0`; suppress entirely when count is 0 or query failed
    - Render recent activity feed: each `ActivityLog` entry shows `message` and `created_at` formatted as human-readable local datetime (e.g., `"12 Jul 2026, 14:32"`); show "No recent activity" on empty array; show "Could not load activity" on error (does not affect KPI card rendering)
    - Add navigation links to `/reports` and `/activity-logs` in the dashboard nav/sidebar
    - Zero `any` — all state and props explicitly typed
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 10.1, 10.2, 10.3, 10.4, 11.1, 11.2, 11.3, 11.4, 18.3_

  - [ ]* 6.3 Write unit tests for `Dashboard.tsx`
    - Mock `dashboardService` and `activityService` with `vi.mock`
    - Assert four KPI card labels rendered
    - Assert skeleton/loading placeholder shown while data in-flight
    - Simulate one KPI query failing; assert that card shows `"--"` and others show values
    - Simulate `overdueCount = 3`; assert banner text `"3 asset(s) overdue for return — flagged for follow-up"` rendered
    - Simulate `overdueCount = 0`; assert no banner element in DOM
    - Simulate `getRecentActivity` returning 5 entries; assert 5 feed items rendered with message and formatted timestamp
    - Simulate `getRecentActivity` returning empty array; assert "No recent activity" shown
    - Simulate `getRecentActivity` throwing error; assert "Could not load activity" shown; assert KPI cards still render
    - _Requirements: 9.1, 9.7, 9.8, 10.2, 10.3, 10.4, 11.1, 11.2, 11.3, 11.4_


- [ ] 7. Create `src/pages/Reports.tsx`
  - [ ] 7.1 Implement Reports page with charts, idle assets list, maintenance-due list, and CSV export
    - Define module-level static data constants: `utilizationData` (array of `{ department: string; count: number }`) and `maintenanceFrequencyData` (array of `{ month: string; count: number }`) — no Supabase queries for chart data
    - Render "Utilization by Department" bar chart using Recharts `BarChart` with `XAxis`, `YAxis`, `Tooltip`, and at least one `Bar` series, fed from `utilizationData`; wrap in `React.lazy` + `React.Suspense` + `ErrorBoundary`; `ErrorBoundary` renders `<div>Chart unavailable</div>` on import failure
    - Render "Maintenance Frequency" line chart using Recharts `LineChart` with `XAxis`, `YAxis`, `Tooltip`, and at least one `Line` series, fed from `maintenanceFrequencyData`; same lazy/Suspense/ErrorBoundary wrapper
    - On mount, query idle assets: `assets` WHERE `status = 'Available'` ORDER BY `created_at ASC` LIMIT 5; render each as list item showing `tag`, `name`, and `location` (display `"—"` when null); show "No idle assets" on empty; show inline error on Supabase error
    - On mount, query maintenance-due assets: `assets` WHERE `condition = 'Needs Repair'` OR `created_at < now() - INTERVAL '3 years'` ORDER BY `created_at ASC` LIMIT 10; render each as list item showing `tag`, `name`, `condition` (`"—"` when null), `created_at` formatted as human-readable date (e.g., `"03 Jan 2022"`); show "No assets due for maintenance" on empty; show inline error on Supabase error
    - Render "Export CSV" button (visible and enabled for all authenticated roles); on click: disable button, query all `assets` columns `tag,name,status,condition,location,created_at` (no limit), build UTF-8 CSV with fixed header row `"tag,name,status,condition,location,created_at"`, create `Blob`, create `<a download="assetflow-inventory-YYYY-MM-DD.csv">`, trigger download, revoke URL, re-enable button; on error display inline error adjacent to button and re-enable button
    - Zero `any` — all state and Supabase responses typed
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 13.1, 13.2, 13.3, 14.1, 14.2, 14.3, 15.1, 15.2, 15.3, 15.4_

  - [ ]* 7.2 Write unit tests for `Reports.tsx`
    - Mock Supabase client with `vi.mock`
    - Mock Recharts with `vi.mock('recharts', ...)` returning stub components
    - Assert both chart components rendered with static data (no Supabase call made)
    - Simulate idle assets query returning 3 rows; assert 3 items rendered showing tag, name, location
    - Simulate idle assets query returning empty; assert "No idle assets" shown
    - Simulate maintenance-due query returning 2 rows; assert 2 items rendered
    - Simulate maintenance-due query returning empty; assert "No assets due for maintenance" shown
    - Assert "Export CSV" button present and enabled initially
    - Simulate button click with successful query; assert `<a>` download triggered with correct filename pattern and header row
    - Simulate button click with Supabase error; assert inline error shown; assert button re-enabled
    - _Requirements: 12.1, 12.3, 13.1, 13.2, 13.3, 14.1, 14.2, 14.3, 15.1, 15.2, 15.3, 15.4_

  - [ ]* 7.3 Write property test — P9: CSV column order is always fixed (fast-check)
    - **Property 9: CSV column order is always fixed**
    - Generate arbitrary non-empty arrays of `Asset` rows using `fc.array(fc.record(...))`
    - Call the CSV-building logic with the generated rows
    - Assert the first line of the resulting string equals exactly `"tag,name,status,condition,location,created_at"` with no extra columns, no reordering, no omissions
    - Tag comment: `// Feature: assetflow-stage4, Property 9: CSV column order is always fixed`
    - **Validates: Requirements 15.2, 15.3**


- [ ] 8. Create `src/pages/ActivityLogs.tsx`
  - [ ] 8.1 Implement Activity Logs page with paginated feed, 7 filter pills, and pagination controls
    - State: `activeFilter: ActivityLogEventType | null` (null = "All"), `page: number` (starts at 1), `pageSize: number` (fixed 20), `data: ActivityLog[]`, `count: number`, `loading: boolean`, `error: string | null`
    - On mount and on any state change to `activeFilter` or `page`, call `activityService.getActivityLogs({ page, pageSize: 20, eventType: activeFilter ?? undefined })`; show loading indicator while in-flight
    - Render 7 filter pill buttons in order: "All", "Asset Registered", "Allocation", "Transfer", "Booking", "Maintenance", "Audit"; active pill has filled/solid style; inactive pills have outlined/ghost style
    - When a filter pill is clicked: set it as active, reset `page` to 1, fire new query
    - "All" pill emits `activeFilter = null`; specific type pills emit the corresponding `ActivityLogEventType`
    - Render log feed: each entry shows `event_type`, `message`, and `created_at` formatted as human-readable local datetime; while loading show loading indicator in feed area
    - Render "Previous" and "Next" pagination buttons below feed; "Previous" disabled when `page === 1`; "Next" disabled when `page * pageSize >= count` or `count <= pageSize`; clicking either updates `page` and re-fetches
    - Show "No activity recorded yet" empty-state and disable both buttons when `data` is empty and `count === 0`
    - On error: show inline error message in feed area; leave pagination controls in pre-error state
    - Zero `any` — all state typed
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 17.1, 17.2, 17.3, 17.4, 17.5_

  - [ ]* 8.2 Write unit tests for `ActivityLogs.tsx`
    - Mock `activityService` with `vi.mock`
    - Assert 7 filter pills rendered with correct labels in correct order
    - Assert "All" pill active on initial load
    - Simulate clicking "Allocation" pill; assert `getActivityLogs` called with `eventType: 'Allocation'` and `page: 1`
    - Simulate navigating to page 3 then clicking a filter pill; assert page resets to 1
    - Assert "Previous" button disabled on page 1
    - Assert "Next" button disabled when `count <= pageSize`
    - Assert "Next" button disabled when `page * pageSize >= count`
    - Simulate error response; assert inline error shown; assert pagination controls unchanged
    - Simulate empty result (`data: [], count: 0`); assert "No activity recorded yet" shown; assert both buttons disabled
    - Assert feed renders `event_type`, `message`, and formatted `created_at` for each entry
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 17.1, 17.2, 17.3, 17.4, 17.5_

  - [ ]* 8.3 Write property test — P8: filter change always resets page to 1 (fast-check)
    - **Property 8: Filter change always resets page to 1**
    - Generate arbitrary current page numbers (integer ≥ 1) and arbitrary new filter values (including same filter, "All", or any `ActivityLogEventType`)
    - Simulate clicking a filter pill from that page state
    - Assert `getActivityLogs` is called with `page: 1` regardless of the prior page number
    - Tag comment: `// Feature: assetflow-stage4, Property 8: Filter change always resets page to 1`
    - **Validates: Requirements 17.4**

- [ ] 9. Add `/reports` and `/activity-logs` routes to `src/App.tsx`
  - [ ] 9.1 Wire Stage 4 routes and navigation into `src/App.tsx`
    - Import `Reports` from `./pages/Reports`
    - Import `ActivityLogs` from `./pages/ActivityLogs`
    - Add `<Route path="/reports" element={<Reports />} />` inside the existing auth-guarded route group — all authenticated roles (Requirements: 18.1)
    - Add `<Route path="/activity-logs" element={<ActivityLogs />} />` inside the existing auth-guarded route group — all authenticated roles (Requirements: 18.2)
    - Navigation links to `/reports` and `/activity-logs` are already added in Dashboard.tsx (task 6.2); verify links navigate without full page reload using `<Link>` from `react-router-dom`
    - _Requirements: 18.1, 18.2, 18.3_

  - [ ]* 9.2 Write unit tests for route wiring
    - Assert `/reports` renders `Reports` page (not a redirect)
    - Assert `/activity-logs` renders `ActivityLogs` page (not a redirect)
    - _Requirements: 18.1, 18.2_

- [ ] 10. Checkpoint — UI and routing complete
  - Ensure all tests pass (`npm run test`)
  - Ensure all tests pass, ask the user if questions arise.


- [ ] 11. Write remaining property-based tests
  - [ ]* 11.1 Write property test — P1: allocation trigger isolation (fast-check)
    - **Property 1: Allocation trigger isolation — core INSERT always succeeds**
    - Mock `log_new_allocation()` to throw an arbitrary exception; insert into `allocations` via `allocationService.createAllocation()`
    - Assert the allocation INSERT commits successfully and the new row is present
    - Assert the thrown exception from the trigger function is swallowed (no unhandled error)
    - Tag comment: `// Feature: assetflow-stage4, Property 1: Allocation trigger isolation — core INSERT always succeeds`
    - **Validates: Requirements 2.4**

  - [ ]* 11.2 Write property test — P2: booking trigger isolation (fast-check)
    - **Property 2: Booking trigger isolation — core INSERT always succeeds**
    - Mock `log_booking_created()` to throw an arbitrary exception; insert a booking via `bookingService.createBooking()`
    - Assert the booking INSERT commits successfully and the new row is present
    - Assert the exception is swallowed and does not propagate to the caller
    - Tag comment: `// Feature: assetflow-stage4, Property 2: Booking trigger isolation — core INSERT always succeeds`
    - **Validates: Requirements 4.3**

  - [ ]* 11.3 Write property test — P3: maintenance trigger filter and idempotency (fast-check)
    - **Property 3: Maintenance trigger filter — correct status guard and idempotency**
    - Generate arbitrary `maintenance_requests` status transitions using `fc.oneof`
    - Assert: transitioning to `'Approved'` from non-`'Approved'` → exactly 1 `'Maintenance'` log row inserted
    - Assert: transitioning to `'Resolved'` from non-`'Resolved'` → exactly 1 `'Maintenance'` log row inserted
    - Assert: re-transitioning to `'Approved'` from `'Approved'` → 0 rows inserted
    - Assert: transitioning to `'Pending'`, `'In Progress'`, or `'Rejected'` → 0 rows inserted
    - Tag comment: `// Feature: assetflow-stage4, Property 3: Maintenance trigger filter — correct status guard and idempotency`
    - **Validates: Requirements 3.2, 3.3, 3.4**

  - [ ]* 11.4 Write property test — P4: actor_id ON DELETE SET NULL preserves log rows (fast-check)
    - **Property 4: actor_id ON DELETE SET NULL — log rows preserved**
    - Generate arbitrary `activity_logs` rows with a non-null `actor_id` pointing to a valid `profiles` row
    - Delete the referenced profile
    - Assert all referencing `activity_logs` rows still exist with `actor_id = NULL`
    - Assert row count in `activity_logs` is unchanged (no cascaded delete)
    - Tag comment: `// Feature: assetflow-stage4, Property 4: actor_id ON DELETE SET NULL — log rows preserved`
    - **Validates: Requirements 1.3**

  - [ ]* 11.5 Write property test — P5: RLS tier correctness (fast-check)
    - **Property 5: RLS tier correctness — role-scoped row visibility**
    - Generate arbitrary sets of `activity_logs` rows with varied `actor_id` values (own user, other users in same dept, other dept, NULL)
    - For Admin/Asset Manager role: assert all rows visible regardless of `actor_id`
    - For Department Head role: assert only rows where `actor_id` is non-NULL and belongs to their department are visible; NULL `actor_id` rows not visible
    - For Employee role: assert only rows where `actor_id = auth.uid()` visible; NULL and other-user rows not visible
    - Tag comment: `// Feature: assetflow-stage4, Property 5: RLS tier correctness — role-scoped row visibility`
    - **Validates: Requirements 5.2, 5.3, 5.4**

- [ ] 12. Final checkpoint — Ensure all tests pass
  - Run `npm run test` and confirm all unit and property tests pass
  - Paste `supabase/migration_stage4_dashboards_telemetry.sql` into Supabase Dashboard → SQL Editor and confirm it runs without errors
  - Verify `on_allocation_logged`, `on_maintenance_logged`, and `on_booking_logged` triggers are visible in Supabase Dashboard
  - Verify `activity_logs` table created with RLS enabled and all 6 policies present
  - Ensure all tests pass, ask the user if questions arise.


---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery
- Each task references specific requirements for traceability
- DB-backed property tests (P1–P5) require a Supabase test project or local Supabase instance; service/UI property tests (P6–P10) run in jsdom with mocked Supabase
- Migration file is additive only; `schema.sql`, `migration_stage2_assets_allocation.sql`, and `migration_stage3_booking_maintenance.sql` are never modified — Stage 4 objects are only appended to `schema.sql`
- `recharts` must be installed before implementing Reports.tsx (task 6.1 precedes 7.1)
- The CSV export builds the Blob entirely in the browser — no server-side endpoint needed
- `getDashboardKPIs` uses `Promise.all` internally; the Dashboard page must handle per-card failure isolation via `Promise.allSettled` or individual try/catch wrappers — a single failing KPI query must not blank out all four cards
- `getOverdueCount` silently returns `0` on any error; the overdue banner must not appear when the query fails
- Trigger functions use `SECURITY DEFINER SET search_path = public` so they execute with elevated privileges and bypass RLS when inserting into `activity_logs`
- PBT tag format for all property tests: `// Feature: assetflow-stage4, Property N: <text>`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["3.1", "4.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "4.2", "4.3"] },
    { "id": 4, "tasks": ["6.1"] },
    { "id": 5, "tasks": ["6.2", "7.1", "8.1"] },
    { "id": 6, "tasks": ["6.3", "7.2", "7.3", "8.2", "8.3"] },
    { "id": 7, "tasks": ["9.1"] },
    { "id": 8, "tasks": ["9.2", "11.1", "11.2", "11.3", "11.4", "11.5"] }
  ]
}
```
