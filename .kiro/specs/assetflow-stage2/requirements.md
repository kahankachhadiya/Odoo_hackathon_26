# Requirements Document

## Introduction

AssetFlow Stage 2 builds upon the foundational infrastructure established in Stage 1 by introducing the core asset management functionality. This stage implements the asset registration system, allocation engine with strict double-allocation prevention, and transfer request system. The system must integrate seamlessly with the existing Supabase database schema, authentication, and RBAC system while extending the database with new tables for assets, allocations, and transfer requests. All database-level integrity constraints must be enforced via partial unique indexes and triggers to prevent data corruption regardless of frontend behavior.

## Glossary

- **System**: The AssetFlow application extending Stage 1 infrastructure.
- **Database**: The existing Supabase PostgreSQL database with Stage 1 tables (profiles, departments, asset_categories) plus new Stage 2 tables.
- **Asset_Manager**: A user with role 'Asset Manager' or 'Admin' who can register and allocate assets.
- **Asset_Tag_Sequence**: A PostgreSQL sequence (asset_tag_seq) that auto-generates sequential asset tags.
- **Asset**: A physical item tracked in the assets table with unique tag, category assignment, and status.
- **Allocation**: An active or historical assignment of an asset to a user, tracked in the allocations table.
- **Conflict_Rule**: The database constraint preventing multiple active allocations for the same asset.
- **Transfer_Request**: A formal request to reassign an allocated asset to a different user.
- **Screen_4**: Asset Registration & Directory page for managing inventory.
- **Screen_5**: Allocation & Transfer page for asset assignments.
- **Partial_Unique_Index**: Database index ensuring only one active allocation per asset.
- **Status_Sync_Trigger**: Database trigger automatically updating asset status based on allocation state.

## Requirements

### Requirement 1: Database Schema — Asset Tag Sequence

**User Story:** As a system architect, I want automatic asset tag generation, so that every asset receives a unique, human-readable identifier without manual coordination.

#### Acceptance Criteria

1. THE Database SHALL contain a sequence named `asset_tag_seq` starting at 1 with increment 1
2. THE Database SHALL generate asset tags with format 'AF-' followed by a zero-padded 4-digit number from the sequence
3. WHEN a new asset is registered, THE Database SHALL automatically assign the next sequential tag (e.g., AF-0001, AF-0002, AF-0003)
4. THE Database SHALL ensure asset tags remain unique across all assets regardless of deletion or gaps in the sequence

### Requirement 2: Database Schema — Assets Table

**User Story:** As an Asset Manager, I want a complete asset registry with category classification and status tracking, so that I can maintain an accurate inventory of all organizational assets.

#### Acceptance Criteria

1. THE Database SHALL contain an `assets` table with columns: `id` (UUID, Primary Key, auto-generated), `tag` (Text, Unique, NOT NULL, auto-generated from sequence), `name` (Text, NOT NULL, max 255 characters), `category_id` (UUID, Foreign Key, NOT NULL, references asset_categories.id), `serial_number` (Text, Nullable, Unique when not NULL), `status` (Enum, NOT NULL), `condition` (Text, Nullable, max 255 characters), `location` (Text, Nullable, max 255 characters), `is_bookable` (Boolean, NOT NULL), and `created_at` (Timestamp, NOT NULL, default now())
2. THE Database SHALL enforce a default value for `tag` using 'AF-' || LPAD(nextval('asset_tag_seq')::TEXT, 4, '0')
3. THE Database SHALL enforce allowed values for `status`: 'Available', 'Allocated', 'Reserved', 'Under Maintenance', 'Lost', 'Retired', 'Disposed' with default 'Available'
4. THE Database SHALL enforce a default value of false for `is_bookable`
5. THE Database SHALL allow `serial_number` to be NULL but enforce uniqueness when a value is provided
6. THE Database SHALL prevent deletion of asset_categories referenced by existing assets via foreign key constraint

### Requirement 3: Database Schema — Allocations Table

**User Story:** As an auditor, I want complete allocation history and current assignments, so that I can track asset custody and maintain accountability.

#### Acceptance Criteria

1. THE Database SHALL contain an `allocations` table with columns: `id` (UUID, Primary Key, auto-generated), `asset_id` (UUID, Foreign Key, NOT NULL, references assets.id ON DELETE RESTRICT), `assigned_to` (UUID, Foreign Key, NOT NULL, references profiles.id ON DELETE RESTRICT), `assigned_by` (UUID, Foreign Key, NOT NULL, references profiles.id ON DELETE RESTRICT), `expected_return_date` (Date, Nullable), `returned_at` (Timestamp, Nullable), and `return_condition` (Text, Nullable)
2. THE Database SHALL enforce ON DELETE RESTRICT for all foreign key constraints on the allocations table to preserve audit trail
3. THE Database SHALL allow `expected_return_date`, `returned_at`, and `return_condition` to be NULL
4. WHEN `returned_at` is NULL, THE Database SHALL consider the allocation active (asset is currently assigned)
5. WHEN `returned_at` is populated with a timestamp, THE Database SHALL consider the allocation returned (asset was returned at that time)

### Requirement 4: Database Schema — Transfer Requests Table

**User Story:** As an employee, I want to request transfer of allocated assets, so that I can obtain assets currently assigned to other users when needed.

#### Acceptance Criteria

1. THE Database SHALL contain a `transfer_requests` table with columns: `id` (UUID, Primary Key, auto-generated), `asset_id` (UUID, Foreign Key, NOT NULL, references assets.id ON DELETE CASCADE), `requested_by` (UUID, Foreign Key, NOT NULL, references profiles.id ON DELETE CASCADE), `current_holder` (UUID, Foreign Key, NOT NULL, references profiles.id ON DELETE CASCADE), `reason` (Text, NOT NULL, max 1000 characters), `status` (Enum, NOT NULL), and `created_at` (Timestamp, NOT NULL, default now())
2. THE Database SHALL enforce allowed values for `status`: 'Pending', 'Approved', 'Rejected' with default 'Pending'
3. THE Database SHALL enforce that `reason` cannot be empty or whitespace-only
4. THE Database SHALL cascade delete transfer requests when referenced assets or users are deleted

### Requirement 5: Conflict Rule — Partial Unique Index

**User Story:** As a system architect, I want database-level prevention of double allocation, so that the system cannot create conflicting asset assignments regardless of application logic errors.

#### Acceptance Criteria

1. THE Database SHALL create a partial unique index named `only_one_active_allocation` on the allocations table covering `asset_id` WHERE `returned_at IS NULL`
2. IF an INSERT or UPDATE on the allocations table would create a second active allocation for the same asset_id, THEN THE Database SHALL reject the operation with a unique constraint violation error
3. THE Database SHALL permit multiple allocations for the same asset_id when all have non-NULL returned_at values (historical allocations)
4. THE Database SHALL permit exactly one allocation per asset_id with returned_at IS NULL (current allocation)

### Requirement 6: Asset Status Synchronization Trigger

**User Story:** As a system architect, I want automatic asset status updates based on allocation state, so that asset status always reflects actual assignment state without manual synchronization.

#### Acceptance Criteria

1. THE Database SHALL create a trigger function `sync_asset_status()` that updates assets.status based on allocation changes
2. WHEN a new allocation is inserted with `returned_at IS NULL`, THE Status_Sync_Trigger SHALL update the corresponding asset status to 'Allocated'
3. WHEN an allocation is updated to set `returned_at` to a non-NULL value, THE Status_Sync_Trigger SHALL update the corresponding asset status to 'Available'
4. THE Status_Sync_Trigger SHALL execute after INSERT and UPDATE operations on the allocations table
5. IF the Status_Sync_Trigger fails to update asset status, THEN THE Database SHALL rollback the entire allocation transaction

### Requirement 7: Row Level Security — Assets Table

**User Story:** As a system architect, I want RLS policies on the assets table, so that asset visibility and modification follow role-based permissions.

#### Acceptance Criteria

1. THE RLS SHALL permit any authenticated user to SELECT all rows from the assets table
2. THE RLS SHALL permit users with `role = 'Admin'` OR `role = 'Asset Manager'` to INSERT rows into the assets table
3. THE RLS SHALL permit users with `role = 'Admin'` OR `role = 'Asset Manager'` to UPDATE rows in the assets table
4. THE RLS SHALL permit users with `role = 'Admin'` OR `role = 'Asset Manager'` to DELETE rows from the assets table
5. IF an authenticated user without Admin or Asset Manager role attempts INSERT, UPDATE, or DELETE on assets, THEN THE RLS SHALL deny the operation with zero rows affected

### Requirement 8: Row Level Security — Allocations Table

**User Story:** As a system architect, I want RLS policies on the allocations table, so that allocation operations follow departmental hierarchy and role permissions.

#### Acceptance Criteria

1. THE RLS SHALL permit any authenticated user to SELECT all rows from the allocations table
2. THE RLS SHALL permit users with `role = 'Admin'`, `role = 'Asset Manager'`, OR `role = 'Department Head'` to INSERT rows into the allocations table
3. THE RLS SHALL permit users with `role = 'Admin'`, `role = 'Asset Manager'`, OR `role = 'Department Head'` to UPDATE rows in the allocations table
4. THE RLS SHALL deny DELETE operations on the allocations table for all users to preserve audit trail
5. IF an authenticated user without appropriate role attempts INSERT or UPDATE on allocations, THEN THE RLS SHALL deny the operation with zero rows affected

### Requirement 9: Row Level Security — Transfer Requests Table

**User Story:** As a system architect, I want RLS policies on transfer requests, so that any user can create requests but only authorized users can approve or reject them.

#### Acceptance Criteria

1. THE RLS SHALL permit any authenticated user to SELECT all rows from the transfer_requests table
2. THE RLS SHALL permit any authenticated user to INSERT rows into the transfer_requests table
3. THE RLS SHALL permit users with `role = 'Admin'` OR `role = 'Asset Manager'` to UPDATE the status column of transfer_requests
4. THE RLS SHALL permit users with `role = 'Department Head'` to UPDATE the status column only for requests where the current_holder belongs to their department
5. THE RLS SHALL deny DELETE operations on transfer_requests for all users
6. IF a non-authorized user attempts to UPDATE transfer request status, THEN THE RLS SHALL deny the operation with zero rows affected

### Requirement 10: Screen 4 — Asset Registration Interface

**User Story:** As an Asset Manager, I want a comprehensive asset registration interface, so that I can efficiently add new assets to the inventory and maintain the asset directory.

#### Acceptance Criteria

1. THE Screen_4 SHALL display a data grid with columns: Tag, Name, Category, Status, Serial Number, Location, and Created Date
2. THE Screen_4 SHALL provide filter controls: text search for Tag/Name/Serial, dropdown filter for Category, and dropdown filter for Status
3. THE Screen_4 SHALL display an "Register New Asset" button accessible only to users with role 'Admin' or 'Asset Manager'
4. WHEN an authorized user clicks "Register New Asset", THE Screen_4 SHALL display a modal form with fields: Name (required text, max 255 chars), Category (required dropdown from asset_categories), Serial Number (optional text), Condition (optional text), and Location (optional text)
5. THE Screen_4 modal SHALL NOT include a Tag field because tags are auto-generated by the database
6. WHEN the registration form is submitted with valid data, THE System SHALL INSERT a new asset record and refresh the data grid to show the new asset
7. IF the registration form is submitted with duplicate serial number, THEN THE Screen_4 SHALL display error "Serial number already exists" and keep the modal open

### Requirement 11: Screen 4 — Asset Directory Filtering

**User Story:** As a user, I want to filter the asset directory, so that I can quickly find specific assets or categories of assets.

#### Acceptance Criteria

1. WHEN text is entered in the search filter, THE Screen_4 SHALL display only assets where Tag, Name, or Serial Number contains the search text (case-insensitive)
2. WHEN a category is selected in the category filter, THE Screen_4 SHALL display only assets belonging to that category
3. WHEN a status is selected in the status filter, THE Screen_4 SHALL display only assets with that status
4. THE Screen_4 SHALL support combining multiple filters simultaneously (text search AND category AND status)
5. WHEN filters are cleared, THE Screen_4 SHALL display all assets in the data grid

### Requirement 12: Screen 5 — Asset Selection Interface

**User Story:** As an Asset Manager, I want to select assets for allocation or transfer operations, so that I can manage asset assignments efficiently.

#### Acceptance Criteria

1. THE Screen_5 SHALL display a typeahead search field that allows searching assets by Tag or Name
2. THE Screen_5 typeahead SHALL display suggestions showing both Tag and Name as the user types (minimum 2 characters)
3. WHEN an asset is selected from the typeahead, THE Screen_5 SHALL load and display the asset details and current allocation status
4. THE Screen_5 SHALL display selected asset information: Tag, Name, Category, Status, Current Location, and Serial Number
5. IF no asset is selected, THE Screen_5 SHALL show a message "Please select an asset to view allocation options"

### Requirement 13: Screen 5 — Available Asset Allocation

**User Story:** As an Asset Manager, I want to allocate available assets to employees, so that I can assign organizational resources to users who need them.

#### Acceptance Criteria

1. WHEN a selected asset has status 'Available', THE Screen_5 SHALL display an "Allocate Asset" form with fields: Assign To (required employee dropdown from profiles), Expected Return Date (optional date picker), and Submit Allocation button
2. THE Screen_5 employee dropdown SHALL include all users with status 'Active' showing full_name and department
3. WHEN the allocation form is submitted with valid data, THE System SHALL INSERT a new allocation record with returned_at as NULL and refresh the screen to show updated status
4. WHEN an allocation is successfully created, THE Screen_5 SHALL display success message "Asset {tag} allocated to {employee_name}"
5. IF the allocation fails due to database constraint (double allocation), THEN THE Screen_5 SHALL display error "Asset is already allocated. Please refresh and try again."

### Requirement 14: Screen 5 — Allocated Asset Transfer Request

**User Story:** As an employee, I want to request transfer of allocated assets, so that I can obtain assets I need that are currently assigned to others.

#### Acceptance Criteria

1. WHEN a selected asset has status 'Allocated', THE Screen_5 SHALL hide the allocation form and display a red warning banner: "Asset currently allocated to [Current Holder Name]"
2. BELOW the warning banner, THE Screen_5 SHALL display a "Request Transfer" form with fields: Reason (required textarea, max 1000 chars) and Submit Request button
3. WHEN the transfer request form is submitted with valid reason, THE System SHALL INSERT a new transfer_request record with status 'Pending'
4. WHEN a transfer request is successfully created, THE Screen_5 SHALL display success message "Transfer request submitted. You will be notified when reviewed."
5. IF a transfer request already exists for the asset by the same user, THEN THE Screen_5 SHALL display "You already have a pending request for this asset" instead of the form

### Requirement 15: Screen 5 — Allocation History Display

**User Story:** As an Asset Manager, I want to view allocation history for selected assets, so that I can understand past usage patterns and make informed allocation decisions.

#### Acceptance Criteria

1. WHEN an asset is selected on Screen_5, THE System SHALL display an "Allocation History" section below the main interaction area
2. THE allocation history SHALL display a chronological timeline showing: Date Range (allocated date to returned date or "Current" if active), Assigned To (employee name), Assigned By (manager name), and Return Condition (if returned)
3. THE allocation history SHALL be ordered with most recent allocations first
4. THE allocation history SHALL distinguish active allocations with visual highlighting (e.g., bold text or colored background)
5. IF an asset has no allocation history, THE Screen_5 SHALL display "No previous allocations" in the history section

### Requirement 16: Database Migration Script for Schema Updates

**User Story:** As a developer, I want migration scripts for Stage 2 schema changes, so that I can update existing Stage 1 databases without losing data or breaking functionality.

#### Acceptance Criteria

1. THE System SHALL provide a migration script at `supabase/migration_stage2_assets_allocation.sql` containing all Stage 2 schema additions
2. THE migration script SHALL create asset_tag_seq, assets table, allocations table, transfer_requests table, and all associated indexes, triggers, and RLS policies
3. THE migration script SHALL be executable on any Stage 1 database without errors or data loss
4. THE migration script SHALL include proper rollback statements commented for manual use if needed
5. THE migration script SHALL verify prerequisite Stage 1 tables (profiles, departments, asset_categories) exist before proceeding

### Requirement 17: Asset Tag Generation System

**User Story:** As an Asset Manager, I want automatic asset tag generation, so that every registered asset gets a unique identifier without manual entry errors.

#### Acceptance Criteria

1. WHEN an asset is registered without specifying a tag, THE Database SHALL automatically generate a tag using the format 'AF-' + zero-padded sequence number
2. THE Database SHALL ensure generated tags follow the pattern AF-0001, AF-0002, AF-0003, etc., incrementing sequentially
3. THE Database SHALL prevent manual override of auto-generated tags to maintain sequence integrity
4. THE Database SHALL handle concurrent asset registrations without duplicate or skipped tag numbers
5. IF the sequence reaches 9999, THE Database SHALL continue with AF-10000, AF-10001, etc., expanding beyond 4 digits

### Requirement 18: Asset Status Lifecycle Management

**User Story:** As a system architect, I want automated asset status management, so that asset status accurately reflects allocation state without manual updates.

#### Acceptance Criteria

1. WHEN an asset is newly registered, THE Database SHALL set its status to 'Available'
2. WHEN an allocation is created for an available asset, THE Database SHALL automatically change the asset status to 'Allocated'
3. WHEN an active allocation is returned (returned_at set to timestamp), THE Database SHALL automatically change the asset status back to 'Available'
4. THE Database SHALL reject attempts to allocate assets with status other than 'Available' (Reserved, Under Maintenance, Lost, Retired, Disposed)
5. THE Database SHALL maintain status consistency even during concurrent allocation operations or system failures

### Requirement 19: Transfer Request Workflow

**User Story:** As an Asset Manager, I want a structured transfer request workflow, so that asset reassignments follow proper approval processes.

#### Acceptance Criteria

1. WHEN a transfer request is created, THE Database SHALL set its status to 'Pending' and record the requesting user, current holder, and reason
2. WHEN an Asset Manager or Admin approves a transfer request, THE System SHALL automatically create a new allocation to the requesting user and mark the previous allocation as returned
3. WHEN a transfer request is approved, THE Database SHALL update the request status to 'Approved' and process the allocation change atomically
4. WHEN a transfer request is rejected, THE Database SHALL update the request status to 'Rejected' with no allocation changes
5. THE System SHALL prevent creation of transfer requests for assets that are not currently allocated

### Requirement 20: Data Integrity Enforcement

**User Story:** As a system architect, I want comprehensive data integrity constraints, so that the database remains consistent regardless of application-layer bugs or direct database manipulation.

#### Acceptance Criteria

1. THE Database SHALL enforce that serial_number values are unique when not NULL across all assets
2. THE Database SHALL enforce that each asset can have at most one active allocation (returned_at IS NULL) via the partial unique index
3. THE Database SHALL prevent deletion of assets that have allocation history via foreign key constraints
4. THE Database SHALL prevent deletion of users (profiles) that are referenced in allocations via ON DELETE RESTRICT
5. THE Database SHALL ensure all asset category references remain valid through foreign key constraints with appropriate cascade behavior
