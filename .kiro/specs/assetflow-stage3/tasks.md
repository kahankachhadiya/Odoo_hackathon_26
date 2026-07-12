# Implementation Plan: AssetFlow Stage 3 — Resource Booking & Maintenance Workflows

## Overview

Implement Stage 3 operational workflows: **Resource Booking** (Screen 6) and **Maintenance Kanban** (Screen 7) on top of the existing Stages 1 & 2 infrastructure. Work proceeds in nine waves: database migration → TypeScript types & DB types → service layer → service tests including property tests → UI components → component tests → pages → page tests → routing.

**Key constraints:**
- Never modify `supabase/schema.sql` or `supabase/migration_stage2_assets_allocation.sql` — all DB changes go in `supabase/migration_stage3_booking_maintenance.sql`
- TypeScript strict mode, zero `any` types
- Follow Stage 1/2 patterns: `SECURITY DEFINER` triggers, `BEFORE` trigger for overlap prevention, `AFTER` trigger for status sync, RLS on every table
- 4-column Kanban layout (Pending, Approved, In Progress, Resolved) with click-to-move buttons — no drag-and-drop
- Test framework: Vitest + fast-check + React Testing Library (already installed in Stage 2)

---

## Tasks

- [x] 1. Write the Stage 3 database migration file
  - Create `supabase/migration_stage3_booking_maintenance.sql` (additive only — never touch schema.sql or Stage 2 migration)
  - Add a prerequisite guard: verify `assets`, `profiles`, `is_admin()`, and `is_asset_manager()` exist before proceeding
  - Create enum `booking_status` ('Upcoming', 'Ongoing', 'Completed', 'Cancelled')
  - Create enum `maintenance_priority` ('Low', 'Medium', 'High')
  - Create enum `maintenance_status` ('Pending', 'Approved', 'In Progress', 'Resolved', 'Rejected')
  - Create `bookings` table with all columns, CHECK constraint `start_time < end_time`, `ON DELETE CASCADE` on both FKs, `status` default `'Upcoming'`
  - Create `maintenance_requests` table with all columns, `ON DELETE CASCADE` on both FKs, `priority` default `'Medium'`, `status` default `'Pending'`, `created_at` default `now()`
  - Create `prevent_booking_overlap()` SECURITY DEFINER trigger function: BEFORE INSERT OR UPDATE on bookings, check for overlapping non-cancelled bookings using `NEW.start_time < existing.end_time AND NEW.end_time > existing.start_time`; exclude self via `id != NEW.id`; raise exception `'Booking time slot overlaps with an existing reservation'` if conflict found
  - Attach trigger `on_booking_overlap_check` BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW
  - Create `sync_maintenance_status()` SECURITY DEFINER trigger function: AFTER UPDATE on maintenance_requests, when status changes to 'Approved' set assets.status = 'Under Maintenance'; when status changes to 'Resolved' set assets.status = 'Available'; when status changes to 'Rejected' AND assets.status = 'Under Maintenance' set assets.status = 'Available'
  - Attach trigger `on_maintenance_status_change` AFTER UPDATE ON maintenance_requests FOR EACH ROW
  - Enable RLS on `bookings`, `maintenance_requests`
  - RLS policies for `bookings`: SELECT authenticated; INSERT authenticated (WITH CHECK asset is_bookable = true); UPDATE for booking owner or Admin; DELETE denied
  - RLS policies for `maintenance_requests`: SELECT authenticated; INSERT authenticated; UPDATE via `is_asset_manager()`; DELETE denied
  - Add commented rollback statements at the bottom for manual recovery
  - _Requirements: 1, 2, 3, 4, 5, 6, 14_

- [ ] 2. Extend TypeScript types and database type definitions
  - [x] 2.1 Add Stage 3 domain types to `src/types/index.ts`
    - Add `BookingStatus`, `MaintenancePriority`, `MaintenanceStatus` union types
    - Add `Booking`, `BookingWithAsset`, `MaintenanceRequest`, `MaintenanceRequestWithDetails` interfaces
    - Add `CreateBookingInput`, `CreateMaintenanceRequestInput` input interfaces
    - Add `BookingOverlapError` typed error class (extend `Error`, set `this.name`)
    - _Requirements: 1, 2, 15.1, 15.2, 15.3, 15.5, 15.6_

  - [ ] 2.2 Regenerate `src/lib/database.types.ts` with Stage 3 tables
    - Run `npx supabase gen types typescript --project-id <project_id> --schema public > src/lib/database.types.ts`
    - Verify `bookings` and `maintenance_requests` Row/Insert/Update shapes added to `Tables`
    - Verify `booking_status`, `maintenance_priority`, `maintenance_status` added to `Enums`
    - Keep all Stage 1 and Stage 2 types untouched
    - _Requirements: 15.4_

- [x] 3. Implement the booking service
  - [x] 3.1 Create `src/services/bookingService.ts`
    - Implement `listBookableAssets(): Promise<Asset[]>` — SELECT assets WHERE is_bookable = true
    - Implement `getTodaysBookings(assetId: string): Promise<Booking[]>` — SELECT bookings WHERE asset_id matches AND date(start_time) = current_date using .gte/.lt bracket on UTC day boundaries
    - Implement `createBooking(input: CreateBookingInput): Promise<Booking>` — INSERT into bookings with booked_by = auth.uid(); catch Supabase error where message includes `'Booking time slot overlaps with an existing reservation'` and re-throw `BookingOverlapError`
    - Implement `cancelBooking(bookingId: string): Promise<void>` — UPDATE bookings SET status = 'Cancelled' WHERE id = bookingId
    - Use strict types throughout — no `any`; destructure Supabase response into typed variables
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [ ]* 3.2 Write unit tests for `bookingService.ts`
    - Mock `src/lib/supabaseClient` with `vi.mock`
    - Test `listBookableAssets` returns only assets with is_bookable = true
    - Test `createBooking` happy path returns created `Booking`
    - Test `createBooking` throws `BookingOverlapError` when error message includes overlap text
    - Test `cancelBooking` calls UPDATE with status = 'Cancelled'
    - Test `getTodaysBookings` passes correct date range filter
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [ ]* 3.3 Write property test — P2: overlap prevention rejects conflicting bookings (fast-check)
    - **Property 2: Overlap prevention rejects conflicting non-cancelled bookings**
    - Generate arbitrary pairs of non-cancelled bookings with overlapping intervals on the same asset
    - Assert second insert/update is rejected with error message `'Booking time slot overlaps with an existing reservation'`
    - Tag comment: `// Feature: assetflow-stage3, Property 2: Overlap prevention rejects conflicting non-cancelled bookings`
    - **Validates: Requirements 3.2, 3.3**

  - [ ]* 3.4 Write property test — P3: bookable-asset filter enforced (fast-check)
    - **Property 3: Bookable-asset filter is enforced at every layer**
    - Generate arbitrary asset lists with mixed is_bookable values
    - Assert `bookingService.listBookableAssets()` returns only is_bookable = true assets
    - Tag comment: `// Feature: assetflow-stage3, Property 3: Bookable-asset filter is enforced at every layer`
    - **Validates: Requirements 7.1, 16.1**

  - [ ]* 3.5 Write property test — P4: adjacent bookings permitted (fast-check)
    - **Property 4: Adjacent bookings are permitted (half-open interval)**
    - Generate arbitrary existing booking; create new booking where start_time = existing.end_time
    - Assert overlap guard accepts the adjacent booking
    - Tag comment: `// Feature: assetflow-stage3, Property 4: Adjacent bookings are permitted (half-open interval)`
    - **Validates: Requirements 3.4**

  - [ ]* 3.6 Write property test — P5: cancelled bookings vacate the slot (fast-check)
    - **Property 5: Cancelled bookings vacate the time slot**
    - Generate arbitrary booking, set status = 'Cancelled', then create new booking with overlapping time window
    - Assert overlap guard accepts the new booking
    - Tag comment: `// Feature: assetflow-stage3, Property 5: Cancelled bookings vacate the time slot`
    - **Validates: Requirements 3.5**

  - [ ]* 3.7 Write property test — P6: overlap error propagates as typed error (fast-check)
    - **Property 6: Booking overlap error propagates as typed error**
    - Generate arbitrary `CreateBookingInput` that would overlap with existing booking
    - Assert `bookingService.createBooking()` throws instance of `BookingOverlapError` (check `err instanceof BookingOverlapError`)
    - Tag comment: `// Feature: assetflow-stage3, Property 6: Booking overlap error propagates as typed error`
    - **Validates: Requirements 8.5, 16.3**

- [x] 4. Implement the maintenance service
  - [x] 4.1 Create `src/services/maintenanceService.ts`
    - Implement `listMaintenanceRequests(): Promise<MaintenanceRequestWithDetails[]>` — SELECT maintenance_requests WHERE status != 'Rejected' JOIN assets (for tag) JOIN profiles (for requested_by_name), order by created_at DESC
    - Implement `createMaintenanceRequest(input: CreateMaintenanceRequestInput): Promise<MaintenanceRequest>` — INSERT into maintenance_requests with requested_by = auth.uid(), status defaults to 'Pending'
    - Implement `updateMaintenanceStatus(id: string, status: MaintenanceStatus, technicianName?: string): Promise<void>` — UPDATE maintenance_requests SET status, technician_name (if provided) WHERE id
    - Use strict types throughout — no `any`; destructure Supabase response into typed variables
    - _Requirements: 17.1, 17.2, 17.3_

  - [ ]* 4.2 Write unit tests for `maintenanceService.ts`
    - Mock `src/lib/supabaseClient` with `vi.mock`
    - Test `listMaintenanceRequests` excludes Rejected rows
    - Test `createMaintenanceRequest` inserts with status = 'Pending' and requested_by = auth.uid()
    - Test `updateMaintenanceStatus` updates both status and technician_name when provided
    - Test `updateMaintenanceStatus` updates only status when technician_name omitted
    - _Requirements: 17.1, 17.2, 17.3_

  - [ ]* 4.3 Write property test — P1: FK cascade deletions (fast-check)
    - **Property 1: FK cascade deletions remove all child records**
    - Generate arbitrary asset or profile with N child bookings/maintenance_requests
    - Delete parent; assert all child rows automatically deleted
    - Tag comment: `// Feature: assetflow-stage3, Property 1: FK cascade deletions remove all child records`
    - **Validates: Requirements 1.3, 1.4, 2.2, 2.3**

  - [ ]* 4.4 Write property test — P7: maintenance trigger all transitions (fast-check)
    - **Property 7: Maintenance trigger updates asset status on Approved and Resolved only**
    - Generate arbitrary maintenance_requests row; test transitions: Approved → assets.status = 'Under Maintenance', Resolved → assets.status = 'Available', Rejected (when asset Under Maintenance) → assets.status = 'Available', Rejected (when asset not Under Maintenance) → no change, other transitions → no change
    - Tag comment: `// Feature: assetflow-stage3, Property 7: Maintenance trigger updates asset status on Approved and Resolved only`
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5**

- [ ] 5. Checkpoint — services and DB layer complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Build the Resource Booking UI components
  - [x] 6.1 Create `src/components/BookableAssetSelect.tsx`
    - Props: `{ onSelect: (asset: Asset | null) => void; assets: Asset[] }`
    - Render a dropdown or typeahead listing only the provided assets (caller filters for is_bookable = true)
    - On selection emit onSelect callback with chosen asset; on clear emit onSelect(null)
    - _Requirements: 7.1, 7.2_

  - [x] 6.2 Create `src/components/BookingForm.tsx`
    - Props: `{ selectedAsset: Asset | null; onSuccess: (booking: Booking) => void }`
    - Render controlled form: Title (required text, max 255), Date (required date picker), Start Time (required time picker), End Time (required time picker)
    - Disable all fields when selectedAsset is null
    - On submit: call `bookingService.createBooking()` with asset_id, title, start_time (date + start time combined into ISO 8601), end_time
    - On success: emit onSuccess callback with new Booking, reset form
    - On `BookingOverlapError`: show inline error "This time slot is already booked.", keep form populated
    - On other errors: show inline generic error, keep form populated
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 6.3 Create `src/components/ScheduleView.tsx`
    - Props: `{ bookings: Booking[] }`
    - Render chronological list or timeline showing each booking's title, start_time, end_time
    - When bookings array is empty: render "No bookings today" empty-state message
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ]* 6.4 Write unit tests for BookableAssetSelect
    - Render with N assets; assert N options rendered
    - Simulate selection; assert onSelect called with correct asset
    - Simulate clear; assert onSelect called with null
    - _Requirements: 7.1, 7.2_

  - [ ]* 6.5 Write unit tests for BookingForm
    - Render with selectedAsset = null; assert all fields disabled
    - Render with selectedAsset; assert fields enabled
    - Submit valid form; assert `bookingService.createBooking` called with correct payload
    - Simulate `BookingOverlapError`; assert inline error "This time slot is already booked." shown, form stays populated
    - Simulate generic error; assert inline generic error shown, form stays populated
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 6.6 Write unit tests for ScheduleView
    - Render with empty array; assert "No bookings today" shown
    - Render with N bookings; assert N items rendered, each showing title, start_time, end_time
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ]* 6.7 Write property test — P10: schedule view renders all items with required fields (fast-check)
    - **Property 10: Schedule view renders all of today's bookings with required fields**
    - Generate arbitrary Booking[] arrays (including empty)
    - Assert count matches, each item has title/start/end, empty array shows empty state
    - Tag comment: `// Feature: assetflow-stage3, Property 10: Schedule view renders all of today's bookings with required fields`
    - **Validates: Requirements 9.1, 9.3**

- [x] 7. Build Screen 6 — Resource Booking page
  - [x] 7.1 Create `src/pages/ResourceBooking.tsx`
    - On mount: call `bookingService.listBookableAssets()` and store in state
    - State: `selectedAsset: Asset | null`, `todaysBookings: Booking[]`
    - Render `BookableAssetSelect` with fetched bookable assets; on selection update selectedAsset state
    - When selectedAsset changes: call `bookingService.getTodaysBookings(selectedAsset.id)` and update todaysBookings
    - Render `BookingForm` with selectedAsset and onSuccess callback; on success append new booking to todaysBookings without full refetch
    - Render `ScheduleView` with todaysBookings array
    - When no asset selected: show "Please select an asset to view booking options"
    - _Requirements: 7, 8, 9_

  - [ ]* 7.2 Write unit tests for ResourceBooking page
    - Mock `bookingService.listBookableAssets` to return mock assets
    - Assert BookableAssetSelect rendered with mock assets
    - Simulate asset selection; assert `bookingService.getTodaysBookings` called
    - Assert ScheduleView receives todaysBookings
    - Simulate booking success; assert new booking appears in ScheduleView without page reload
    - _Requirements: 7, 8, 9_

- [x] 8. Build the Maintenance Kanban UI components
  - [x] 8.1 Create `src/utils/roleUtils.ts` (or extend existing utils)
    - Export `isAssetManager(role: UserRole): boolean` — returns `role === 'Admin' || role === 'Asset Manager'`
    - _Requirements: 12.1, 12.9_

  - [x] 8.2 Create `src/components/MaintenanceCard.tsx`
    - Props: `{ request: MaintenanceRequestWithDetails; currentUserRole: UserRole; onStatusChange: (id: string, status: MaintenanceStatus, technicianName?: string) => void }`
    - Render card showing: asset_tag, issue_description, priority (colour-coded badge: Low = green/grey, Medium = yellow/amber, High = red/orange), requested_by_name
    - Render action buttons only when `isAssetManager(currentUserRole)` is true:
      - Pending status: "Approve" button, "Reject" button
      - Approved status: "Start Work" button, optional technician_name text input
      - In Progress status: "Resolve" button
      - Resolved status: no buttons
    - On button click: call onStatusChange with new status and technician_name (if provided)
    - _Requirements: 11.1, 11.2, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9_

  - [x] 8.3 Create `src/components/KanbanColumn.tsx`
    - Props: `{ title: string; requests: MaintenanceRequestWithDetails[]; currentUserRole: UserRole; onStatusChange: (id: string, status: MaintenanceStatus, technicianName?: string) => void }`
    - Render column with title header and list of MaintenanceCard components
    - Pass through currentUserRole and onStatusChange to each card
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 8.4 Create `src/components/RaiseRequestModal.tsx`
    - Props: `{ isOpen: boolean; onClose: () => void; onSuccess: (request: MaintenanceRequest) => void; assets: Asset[] }`
    - Render modal with: Asset selector (all assets), issue_description textarea (required), Priority selector (Low/Medium/High, default Medium)
    - On submit: call `maintenanceService.createMaintenanceRequest()`
    - On success: emit onSuccess callback with new request, close modal
    - On error: show inline error in modal, keep modal open with user's input preserved
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [ ]* 8.5 Write unit tests for MaintenanceCard
    - Render with role 'Asset Manager' and status 'Pending'; assert Approve and Reject buttons present
    - Render with role 'Employee' and status 'Pending'; assert no action buttons present
    - Render with role 'Admin' and status 'Approved'; assert Start Work button present
    - Render with role 'Asset Manager' and status 'In Progress'; assert Resolve button present
    - Render with role 'Asset Manager' and status 'Resolved'; assert no action buttons present
    - Simulate button click; assert onStatusChange called with correct parameters
    - _Requirements: 11.1, 11.2, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9_

  - [ ]* 8.6 Write unit tests for KanbanColumn
    - Render with N requests; assert N MaintenanceCard components rendered
    - Assert title header matches props.title
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 8.7 Write unit tests for RaiseRequestModal
    - Render modal; assert Asset selector, issue_description textarea, Priority selector present
    - Submit valid form; assert `maintenanceService.createMaintenanceRequest` called with correct payload
    - Simulate success; assert onSuccess called, modal closed
    - Simulate error; assert inline error shown, modal stays open with input preserved
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [ ]* 8.8 Write property test — P9: action button visibility is role-gated (fast-check)
    - **Property 9: Action button visibility is role-gated**
    - Generate arbitrary MaintenanceRequestWithDetails and UserRole combinations
    - Assert action buttons present iff role ∈ {'Admin', 'Asset Manager'}; absent for 'Employee' and 'Department Head'
    - Tag comment: `// Feature: assetflow-stage3, Property 9: Action button visibility is role-gated`
    - **Validates: Requirements 12.1, 12.9**

- [x] 9. Build Screen 7 — Maintenance Board page
  - [x] 9.1 Create `src/pages/MaintenanceBoard.tsx`
    - On mount: call `maintenanceService.listMaintenanceRequests()` and `authService.getCurrentUserRole()` in parallel
    - State: `requests: MaintenanceRequestWithDetails[]`, `currentUserRole: UserRole`, `assets: Asset[]`
    - Derive four arrays by filtering requests on status: Pending, Approved, In Progress, Resolved (exclude Rejected)
    - Render CSS Grid layout with 4 columns (grid-template-columns: repeat(4, 1fr))
    - Render KanbanColumn for each column with filtered array
    - Render persistent "Raise Request" button or FAB visible to all authenticated users
    - On "Raise Request" click: open RaiseRequestModal; on success prepend new request to local state (it will be Pending)
    - On status change: re-fetch `maintenanceService.listMaintenanceRequests()` to get updated state
    - _Requirements: 10, 11, 12, 13_

  - [ ]* 9.2 Write unit tests for MaintenanceBoard page
    - Mock `maintenanceService.listMaintenanceRequests` to return mock requests with mixed statuses including Rejected
    - Assert 4 KanbanColumn components rendered
    - Assert each column receives correctly filtered requests (no Rejected in any column)
    - Assert "Raise Request" button visible
    - Simulate "Raise Request" success; assert new request appears in Pending column without page reload
    - Simulate status change; assert `maintenanceService.listMaintenanceRequests` called to refresh
    - _Requirements: 10, 11, 12, 13_

  - [ ]* 9.3 Write property test — P8: Kanban board shows each non-rejected in exactly one column (fast-check)
    - **Property 8: Kanban board shows each non-rejected request in exactly one column**
    - Generate arbitrary MaintenanceRequestWithDetails[] including some with status = 'Rejected'
    - Assert zero cards for rejected requests, each non-rejected appears exactly once in its column
    - Tag comment: `// Feature: assetflow-stage3, Property 8: Kanban board shows each non-rejected request in exactly one column`
    - **Validates: Requirements 10.2, 10.4, 10.5**

- [x] 10. Wire routes and navigation into App.tsx
  - [ ] 10.1 Add Stage 3 routes to `src/App.tsx`
    - Import `ResourceBooking` from `./pages/ResourceBooking`
    - Import `MaintenanceBoard` from `./pages/MaintenanceBoard`
    - Add `<Route path="/bookings" element={<ResourceBooking />} />` — auth required, all roles
    - Add `<Route path="/maintenance" element={<MaintenanceBoard />} />` — auth required, all roles
    - Add navigation links to these pages from the Dashboard so authenticated users can reach them
    - _Requirements: 18.1, 18.2, 18.3_

  - [ ]* 10.2 Write unit tests for route wiring
    - Assert `/bookings` renders `ResourceBooking` (not a redirect)
    - Assert `/maintenance` renders `MaintenanceBoard` (not a redirect)
    - _Requirements: 18.1, 18.2_

- [ ] 11. Final checkpoint — Ensure all tests pass
  - Run `npm run test` and confirm all unit and property tests pass
  - Paste `supabase/migration_stage3_booking_maintenance.sql` into Supabase Dashboard → SQL Editor and confirm it runs without errors
  - Verify `prevent_booking_overlap()` and `sync_maintenance_status()` triggers are visible in Supabase Dashboard
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery
- Each task references specific requirements for traceability
- DB-backed property tests (P1–P7) require a Supabase test project or local Supabase instance; UI property tests (P8–P10) run in jsdom with mocked services
- The `prevent_booking_overlap()` BEFORE trigger is the canonical overlap guard — trust the DB, not the application layer
- The `sync_maintenance_status()` AFTER trigger follows the exact same pattern as Stage 2's `sync_asset_status()`
- Migration file is additive only; Stage 1 objects (`schema.sql`) and Stage 2 objects (`migration_stage2_assets_allocation.sql`) are never touched
- Kanban board uses CSS Grid with 4 fixed columns — no drag-and-drop; state transitions via click buttons only
- Rejected maintenance tickets are filtered out at the service layer (`WHERE status != 'Rejected'`) and never appear on the board

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1", "4.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "4.2", "4.3", "4.4"] },
    { "id": 4, "tasks": ["6.1", "6.2", "6.3", "8.1", "8.2", "8.3", "8.4"] },
    { "id": 5, "tasks": ["6.4", "6.5", "6.6", "6.7", "8.5", "8.6", "8.7", "8.8"] },
    { "id": 6, "tasks": ["7.1", "9.1"] },
    { "id": 7, "tasks": ["7.2", "9.2", "9.3"] },
    { "id": 8, "tasks": ["10.1"] },
    { "id": 9, "tasks": ["10.2"] }
  ]
}
```
