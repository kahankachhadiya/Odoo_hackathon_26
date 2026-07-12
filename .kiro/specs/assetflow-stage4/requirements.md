# Requirements Document

## Introduction

AssetFlow Stage 4 extends the existing platform (Stages 1–3) with comprehensive dashboards and activity telemetry. Three screens are introduced or enhanced:

- **Screen 2 — Dashboard**: Rebuilt with real-time KPI cards, an overdue-return alert banner, and a live activity feed drawn from the new `activity_logs` table.
- **Screen 9 — Reports & Analytics**: Adds visual charts (mocked data), actionable lists of idle and maintenance-due assets, and a one-click CSV export of the full inventory.
- **Screen 10 — Activity Logs & Notifications**: A full paginated audit trail with event-type filter pills.

The telemetry backbone is the `activity_logs` table — an append-only ledger written exclusively by PostgreSQL triggers. Three triggers cover the most significant system events: new allocations, maintenance status changes (Approved/Resolved), and new bookings. RLS on the table enforces role-scoped visibility without requiring any application-layer filtering.

All database changes go into a new migration file (`supabase/migration_stage4_dashboards_telemetry.sql`) **and** must be reflected in `supabase/schema.sql`, which remains the authoritative source of truth for the complete database state.

---

## Glossary

- **Activity_Log_System**: The React + Supabase subsystem responsible for writing, storing, and displaying entries in the `activity_logs` table.
- **Dashboard_System**: The React subsystem responsible for rendering Screen 2 with KPI cards, an overdue banner, and a recent activity feed.
- **Reports_System**: The React subsystem responsible for rendering Screen 9 with charts, actionable asset lists, and CSV export.
- **ActivityLog**: A row in the `activity_logs` table representing one discrete system event.
- **ActivityLog_EventType**: The enum `('Asset Registered', 'Allocation', 'Transfer', 'Booking', 'Maintenance', 'Audit')` stored on each ActivityLog.
- **KPI_Card**: A UI element on Screen 2 that displays a single real-time numeric metric fetched with `count: 'exact', head: true`.
- **Overdue_Allocation**: An allocation row where `returned_at IS NULL AND expected_return_date < current_date`.
- **Idle_Asset**: An asset row where `status = 'Available'`.
- **Maintenance_Due_Asset**: An asset row where `condition = 'Needs Repair'` OR `created_at < (current_date - INTERVAL '3 years')`.
- **Authenticated_User**: Any user with a valid Supabase session (`auth.role() = 'authenticated'`).
- **Admin**: A profile where `role = 'Admin'`. Identified by the existing `is_admin()` SECURITY DEFINER function.
- **Asset_Manager**: A profile where `role IN ('Admin', 'Asset Manager')`. Identified by the existing `is_asset_manager()` SECURITY DEFINER function.
- **Department_Head**: A profile where `role = 'Department Head'`.
- **Employee**: A profile where `role = 'Employee'`.
- **Migration_File**: `supabase/migration_stage4_dashboards_telemetry.sql` — contains all Stage 4 SQL objects for deployment.
- **Schema_File**: `supabase/schema.sql` — the complete database source of truth, updated to include all Stage 4 changes after migration creation.
- **Recharts**: The charting library used to render visual charts on Screen 9.

---

## Requirements

### Requirement 1: Database Schema — activity_logs Table

**User Story:** As a database administrator, I want a well-constrained `activity_logs` table, so that all major system events are stored with a consistent structure and referential integrity.

#### Acceptance Criteria

1. THE Activity_Log_System SHALL store each ActivityLog in an `activity_logs` table (using `CREATE TABLE IF NOT EXISTS`) with columns: `id` (UUID, primary key, `DEFAULT gen_random_uuid()`), `event_type` (ActivityLog_EventType enum, NOT NULL), `message` (Text, NOT NULL, `CHECK (char_length(message) BETWEEN 1 AND 1000)`), `actor_id` (UUID, Nullable, FK → `profiles.id` ON DELETE SET NULL enforced by the FK constraint), `reference_id` (UUID, Nullable), `created_at` (Timestamptz, NOT NULL, `DEFAULT now()`).
2. THE Activity_Log_System SHALL create the `activity_log_event_type` PostgreSQL enum (guarded with a `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL END $$` block for idempotency) with exactly the following values: `'Asset Registered'`, `'Allocation'`, `'Transfer'`, `'Booking'`, `'Maintenance'`, `'Audit'`.
3. WHEN a referenced `profiles` row is deleted, THE Activity_Log_System SHALL set `actor_id` to NULL on all ActivityLog rows that reference that profile — this behaviour is enforced by the `ON DELETE SET NULL` FK constraint declared in criterion 1, not a separate trigger — thereby preserving the log entry rather than deleting it.

---

### Requirement 2: Telemetry Trigger — New Allocation Logged

**User Story:** As an admin, I want a database trigger to automatically create an activity log entry when a new allocation is made, so that the audit trail is always complete without requiring frontend cooperation.

#### Acceptance Criteria

1. THE Activity_Log_System SHALL include a PostgreSQL trigger function `log_new_allocation()` that executes AFTER INSERT on the `allocations` table FOR EACH ROW, and SHALL `RETURN NEW` so the originating INSERT is never aborted by the trigger.
2. WHEN a new allocation row is inserted, THE Activity_Log_System SHALL insert a row into `activity_logs` with `event_type = 'Allocation'`, `actor_id = NEW.assigned_by`, `reference_id = NEW.id`, and `message` constructed by looking up `assets.tag` (via `NEW.asset_id`), `profiles.full_name` for the assigner (via `NEW.assigned_by`), and `profiles.full_name` for the assignee (via `NEW.assigned_to`), producing: `'Asset ' || asset_tag || ' allocated by ' || assigned_by_name || ' to ' || assigned_to_name`.
3. IF any of the three joined values (`asset_tag`, `assigned_by_name`, `assigned_to_name`) cannot be resolved because the `assets` or `profiles` row is not found, THEN THE Activity_Log_System SHALL substitute the string `'Unknown'` for the missing field and still insert the ActivityLog row.
4. IF any exception is raised during the execution of `log_new_allocation()`, THEN THE Activity_Log_System SHALL catch it via `EXCEPTION WHEN OTHERS THEN NULL`, allowing the original `allocations` INSERT to commit successfully, prioritising core allocation functionality over telemetry completeness.

---

### Requirement 3: Telemetry Trigger — Maintenance Status Change Logged

**User Story:** As an admin, I want a database trigger to automatically log when a maintenance request reaches Approved or Resolved status, so that significant repair milestones are captured in the activity trail.

#### Acceptance Criteria

1. THE Activity_Log_System SHALL include a PostgreSQL trigger function `log_maintenance_update()` that executes AFTER UPDATE on `maintenance_requests` FOR EACH ROW, and SHALL `RETURN NEW` so the originating UPDATE is never aborted by the trigger.
2. WHEN a `maintenance_requests` UPDATE sets `NEW.status = 'Approved'` AND `OLD.status != 'Approved'`, THE Activity_Log_System SHALL insert a row into `activity_logs` with `event_type = 'Maintenance'`, `actor_id = NEW.requested_by`, `reference_id = NEW.id`, and `message` constructed by looking up `assets.tag` (via `NEW.asset_id`) with `'Unknown'` as fallback, producing: `'Maintenance request for ' || asset_tag || ' Approved'`.
3. WHEN a `maintenance_requests` UPDATE sets `NEW.status = 'Resolved'` AND `OLD.status != 'Resolved'`, THE Activity_Log_System SHALL insert a row into `activity_logs` with `event_type = 'Maintenance'`, `actor_id = NEW.requested_by`, `reference_id = NEW.id`, and `message` formatted as `'Maintenance request for ' || asset_tag || ' Resolved'`.
4. IF `NEW.status` is any value other than `'Approved'` or `'Resolved'`, THEN THE Activity_Log_System SHALL NOT insert any row into `activity_logs` for that UPDATE.
5. IF any exception is raised during the execution of `log_maintenance_update()`, THEN THE Activity_Log_System SHALL catch it via `EXCEPTION WHEN OTHERS THEN NULL`, allowing the original `maintenance_requests` UPDATE to commit successfully.

---

### Requirement 4: Telemetry Trigger — New Booking Logged

**User Story:** As an admin, I want a database trigger to automatically create an activity log entry when a booking is created, so that resource reservations are captured in the audit trail without frontend coordination.

#### Acceptance Criteria

1. THE Activity_Log_System SHALL include a PostgreSQL trigger function `log_booking_created()` that executes AFTER INSERT on the `bookings` table FOR EACH ROW, and SHALL `RETURN NEW` so the originating INSERT is never aborted by the trigger.
2. WHEN a new booking row is inserted, THE Activity_Log_System SHALL insert a row into `activity_logs` with `event_type = 'Booking'`, `actor_id = NEW.booked_by`, `reference_id = NEW.id`, and `message` formatted as `'Resource ' || NEW.title || ' booked for ' || NEW.start_time::DATE`.
3. IF any exception is raised during the execution of `log_booking_created()`, THEN THE Activity_Log_System SHALL catch it via `EXCEPTION WHEN OTHERS THEN NULL`, allowing the original `bookings` INSERT to commit successfully, prioritising core booking functionality over telemetry completeness.

---

### Requirement 5: Row-Level Security — activity_logs Table

**User Story:** As a system administrator, I want RLS policies on the `activity_logs` table, so that users see only the log entries they are authorised to read, and the ledger remains immutable to all clients.

#### Acceptance Criteria

1. THE Activity_Log_System SHALL enable Row Level Security on the `activity_logs` table.
2. IF the current authenticated user's profile has `role = 'Admin'` OR `role = 'Asset Manager'`, THEN THE Activity_Log_System SHALL permit that user to SELECT all rows in `activity_logs`; this check MUST use `auth.role() = 'authenticated'` as a prerequisite guard to prevent unauthenticated access.
3. IF the current authenticated user's profile has `role = 'Department Head'`, THEN THE Activity_Log_System SHALL permit that user to SELECT only ActivityLog rows where `actor_id` is a non-NULL UUID that exists in `profiles` with a `department_id` matching the department where `departments.head_id = auth.uid()`; rows where `actor_id IS NULL` SHALL NOT be visible to Department Heads.
4. IF the current authenticated user's profile has `role = 'Employee'`, THEN THE Activity_Log_System SHALL permit that user to SELECT only ActivityLog rows where `actor_id = auth.uid()`; rows where `actor_id IS NULL` or `actor_id` refers to a different user SHALL NOT be visible to that Employee.
5. THE Activity_Log_System SHALL deny INSERT operations on `activity_logs` for all authenticated roles via a policy with `WITH CHECK (false)` (SECURITY DEFINER trigger functions bypass RLS by design and remain the sole insert path).
6. THE Activity_Log_System SHALL deny UPDATE operations on `activity_logs` for all roles via a policy with `USING (false)`.
7. THE Activity_Log_System SHALL deny DELETE operations on `activity_logs` for all roles via a policy with `USING (false)`.

---

### Requirement 6: Database Migration and Schema Files

**User Story:** As a developer, I want all Stage 4 database changes in a dedicated migration file and reflected in schema.sql, so that I can deploy the changes independently and always have a single source of truth for the full database state.

#### Acceptance Criteria

1. THE Activity_Log_System SHALL deliver all Stage 4 database objects (enum, table, trigger functions, trigger attachments, RLS policies) in a new file `supabase/migration_stage4_dashboards_telemetry.sql`, using idempotency guards (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER`) so the file can be re-run without error.
2. WHEN the migration file is executed against a Supabase project that already has Stages 1, 2, and 3 applied, THE Activity_Log_System SHALL complete with the transaction committed, no exceptions raised, and all of the following objects present: the `activity_log_event_type` enum with 6 values, the `activity_logs` table with 6 columns, all three trigger functions attached to their respective tables, RLS enabled on `activity_logs`, and all 5 RLS policies (1 select per role tier, 1 insert-deny, 1 update-deny, 1 delete-deny).
3. THE Activity_Log_System SHALL NOT modify `supabase/migration_stage2_assets_allocation.sql` or `supabase/migration_stage3_booking_maintenance.sql`.
4. THE Activity_Log_System SHALL update `supabase/schema.sql` to append all Stage 4 schema objects, demarcated by a header comment matching the existing style (e.g., `-- ===...=== AssetFlow Stage 4 — Dashboards & Telemetry ===...===`), including: the `activity_log_event_type` enum, the `activity_logs` table, all three trigger functions, all three trigger attachments, and all RLS policies.
5. WHEN `supabase/schema.sql` is applied to a fresh Supabase project from scratch, the resulting database SHALL contain the `activity_log_event_type` enum with exactly 6 values, the `activity_logs` table with exactly 6 columns, RLS enabled on `activity_logs`, 3 trigger functions (`log_new_allocation`, `log_maintenance_update`, `log_booking_created`), and those triggers attached to `allocations`, `maintenance_requests`, and `bookings` respectively — equivalent to what applying Stages 1–4 migrations in sequence would produce.

---

### Requirement 7: TypeScript Types for Stage 4

**User Story:** As a developer, I want TypeScript types for the new database table and enums, so that the activity service layer and UI components are fully type-safe with zero `any` usages.

#### Acceptance Criteria

1. THE Activity_Log_System SHALL add `ActivityLogEventType` (`'Asset Registered' | 'Allocation' | 'Transfer' | 'Booking' | 'Maintenance' | 'Audit'`) union type to `src/types/index.ts`.
2. THE Activity_Log_System SHALL add an `ActivityLog` interface to `src/types/index.ts` with fields: `id: string`, `event_type: ActivityLogEventType`, `message: string`, `actor_id: string | null`, `reference_id: string | null`, `created_at: string`.
3. THE Activity_Log_System SHALL add a `GetActivityLogsOptions` service input type to `src/types/index.ts` with fields: `eventType?: ActivityLogEventType`, `page?: number` (integer ≥ 1, defaults to 1), `pageSize?: number` (integer between 1 and 100 inclusive, defaults to 20).
4. THE Activity_Log_System SHALL add a `DashboardKPIs` interface to `src/types/index.ts` with fields: `totalAvailableAssets: number`, `totalAllocatedAssets: number`, `activeBookingsToday: number`, `pendingMaintenance: number`.

---

### Requirement 8: Activity Service Layer

**User Story:** As a developer, I want an `activityService.ts` module, so that all Supabase interactions for the `activity_logs` table are encapsulated and testable independently of UI components.

#### Acceptance Criteria

1. THE Activity_Log_System SHALL expose `getRecentActivity(limit: number): Promise<ActivityLog[]>` (where `limit` is an integer between 1 and 100 inclusive) that SELECTs the most recent `limit` rows from `activity_logs` ordered by `created_at DESC`; IF the Supabase query returns an error, THE function SHALL throw `new Error(error.message)`.
2. THE Activity_Log_System SHALL expose `getActivityLogs(options: GetActivityLogsOptions): Promise<{ data: ActivityLog[]; count: number }>` that SELECTs rows from `activity_logs` with `{ count: 'exact' }`, ordered by `created_at DESC`, using `page` (default 1) and `pageSize` (default 20) to compute the range as `from = (page - 1) * pageSize`, `to = from + pageSize - 1`; when Supabase returns `null` for count, THE function SHALL use `0` as the fallback; IF the query returns an error, THE function SHALL throw `new Error(error.message)`.
3. WHEN `options.eventType` is provided, THE Activity_Log_System SHALL add a `.eq('event_type', options.eventType)` filter to the Supabase query before executing it.
4. THE Activity_Log_System SHALL use Supabase's `.range(from, to)` method to implement cursor-free offset pagination for `getActivityLogs`, where `from` and `to` are derived from the formula in criterion 2.

---

### Requirement 9: Dashboard KPI Cards

**User Story:** As any authenticated user, I want to see real-time KPI cards on the Dashboard, so that I immediately understand the operational state of the asset fleet upon login.

#### Acceptance Criteria

1. THE Dashboard_System SHALL render exactly four KPI_Cards on Screen 2: "Total Assets Available", "Total Assets Allocated", "Active Bookings Today", and "Pending Maintenance".
2. WHEN Screen 2 loads, THE Dashboard_System SHALL execute all four KPI count queries concurrently using `Promise.all`, so that a slow individual query does not block the others.
3. THE Dashboard_System SHALL fetch the "Total Assets Available" count by querying `assets` WHERE `status = 'Available'` using `{ count: 'exact', head: true }`.
4. THE Dashboard_System SHALL fetch the "Total Assets Allocated" count by querying `assets` WHERE `status = 'Allocated'` using `{ count: 'exact', head: true }`.
5. THE Dashboard_System SHALL fetch the "Active Bookings Today" count by querying `bookings` WHERE (`status = 'Upcoming'` OR `status = 'Ongoing'`) AND `start_time` falls within the UTC day boundaries of today's date (i.e., `>= today 00:00:00 UTC` AND `< tomorrow 00:00:00 UTC`), using `{ count: 'exact', head: true }`.
6. THE Dashboard_System SHALL fetch the "Pending Maintenance" count by querying `maintenance_requests` WHERE `status = 'Pending'` using `{ count: 'exact', head: true }`.
7. WHILE any of the four KPI queries are in-flight, THE Dashboard_System SHALL display a skeleton or loading placeholder in each KPI_Card slot.
8. IF any individual KPI query fails (Supabase error or network error), THEN THE Dashboard_System SHALL display `"--"` in the affected KPI_Card and allow the remaining cards to render their values normally.

---

### Requirement 10: Dashboard Overdue Alert Banner

**User Story:** As an admin or asset manager, I want a prominent alert banner when assets are overdue for return, so that I can take immediate follow-up action.

#### Acceptance Criteria

1. WHEN Screen 2 loads, THE Dashboard_System SHALL query `allocations` WHERE `returned_at IS NULL AND expected_return_date < CURRENT_DATE` using `{ count: 'exact', head: true }` concurrently with the KPI queries.
2. WHEN the returned count is greater than zero, THE Dashboard_System SHALL render a red (`bg-red` or equivalent danger-coloured) alert banner containing the exact text `"[N] asset(s) overdue for return — flagged for follow-up"` where `[N]` is the integer count value returned by the query.
3. WHEN the returned count equals zero, OR when the query returns no rows (count is null), THE Dashboard_System SHALL not render any overdue alert banner element in the DOM.
4. IF the overdue count query fails for any reason (network error, Supabase error), THEN THE Dashboard_System SHALL silently suppress the banner (treat as count = 0) without displaying any error indicator to the user.

---

### Requirement 11: Dashboard Recent Activity Feed

**User Story:** As any authenticated user, I want to see a recent activity feed on the Dashboard, so that I can quickly understand what has happened in the system since I last logged in.

#### Acceptance Criteria

1. WHEN Screen 2 loads, THE Dashboard_System SHALL call `activityService.getRecentActivity(5)` to fetch the 5 most recent ActivityLog entries; this call SHALL be made concurrently alongside the KPI and overdue queries.
2. THE Dashboard_System SHALL render each ActivityLog entry in the feed as a list item showing at minimum: the `message` string and the `created_at` timestamp formatted as a human-readable local datetime (e.g., "12 Jul 2026, 14:32").
3. WHEN `getRecentActivity(5)` returns an empty array, THE Dashboard_System SHALL display a "No recent activity" placeholder message in the feed area.
4. IF `getRecentActivity(5)` throws an error, THEN THE Dashboard_System SHALL display a "Could not load activity" error message in the feed area; this failure SHALL NOT affect the rendering of KPI cards or the overdue banner.

---

### Requirement 12: Reports Page — Visual Charts

**User Story:** As a manager, I want visual charts showing utilization and maintenance trends on Screen 9, so that I can present high-level insights during reviews.

#### Acceptance Criteria

1. THE Reports_System SHALL render a "Utilization by Department" Bar Chart on Screen 9 using Recharts' `BarChart` component with `XAxis`, `YAxis`, `Tooltip`, and at least one `Bar` series.
2. THE Reports_System SHALL render a "Maintenance Frequency" Line Chart on Screen 9 using Recharts' `LineChart` component with `XAxis`, `YAxis`, `Tooltip`, and at least one `Line` series.
3. THE Reports_System SHALL use hardcoded static JSON arrays (defined as module-level constants) as the sole data source for both charts; THE Reports_System SHALL NOT execute any Supabase query to populate chart data.
4. WHERE the Recharts library is installed (i.e., importable without error) and no other rendering error occurs, THE Reports_System SHALL successfully mount both chart components with the static data visible in the rendered output.
5. WHERE the Recharts library cannot be imported (e.g., not installed), THE Reports_System SHALL render a `<div>` placeholder with a descriptive message (e.g., "Chart unavailable") in place of each chart, rather than throwing an unhandled runtime error.

---

### Requirement 13: Reports Page — Idle Assets List

**User Story:** As an asset manager, I want to see a list of idle assets on Screen 9, so that I can identify underutilised inventory and consider reallocation.

#### Acceptance Criteria

1. WHEN Screen 9 loads, THE Reports_System SHALL query `assets` WHERE `status = 'Available'` ordered by `created_at ASC` (oldest idle first), with a hard limit of 5 rows; IF the query returns a Supabase error, THE Reports_System SHALL display an inline error message in the idle assets section.
2. THE Reports_System SHALL render each returned asset row as a list item showing at minimum: the asset `tag`, `name`, and `location` (displaying `"—"` or `"N/A"` when `location` is null).
3. WHEN the query returns zero rows, THE Reports_System SHALL display a "No idle assets" empty-state message in the idle assets section; this message SHALL NOT appear when rows are returned.

---

### Requirement 14: Reports Page — Maintenance Due Assets List

**User Story:** As an asset manager, I want a list of assets due for maintenance or retirement on Screen 9, so that I can proactively schedule repairs or disposals.

#### Acceptance Criteria

1. WHEN Screen 9 loads, THE Reports_System SHALL query `assets` WHERE `condition = 'Needs Repair'` OR `created_at < (now() - INTERVAL '3 years')`, with a hard limit of 10 rows, ordered by `created_at ASC`; IF the query returns a Supabase error, THE Reports_System SHALL display an inline error message in the maintenance-due section.
2. THE Reports_System SHALL render each returned asset row as a list item showing at minimum: the asset `tag`, `name`, `condition` (displaying `"—"` when null), and `created_at` formatted as a human-readable date (e.g., "03 Jan 2022").
3. WHEN the query returns zero rows, THE Reports_System SHALL display a "No assets due for maintenance" empty-state message; this message SHALL NOT appear when rows are returned.

---

### Requirement 15: Reports Page — CSV Export

**User Story:** As an admin, I want a CSV export button on Screen 9, so that I can download the full asset inventory for offline analysis or reporting.

#### Acceptance Criteria

1. THE Reports_System SHALL render a clearly labelled "Export CSV" button on Screen 9 that is visible and enabled for all Authenticated_User roles.
2. WHEN the "Export CSV" button is clicked, THE Reports_System SHALL query all rows from the `assets` table (no row limit) selecting exactly these columns in order: `tag`, `name`, `status`, `condition`, `location`, `created_at`; during the query THE button SHALL enter a loading/disabled state to prevent duplicate submissions.
3. WHEN the query completes successfully, THE Reports_System SHALL construct a UTF-8 CSV string (with a header row matching the column names) from the returned rows and trigger a browser file download using a `<a>` element with `download` attribute, with filename `assetflow-inventory-YYYY-MM-DD.csv` where `YYYY-MM-DD` is the current local date; after download is triggered THE button SHALL return to its enabled state.
4. IF the CSV export query returns a Supabase error, THEN THE Reports_System SHALL display an inline error message directly adjacent to the "Export CSV" button and return the button to its enabled state.

---

### Requirement 16: Activity Logs Page — Paginated Log Feed

**User Story:** As an admin, I want a paginated list of all activity log entries on Screen 10, so that I can audit the full history of system actions.

#### Acceptance Criteria

1. THE Activity_Log_System SHALL render Screen 10 as a list view of ActivityLog entries ordered by `created_at DESC`, with each entry showing `event_type`, `message`, and `created_at` formatted as a human-readable local datetime string.
2. WHEN Screen 10 loads, THE Activity_Log_System SHALL call `activityService.getActivityLogs({ page: 1, pageSize: 20 })` to load the first page; WHILE the query is in-flight, THE Activity_Log_System SHALL display a loading indicator in the log feed area.
3. THE Activity_Log_System SHALL render a "Previous" pagination button and a "Next" pagination button below the log feed; clicking either SHALL call `getActivityLogs` with the updated `page` value and replace the current feed with the new results.
4. WHEN the current page is 1, THE Activity_Log_System SHALL disable the "Previous" button (e.g., `disabled` attribute or aria-disabled) and SHALL NOT navigate below page 1.
5. WHEN `count <= pageSize` (i.e., total entries fit on one page), THE Activity_Log_System SHALL disable the "Next" button; WHEN `page * pageSize >= count`, THE Activity_Log_System SHALL also disable the "Next" button.
6. IF `getActivityLogs` throws an error on any page load, THE Activity_Log_System SHALL display an inline error message in the feed area and leave the pagination controls in their pre-error state.
7. WHEN `getActivityLogs` returns `data: []` and `count: 0` (e.g., for a fresh database with no activity), THE Activity_Log_System SHALL display a "No activity recorded yet" empty-state message and disable both pagination buttons.

---

### Requirement 17: Activity Logs Page — Event Type Filters

**User Story:** As any authenticated user, I want filter pills to narrow the activity log by event type, so that I can find specific actions without scrolling through unrelated entries.

#### Acceptance Criteria

1. THE Activity_Log_System SHALL render exactly 7 filter pill buttons above the log feed on Screen 10 with labels in this order: "All", "Asset Registered", "Allocation", "Transfer", "Booking", "Maintenance", "Audit"; the "All" pill SHALL be active by default on page load.
2. WHEN the "All" pill is the active filter, THE Activity_Log_System SHALL call `getActivityLogs` without an `eventType` filter, displaying entries of all event types.
3. WHEN a specific event-type pill is clicked, THE Activity_Log_System SHALL set that pill as active, call `activityService.getActivityLogs({ eventType: selectedType, page: 1, pageSize: 20 })`, and replace the entire current log feed with the filtered results.
4. WHEN any filter pill is clicked (including "All"), THE Activity_Log_System SHALL reset the current page to 1 before issuing the new query.
5. THE Activity_Log_System SHALL render the active filter pill with a visually distinct filled/solid style and all inactive pills with an outlined/ghost style, so that the active filter is unambiguously identifiable at a glance.

---

### Requirement 18: Routing & Navigation

**User Story:** As any authenticated user, I want Screen 9 and Screen 10 accessible from the Dashboard navigation, so that I can reach the reports and activity log views without editing the URL manually.

#### Acceptance Criteria

1. THE Reports_System SHALL add a route `/reports` to `src/App.tsx` that renders the Reports & Analytics page (Screen 9), protected by the existing authentication guard so that unauthenticated users are redirected to the login page.
2. THE Activity_Log_System SHALL add a route `/activity-logs` to `src/App.tsx` that renders the Activity Logs page (Screen 10), protected by the existing authentication guard so that unauthenticated users are redirected to the login page.
3. THE Dashboard_System SHALL add navigation links or sidebar entries to `/reports` and `/activity-logs` that are visible and clickable to all Authenticated_User roles; clicking either link SHALL navigate the user to the corresponding route without a full page reload.
