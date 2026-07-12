# Requirements Document

## Introduction

AssetFlow Stage 3 extends the existing asset management platform with two specialized operational workflows: **Resource Booking** (Screen 6) and **Maintenance Management** (Screen 7).

Resource Booking allows any authenticated employee to reserve shared assets (conference rooms, vehicles, projectors) for specific time windows. Overlap prevention is enforced at the PostgreSQL level via a BEFORE trigger, making race-condition double-bookings impossible regardless of how many users act simultaneously.

Maintenance Management provides a simplified CSS Grid Kanban board (no drag-and-drop) where any employee can raise a repair ticket, and Admin/Asset Manager roles can drive tickets through an approval workflow using click-to-move action buttons. A PostgreSQL AFTER trigger automatically synchronises the parent asset's status whenever a ticket is approved or resolved.

All database changes are additive only — they go into a new migration file `supabase/migration_stage3_booking_maintenance.sql` and never touch `supabase/schema.sql` or the Stage 2 migration.

---

## Glossary

- **Booking_System**: The React + Supabase subsystem responsible for creating, reading, and cancelling time-slot reservations on bookable assets (Screen 6).
- **Maintenance_System**: The React + Supabase subsystem responsible for managing repair tickets via a Kanban-style board (Screen 7).
- **Booking**: A row in the `bookings` table representing a reserved time window for a specific asset by a specific user.
- **Maintenance_Request**: A row in the `maintenance_requests` table representing a reported issue on an asset.
- **Bookable_Asset**: An asset row where `is_bookable = true`.
- **Overlap**: A condition where two bookings on the same asset have intersecting time intervals and neither is `Cancelled`.
- **Overlap_Guard**: The PostgreSQL function `prevent_booking_overlap()` that runs BEFORE INSERT OR UPDATE on `bookings` and raises an exception on overlap.
- **Maintenance_Sync_Trigger**: The PostgreSQL function `sync_maintenance_status()` that runs AFTER UPDATE on `maintenance_requests` and updates the parent asset's status.
- **Kanban_Board**: The CSS Grid layout on Screen 7 with four fixed columns: Pending, Approved, In Progress, Resolved. Rejected tickets are filtered out of the UI entirely.
- **Authenticated_User**: Any user with a valid Supabase session (`auth.role() = 'authenticated'`).
- **Admin**: A profile where `role = 'Admin'`. Identified by the existing `is_admin()` SECURITY DEFINER function.
- **Asset_Manager**: A profile where `role IN ('Admin', 'Asset Manager')`. Identified by the existing `is_asset_manager()` SECURITY DEFINER function.
- **Booking_Status**: The enum `('Upcoming', 'Ongoing', 'Completed', 'Cancelled')` stored on each Booking.
- **Maintenance_Status**: The enum `('Pending', 'Approved', 'In Progress', 'Resolved', 'Rejected')` stored on each Maintenance_Request.
- **FAB**: Floating Action Button — a persistent UI element that opens the "Raise Request" modal on Screen 7.
- **Schedule_View**: The daily list or timeline rendered below the booking form on Screen 6, showing existing bookings for the selected Bookable_Asset.

---

## Requirements

### Requirement 1: Database Schema — Bookings Table

**User Story:** As a database administrator, I want a well-constrained `bookings` table, so that time-slot reservation data is stored with referential integrity and sensible defaults.

#### Acceptance Criteria

1. THE Booking_System SHALL store each Booking in a `bookings` table with columns: `id` (UUID, primary key, auto-generated), `asset_id` (UUID, NOT NULL, FK → `assets.id` ON DELETE CASCADE), `booked_by` (UUID, NOT NULL, FK → `profiles.id` ON DELETE CASCADE), `title` (Text, NOT NULL), `start_time` (Timestamptz, NOT NULL), `end_time` (Timestamptz, NOT NULL), `status` (Booking_Status enum, NOT NULL, default `'Upcoming'`).
2. THE Booking_System SHALL enforce a CHECK constraint on `bookings` such that `start_time < end_time` for every row.
3. WHEN a parent asset row is deleted, THE Booking_System SHALL cascade the deletion to all child Booking rows for that asset.
4. WHEN a parent profile row is deleted, THE Booking_System SHALL cascade the deletion to all Booking rows where `booked_by` matches that profile.

---

### Requirement 2: Database Schema — Maintenance Requests Table

**User Story:** As a database administrator, I want a well-constrained `maintenance_requests` table, so that repair ticket data is stored with referential integrity and audit timestamps.

#### Acceptance Criteria

1. THE Maintenance_System SHALL store each Maintenance_Request in a `maintenance_requests` table with columns: `id` (UUID, primary key, auto-generated), `asset_id` (UUID, NOT NULL, FK → `assets.id` ON DELETE CASCADE), `requested_by` (UUID, NOT NULL, FK → `profiles.id` ON DELETE CASCADE), `issue_description` (Text, NOT NULL), `priority` (enum `('Low', 'Medium', 'High')`, NOT NULL, default `'Medium'`), `status` (Maintenance_Status enum, NOT NULL, default `'Pending'`), `technician_name` (Text, Nullable), `created_at` (Timestamptz, NOT NULL, default `now()`).
2. WHEN a parent asset row is deleted, THE Maintenance_System SHALL cascade the deletion to all child Maintenance_Request rows for that asset.
3. WHEN a parent profile row is deleted, THE Maintenance_System SHALL cascade the deletion to all Maintenance_Request rows where `requested_by` matches that profile.

---

### Requirement 3: Overlap Prevention Trigger

**User Story:** As an employee, I want the system to prevent double-booking of a shared asset, so that I can trust my reservation will not be overwritten by a concurrent user.

#### Acceptance Criteria

1. THE Booking_System SHALL include a PostgreSQL trigger function `prevent_booking_overlap()` that executes BEFORE INSERT OR UPDATE on the `bookings` table.
2. WHEN a new or updated Booking is inserted, THE Overlap_Guard SHALL query for any existing Booking row where `asset_id` matches AND `status != 'Cancelled'` (checking against any booking that is not cancelled) AND `(NEW.start_time < existing.end_time AND NEW.end_time > existing.start_time)`.
3. IF the Overlap_Guard finds a matching conflicting row, THEN THE Overlap_Guard SHALL raise a PostgreSQL exception with the message `'Booking time slot overlaps with an existing reservation'`, aborting the transaction.
4. WHEN two Bookings on the same asset are adjacent (i.e., one ends exactly when the other begins), THE Overlap_Guard SHALL permit both Bookings without raising an exception.
5. WHEN a Booking has `status = 'Cancelled'`, THE Overlap_Guard SHALL exclude that Booking from overlap checks, permitting another Booking to occupy the same time window.

---

### Requirement 4: Maintenance Status Sync Trigger

**User Story:** As an asset manager, I want the asset's master status to update automatically when a maintenance ticket changes state, so that the Asset Directory always reflects whether an asset is under repair.

#### Acceptance Criteria

1. THE Maintenance_System SHALL include a PostgreSQL trigger function `sync_maintenance_status()` that executes AFTER UPDATE on the `maintenance_requests` table FOR EACH ROW.
2. WHEN a Maintenance_Request `status` is updated to `'Approved'`, THE Maintenance_Sync_Trigger SHALL update the `assets.status` column for the corresponding `asset_id` to `'Under Maintenance'`.
3. WHEN a Maintenance_Request `status` is updated to `'Resolved'`, THE Maintenance_Sync_Trigger SHALL update the `assets.status` column for the corresponding `asset_id` to `'Available'`. (Note: This design intentionally does not restore a prior `'Allocated'` state. If an asset was allocated to an employee before going under maintenance, resolving the ticket will set it to `'Available'`, effectively de-allocating it. This is a known simplification for the hackathon timeline.)
4. WHEN a Maintenance_Request `status` changes to any value other than `'Approved'` or `'Resolved'`, THE Maintenance_Sync_Trigger SHALL leave `assets.status` unchanged.
5. WHEN a Maintenance_Request `status` is updated to `'Rejected'` while the corresponding asset has `status = 'Under Maintenance'`, THE Maintenance_Sync_Trigger SHALL update `assets.status` to `'Available'`.

---

### Requirement 5: Row-Level Security — Bookings Table

**User Story:** As a system administrator, I want RLS policies on the `bookings` table, so that only authorised users can read, create, or cancel reservations.

#### Acceptance Criteria

1. THE Booking_System SHALL enable Row Level Security on the `bookings` table.
2. WHILE a user is Authenticated_User, THE Booking_System SHALL permit that user to SELECT all rows in `bookings`.
3. WHEN an Authenticated_User attempts to INSERT a Booking, THE Booking_System SHALL permit the insert only if the corresponding asset has `is_bookable = true`.
4. WHEN an Authenticated_User attempts to UPDATE a Booking row, THE Booking_System SHALL permit the update only if `booked_by = auth.uid()` OR `is_admin()` returns true.
5. THE Booking_System SHALL deny DELETE operations on `bookings` for all users.

---

### Requirement 6: Row-Level Security — Maintenance Requests Table

**User Story:** As a system administrator, I want RLS policies on the `maintenance_requests` table, so that any employee can raise tickets but only Asset_Manager roles can change ticket status.

#### Acceptance Criteria

1. THE Maintenance_System SHALL enable Row Level Security on the `maintenance_requests` table.
2. WHILE a user is Authenticated_User, THE Maintenance_System SHALL permit that user to SELECT all rows in `maintenance_requests`.
3. WHEN an Authenticated_User attempts to INSERT a Maintenance_Request, THE Maintenance_System SHALL permit the insert without additional role restrictions.
4. WHEN a user attempts to UPDATE a Maintenance_Request row, THE Maintenance_System SHALL permit the update only if `is_asset_manager()` returns true.
5. THE Maintenance_System SHALL deny DELETE operations on `maintenance_requests` for all users.

---

### Requirement 7: Resource Booking UI — Bookable Asset Selector

**User Story:** As an employee, I want to select only bookable assets from a dropdown or typeahead, so that I cannot accidentally attempt to book an asset that is not shareable.

#### Acceptance Criteria

1. THE Booking_System SHALL render a resource selector component on Screen 6 that lists only assets where `is_bookable = true`.
2. WHEN the resource selector is opened, THE Booking_System SHALL fetch the list of Bookable_Assets from Supabase and populate the selector options with each asset's name and tag; IF the fetch fails, THE Booking_System SHALL render the selector in an empty state without displaying an error.
3. WHEN no Bookable_Asset is selected, THE Booking_System SHALL display the booking form fields in a disabled or greyed-out state and SHALL NOT render the Schedule_View.

---

### Requirement 8: Resource Booking UI — Booking Form

**User Story:** As an employee, I want a booking form with title, date, start time, and end time fields, so that I can provide all information needed to create a reservation.

#### Acceptance Criteria

1. THE Booking_System SHALL render a booking form containing: a Title text field (required), a Date picker (required), a Start Time picker (required), and an End Time picker (required).
2. THE Booking_System SHALL render a "Confirm Booking" submit button on the booking form.
3. WHEN the "Confirm Booking" button is clicked with all required fields populated, THE Booking_System SHALL submit an INSERT to the `bookings` table with `asset_id`, `booked_by` (from `auth.uid()`), `title`, `start_time`, and `end_time`.
4. WHEN the booking submission succeeds, THE Booking_System SHALL refresh the Schedule_View to include the newly created Booking.
5. IF the `bookings` INSERT is rejected by the Overlap_Guard, THEN THE Booking_System SHALL display an inline error message: "This time slot is already booked."
6. IF the `bookings` INSERT fails for any reason other than overlap, THEN THE Booking_System SHALL display an inline generic error message for all non-overlap booking failures and SHALL keep the form populated with the user's input.

---

### Requirement 9: Resource Booking UI — Schedule View

**User Story:** As an employee, I want to see today's existing bookings for the selected asset below the form, so that I can identify available time windows before submitting my request.

#### Acceptance Criteria

1. WHEN a Bookable_Asset is selected, THE Booking_System SHALL render a Schedule_View below the booking form showing all Bookings for the selected asset where the date portion of `start_time` equals today's date.
2. WHEN a Bookable_Asset with no bookings for today is selected, THE Booking_System SHALL immediately display a "No bookings today" or equivalent empty-state message in the Schedule_View without waiting for a secondary fetch.
3. THE Booking_System SHALL display each Booking in the Schedule_View with at minimum the booking title, start time, and end time.
4. WHEN a new Booking is successfully created, THE Booking_System SHALL update the Schedule_View without requiring a full page reload.

---

### Requirement 10: Maintenance Kanban Board Layout

**User Story:** As an employee or asset manager, I want to see all maintenance requests organised by status on a Kanban board, so that I can quickly understand the repair pipeline at a glance.

#### Acceptance Criteria

1. THE Maintenance_System SHALL render Screen 7 as a CSS Grid layout with exactly 4 columns labelled: **Pending**, **Approved**, **In Progress**, and **Resolved**.
2. THE Maintenance_System SHALL place each Maintenance_Request card in the column corresponding to its current `status` value.
3. THE Maintenance_System SHALL NOT implement drag-and-drop functionality; all state transitions SHALL be performed via action buttons on each card.
4. WHEN the Maintenance_System loads Screen 7, THE Maintenance_System SHALL fetch all Maintenance_Request rows from Supabase WHERE `status != 'Rejected'` and distribute them across the columns.
5. THE Maintenance_System SHALL NOT display Maintenance_Request rows with `status = 'Rejected'` on the Kanban board.

---

### Requirement 11: Maintenance Card Content

**User Story:** As an employee, I want each maintenance card to show the asset tag, issue description, priority, and requester, so that I can identify what needs repair and how urgent it is.

#### Acceptance Criteria

1. THE Maintenance_System SHALL render each Maintenance_Request as a card displaying: the Asset Tag of the associated asset, the `issue_description`, the `priority` value, and the `requested_by` user's name (joined from `profiles.full_name`).
2. THE Maintenance_System SHALL colour-code the `priority` badge on each card: Low in a visually distinct low-urgency colour (e.g., green or grey), Medium in a mid-urgency colour (e.g., yellow or amber), High in a high-urgency colour (e.g., red or orange); IF the specified priority colour fails to render, THE Maintenance_System SHALL use a default colour as fallback.

---

### Requirement 12: Maintenance State Transitions — Admin/Asset Manager Actions

**User Story:** As an asset manager, I want action buttons on maintenance cards, so that I can move tickets through the approval workflow without navigating to a separate detail page.

#### Acceptance Criteria

1. WHILE the current user is an Asset_Manager, THE Maintenance_System SHALL render action buttons on each card according to the card's current `status`.
2. WHEN a card is in the **Pending** column, THE Maintenance_System SHALL render an "Approve" button and a "Reject" button on that card.
3. WHEN a card is in the **Approved** column, THE Maintenance_System SHALL render a "Start Work" button and an optional `technician_name` text input on that card.
4. WHEN a card is in the **In Progress** column, THE Maintenance_System SHALL render a "Resolve" button on that card.
5. WHEN an Asset_Manager clicks "Approve" on a Pending card, THE Maintenance_System SHALL update the `maintenance_requests.status` to `'Approved'` and move the card to the Approved column.
6. WHEN an Asset_Manager clicks "Reject" on a Pending card, THE Maintenance_System SHALL update the `maintenance_requests.status` to `'Rejected'` and remove the card from the board.
7. WHEN an Asset_Manager clicks "Start Work" on an Approved card, THE Maintenance_System SHALL update the `maintenance_requests.status` to `'In Progress'` (and persist `technician_name` if entered) and move the card to the In Progress column.
8. WHEN an Asset_Manager clicks "Resolve" on an In Progress card, THE Maintenance_System SHALL update the `maintenance_requests.status` to `'Resolved'` and move the card to the Resolved column.
9. WHILE the current user is NOT an Asset_Manager, THE Maintenance_System SHALL NOT render any state-transition action buttons on maintenance cards.

---

### Requirement 13: Raise Maintenance Request Modal

**User Story:** As an employee, I want a "Raise Request" button available on Screen 7, so that I can report a new asset issue without leaving the Kanban board.

#### Acceptance Criteria

1. THE Maintenance_System SHALL render a persistent "Raise Request" button or FAB on Screen 7 visible to all Authenticated_User roles.
2. WHEN the "Raise Request" button is clicked, THE Maintenance_System SHALL open a modal containing: an Asset selector (showing all assets), an `issue_description` textarea (required), and a Priority selector (Low / Medium / High, default Medium).
3. WHEN the modal form is submitted with all required fields, THE Maintenance_System SHALL INSERT a new Maintenance_Request row with `requested_by = auth.uid()` and `status = 'Pending'`.
4. WHEN the INSERT succeeds, THE Maintenance_System SHALL close the modal and add the new card to the Pending column without requiring a full page reload.
5. IF the INSERT fails, THEN THE Maintenance_System SHALL display an inline error message within the modal and SHALL keep the modal open with the user's input preserved.
6. WHEN the form is submitted and no database operation occurs (neither success nor failure), THE Maintenance_System SHALL keep the modal open indefinitely until a clear success or failure occurs.

---

### Requirement 14: Database Migration File

**User Story:** As a developer, I want all Stage 3 schema changes isolated in a single migration file, so that the Stage 1 and Stage 2 schemas remain untouched and the migration can be applied or rolled back independently.

#### Acceptance Criteria

1. THE Booking_System SHALL deliver all Stage 3 database objects (tables, enums, triggers, functions, RLS policies) in a new file `supabase/migration_stage3_booking_maintenance.sql`.
2. THE Booking_System SHALL NOT modify `supabase/schema.sql` or `supabase/migration_stage2_assets_allocation.sql`.
3. THE Booking_System SHALL include commented rollback statements at the bottom of the migration file for manual recovery.
4. WHEN the migration file is executed against a Supabase project that already has Stages 1 and 2 applied, THE Booking_System SHALL complete without errors.
5. WHEN the migration file is executed against a Supabase project that does NOT have Stages 1 and 2 applied, THE Booking_System SHALL fail with an error indicating missing prerequisites.

---

### Requirement 15: TypeScript Types for Stage 3

**User Story:** As a developer, I want TypeScript types for the new database tables and enums, so that the service layer and UI components are fully type-safe with zero `any` usages.

#### Acceptance Criteria

1. THE Booking_System SHALL add `BookingStatus` (`'Upcoming' | 'Ongoing' | 'Completed' | 'Cancelled'`) and `MaintenancePriority` (`'Low' | 'Medium' | 'High'`) and `MaintenanceStatus` (`'Pending' | 'Approved' | 'In Progress' | 'Resolved' | 'Rejected'`) union types to `src/types/index.ts`.
2. THE Booking_System SHALL add `Booking` and `BookingWithAsset` interface types to `src/types/index.ts`.
3. THE Maintenance_System SHALL add `MaintenanceRequest` and `MaintenanceRequestWithDetails` interface types to `src/types/index.ts`.
4. THE developer SHALL regenerate `src/lib/database.types.ts` by running the Supabase CLI command `supabase gen types typescript --project-id <project_id> > src/lib/database.types.ts` after applying the Stage 3 migration, which will automatically include the `bookings` and `maintenance_requests` Row/Insert/Update shapes and the new enums.
5. THE Booking_System SHALL extend `src/types/index.ts` with `CreateBookingInput` and `CreateMaintenanceRequestInput` service input types.
6. THE Booking_System SHALL add a `BookingOverlapError` typed error class (extends `Error`, sets `this.name`) to `src/types/index.ts` for use when the Overlap_Guard fires.

---

### Requirement 16: Booking Service Layer

**User Story:** As a developer, I want a `bookingService.ts` module, so that all Supabase interactions for the bookings table are encapsulated and testable independently of UI components.

#### Acceptance Criteria

1. THE Booking_System SHALL expose `listBookableAssets(): Promise<Asset[]>` that SELECTs assets WHERE `is_bookable = true`.
2. THE Booking_System SHALL expose `getTodaysBookings(assetId: string): Promise<Booking[]>` that SELECTs Bookings for the given asset where the date portion of `start_time` equals today.
3. THE Booking_System SHALL expose `createBooking(input: CreateBookingInput): Promise<Booking>` that INSERTs a row into `bookings`; WHEN the Supabase error message contains `'Booking time slot overlaps with an existing reservation'`, THE Booking_System SHALL re-throw a `BookingOverlapError`.
4. THE Booking_System SHALL expose `cancelBooking(bookingId: string): Promise<void>` that UPDATEs `bookings.status` to `'Cancelled'` for the given id.

---

### Requirement 17: Maintenance Service Layer

**User Story:** As a developer, I want a `maintenanceService.ts` module, so that all Supabase interactions for the maintenance_requests table are encapsulated and testable independently of UI components.

#### Acceptance Criteria

1. THE Maintenance_System SHALL expose `listMaintenanceRequests(): Promise<MaintenanceRequestWithDetails[]>` that SELECTs all `maintenance_requests` rows WHERE `status != 'Rejected'` joined with `assets` (for tag) and `profiles` (for `requested_by` name), ordered by `created_at` DESC.
2. THE Maintenance_System SHALL expose `createMaintenanceRequest(input: CreateMaintenanceRequestInput): Promise<MaintenanceRequest>` that INSERTs a row into `maintenance_requests`.
3. THE Maintenance_System SHALL expose `updateMaintenanceStatus(id: string, status: MaintenanceStatus, technicianName?: string): Promise<void>` that UPDATEs `maintenance_requests.status` (and optionally `technician_name`) for the given id.

---

### Requirement 18: Routing & Navigation

**User Story:** As an employee, I want Screen 6 and Screen 7 accessible from the Dashboard navigation, so that I can reach the booking and maintenance workflows without editing the URL manually.

#### Acceptance Criteria

1. THE Booking_System SHALL add a route `/bookings` to `src/App.tsx` that renders Screen 6, accessible to all Authenticated_User roles.
2. THE Maintenance_System SHALL add a route `/maintenance` to `src/App.tsx` that renders Screen 7, accessible to all Authenticated_User roles.
3. THE Booking_System SHALL add navigation links to Screen 6 and Screen 7 from the Dashboard so that all Authenticated_User roles can reach both screens.
