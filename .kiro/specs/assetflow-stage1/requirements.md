# Requirements Document

## Introduction

AssetFlow Stage 1 establishes the foundational infrastructure for the AssetFlow asset management system. This stage covers the Supabase database schema, user authentication via Google OAuth, role-based access control (RBAC) via Row Level Security (RLS), and the two core UI screens: Login (Screen 1) and Organization Setup (Screen 3). By the end of this stage, the system must securely handle user onboarding and allow Administrators to configure the organizational hierarchy — Departments, Asset Categories, and Employee Role assignments.

---

## Glossary

- **System**: The AssetFlow application (frontend + Supabase backend).
- **Auth_Service**: Supabase Auth, responsible for Google OAuth authentication.
- **Database**: The Supabase PostgreSQL database hosting all application tables.
- **Profile_Trigger**: A PostgreSQL database function and trigger that fires on `auth.users` INSERT to auto-create a profile record.
- **RLS**: Row Level Security policies enforced by Supabase on each table.
- **Admin**: A user whose `role` field in the `profiles` table equals `'Admin'`.
- **Employee**: A user whose `role` field equals `'Employee'` (the default for all new signups).
- **Department_Head**: A user whose `role` field equals `'Department Head'`.
- **Asset_Manager**: A user whose `role` field equals `'Asset Manager'`.
- **Screen_1**: The Login page, the entry point of the application. Provides Google OAuth sign-in only.
- **Screen_3**: The Organization Setup page, accessible only to Admins.
- **Route_Guard**: A frontend mechanism that prevents non-Admin users from accessing Admin-only routes.
- **Data_Grid**: A tabular UI component that displays records from a database table with columns and rows.

---

## Requirements

### Requirement 1: Database Schema — Profiles Table

**User Story:** As a system architect, I want a `profiles` table that extends Supabase Auth with application-specific user data, so that the system can track roles, department assignments, and status for every user.

#### Acceptance Criteria

1. THE Database SHALL contain a `profiles` table with columns: `id` (UUID, Primary Key, NOT NULL, references `auth.users.id` ON DELETE CASCADE), `full_name` (Text, NOT NULL, max 255 characters), `email` (Text, NOT NULL, max 254 characters), `role` (Enum: `'Employee'`, `'Department Head'`, `'Asset Manager'`, `'Admin'`, NOT NULL), `department_id` (UUID, Foreign Key, Nullable, references `departments.id`), `status` (Enum: `'Active'` or `'Inactive'`, NOT NULL), and `created_at` (Timestamp, NOT NULL).
2. THE Database SHALL enforce a default value of `'Employee'` for the `role` column on the `profiles` table.
3. THE Database SHALL enforce a default value of `'Active'` for the `status` column on the `profiles` table.
4. THE Database SHALL enforce a default value of `now()` for the `created_at` column on the `profiles` table.
5. THE Database SHALL allow `department_id` to be NULL in the `profiles` table to support users not yet assigned to a department.
6. IF a record in `auth.users` is deleted, THEN THE Database SHALL automatically delete the corresponding row in the `profiles` table via the ON DELETE CASCADE constraint.

---

### Requirement 2: Database Schema — Departments Table

**User Story:** As an Admin, I want a `departments` table that models the organizational hierarchy, so that employees can be assigned to departments and departments can be nested under parent departments.

#### Acceptance Criteria

1. THE Database SHALL contain a `departments` table with columns: `id` (UUID, Primary Key, auto-generated), `name` (Text, Unique, NOT NULL, max 100 characters), `head_id` (UUID, Foreign Key, Nullable, references `profiles.id` ON DELETE SET NULL), `parent_department_id` (UUID, Foreign Key, Nullable, self-references `departments.id` ON DELETE RESTRICT), and `status` (Enum: `'Active'` or `'Inactive'`, NOT NULL).
2. THE Database SHALL enforce uniqueness on the `name` column of the `departments` table.
3. THE Database SHALL enforce a default value of `'Active'` for the `status` column on the `departments` table.
4. THE Database SHALL allow `head_id` and `parent_department_id` to be NULL in the `departments` table.
5. IF an INSERT or UPDATE on the `departments` table sets `status` to a value other than `'Active'` or `'Inactive'`, THEN THE Database SHALL reject the operation with a constraint violation error.

---

### Requirement 3: Database Schema — Asset Categories Table

**User Story:** As an Admin, I want an `asset_categories` table that defines types of assets with flexible custom attributes, so that I can categorize assets without requiring schema changes for each new category type.

#### Acceptance Criteria

1. THE Database SHALL contain an `asset_categories` table with columns: `id` (UUID, Primary Key, system-assigned on INSERT), `name` (Text, Unique, NOT NULL, 1–100 characters), `attributes` (JSONB, Nullable), and `created_at` (Timestamp, NOT NULL, default `now()`).
2. THE Database SHALL allow `attributes` to be NULL in the `asset_categories` table for categories that require no custom fields.
3. THE Database SHALL record the creation timestamp in `created_at` automatically on INSERT so that auditors can verify when a category was added.

---

### Requirement 4: Database Schema — SQL Schema File

**User Story:** As a developer, I want the complete Supabase schema defined in a single SQL file, so that the database can be reproduced consistently across environments.

#### Acceptance Criteria

1. THE System SHALL maintain a file at `supabase/schema.sql` that includes, at minimum: all `CREATE TYPE` statements for enums, all `CREATE TABLE` statements with column definitions, default values, NOT NULL constraints, and foreign key relationships, all `CREATE FUNCTION` and `CREATE TRIGGER` statements for the Profile_Trigger, and all `CREATE POLICY` and `ALTER TABLE … ENABLE ROW LEVEL SECURITY` statements for RLS.
2. WHEN the schema is updated, THE System SHALL include a migration SQL script in the `supabase/` folder named `migration_YYYYMMDD_<description>.sql` (e.g., `migration_20250101_add_status_index.sql`) that contains only the incremental changes required to bring the previous schema to the new schema.
3. THE `supabase/schema.sql` file SHALL be executable from a clean Supabase project without prior migrations, producing an identical database state to one that has had all migrations applied in sequence.

---

### Requirement 5: Profile Auto-Creation Trigger

**User Story:** As a new user, I want my profile record to be created automatically when I sign up, so that I do not need to perform a separate profile setup step.

#### Acceptance Criteria

1. WHEN a new record is inserted into `auth.users`, THE Profile_Trigger SHALL automatically insert a corresponding record into the `profiles` table with `id` matching the new `auth.users.id`, `email` copied from `auth.users.email`, `role` set to `'Employee'`, and `status` set to `'Active'`.
2. WHEN the Profile_Trigger fires AND `raw_user_meta_data` contains a non-empty `full_name` field, THE Profile_Trigger SHALL populate the `profiles.full_name` column with that value. IF `raw_user_meta_data` is absent or `full_name` within it is empty or missing, THEN THE Profile_Trigger SHALL attempt to use `raw_user_meta_data->>'name'` (the field Supabase OAuth providers populate) before falling back to NULL.
3. IF the Profile_Trigger fails to insert a profile record (e.g., due to a duplicate `id` conflict or constraint violation), THEN THE Database SHALL raise an error, roll back the `auth.users` insertion, and leave both `auth.users` and `profiles` free of partial data from that operation.

---

### Requirement 6: Row Level Security — Profiles Table

**User Story:** As a system architect, I want RLS policies on the `profiles` table, so that users can only read or modify data according to their role.

#### Acceptance Criteria

1. THE RLS SHALL permit any authenticated user to SELECT all rows from the `profiles` table.
2. THE RLS SHALL permit a user with `role = 'Admin'` to UPDATE the `role`, `department_id`, and `status` columns of any row in the `profiles` table.
3. THE RLS SHALL permit any authenticated user to UPDATE only their own `full_name` column in the `profiles` table; attempts by a non-Admin to UPDATE any other column SHALL be explicitly denied with an error.
4. IF an authenticated user attempts a direct INSERT on the `profiles` table, THEN THE RLS SHALL reject the operation with an error; inserts SHALL only occur via the Profile_Trigger running under the database's security-definer context.
5. IF an authenticated user attempts a DELETE on the `profiles` table, THEN THE RLS SHALL reject the operation with an error.
6. IF a non-Admin authenticated user attempts to UPDATE the `role`, `department_id`, or `status` columns of any row in the `profiles` table, THEN THE RLS SHALL deny the operation with an error.

---

### Requirement 7: Row Level Security — Departments Table

**User Story:** As a system architect, I want RLS policies on the `departments` table so that only Admins can modify the organizational structure while all authenticated users can read it.

#### Acceptance Criteria

1. WHILE a user is authenticated, THE RLS SHALL permit that user to SELECT rows from the `departments` table.
2. IF a user is unauthenticated and attempts to SELECT from the `departments` table, THEN THE RLS SHALL deny the operation and return no rows.
3. THE RLS SHALL permit only a user with `role = 'Admin'` to INSERT rows into the `departments` table; IF an authenticated non-Admin attempts an INSERT, THEN THE RLS SHALL deny the operation with an error.
4. THE RLS SHALL permit only a user with `role = 'Admin'` to UPDATE rows in the `departments` table; IF an authenticated non-Admin attempts an UPDATE, THEN THE RLS SHALL deny the operation with an error.
5. THE RLS SHALL permit only a user with `role = 'Admin'` to DELETE rows from the `departments` table; IF an authenticated non-Admin attempts a DELETE, THEN THE RLS SHALL deny the operation with an error.
6. IF an unauthenticated user attempts any INSERT, UPDATE, or DELETE on the `departments` table, THEN THE RLS SHALL deny the operation with an error.

---

### Requirement 8: Row Level Security — Asset Categories Table

**User Story:** As a system architect, I want RLS policies on the `asset_categories` table so that only Admins can modify asset category definitions while all authenticated users can read them.

#### Acceptance Criteria

1. WHILE a user is authenticated, THE RLS SHALL permit that user to SELECT rows from the `asset_categories` table. IF a user is unauthenticated and attempts any operation (SELECT, INSERT, UPDATE, or DELETE) on the `asset_categories` table, THEN THE RLS SHALL deny the operation and return no rows or an error.
2. IF a user with `role = 'Admin'` performs an INSERT on the `asset_categories` table, THEN THE RLS SHALL permit the operation.
3. IF an authenticated user without `role = 'Admin'` attempts an INSERT on the `asset_categories` table, THEN THE RLS SHALL deny the operation, resulting in zero rows inserted.
4. IF a user with `role = 'Admin'` performs an UPDATE on the `asset_categories` table, THEN THE RLS SHALL permit the operation.
5. IF an authenticated user without `role = 'Admin'` attempts an UPDATE on the `asset_categories` table, THEN THE RLS SHALL deny the operation, resulting in zero rows updated.
6. IF a user with `role = 'Admin'` performs a DELETE on the `asset_categories` table, THEN THE RLS SHALL permit the operation.
7. IF an authenticated user without `role = 'Admin'` attempts a DELETE on the `asset_categories` table, THEN THE RLS SHALL deny the operation, resulting in zero rows deleted.

---

### Requirement 9: User Login Flow — Google OAuth

**User Story:** As a new or returning user, I want to sign in with my Google account, so that I can access AssetFlow without managing a separate password and without being able to self-assign a privileged role.

#### Acceptance Criteria

1. THE Screen_1 SHALL display a single "Sign in with Google" button and no email, password, or Full Name fields.
2. THE Screen_1 SHALL NOT provide any UI element that allows a user to select a role.
3. WHEN a user clicks "Sign in with Google", THE Auth_Service SHALL initiate the Supabase Google OAuth flow (`supabase.auth.signInWithOAuth({ provider: 'google' })`), which redirects the user to Google's consent screen and back to the application on success.
4. WHEN the OAuth callback completes successfully for a first-time user, THE Auth_Service SHALL create a new record in `auth.users` and the Profile_Trigger SHALL create a corresponding `profiles` record with `role = 'Employee'`, `status = 'Active'`, and `full_name` populated from the Google account's name (via `raw_user_meta_data`).
5. IF the Google OAuth flow fails (e.g., user cancels, network error, or provider error), THEN THE Screen_1 SHALL display an error message "Sign-in failed. Please try again." and remain on Screen_1.

---

### Requirement 10: Role-Based Routing After Login

**User Story:** As a registered user, I want to be routed to the correct screen after Google sign-in based on my role, so that I land on the appropriate interface without manual navigation.

#### Acceptance Criteria

1. WHEN the Google OAuth callback completes and a session is established, THE System SHALL retrieve the user's `role` from the `profiles` table and route the user based on that role.
2. WHEN a user with `role = 'Admin'` successfully authenticates, THE System SHALL route that user to Screen_3.
3. WHEN a user with a recognized role other than `'Admin'` (i.e., `'Employee'`, `'Department Head'`, or `'Asset Manager'`) successfully authenticates, THE System SHALL route that user to a placeholder Dashboard screen.
4. IF the authenticated user's `role` value in the `profiles` table is NULL or does not match any recognized role value, THEN THE System SHALL display "Account configuration error. Contact your administrator." and SHALL NOT route the user to any screen.

---

### Requirement 11: Admin Route Guard

**User Story:** As a system architect, I want Screen 3 to be protected by a route guard, so that non-Admin users cannot access the Organization Setup panel directly via URL.

#### Acceptance Criteria

1. WHEN a user navigates to the Screen_3 route, THE Route_Guard SHALL initiate an async verification of the authenticated user's `role` from the `profiles` table; Screen_3 content SHALL NOT be rendered or visible during this verification period, and THE System SHALL display a loading indicator.
2. WHEN a non-Admin authenticated user attempts to access the Screen_3 route directly, THE Route_Guard SHALL redirect that user to the placeholder Dashboard screen.
3. WHEN an unauthenticated user attempts to access the Screen_3 route, THE Route_Guard SHALL redirect that user to Screen_1.
4. IF the role-verification query fails due to a database or network error, THEN THE Route_Guard SHALL redirect the user to Screen_1 and SHALL NOT render Screen_3 content.

---

### Requirement 12: Screen 3 — Departments Tab

**User Story:** As an Admin, I want to view and create departments in an organized data grid, so that I can define the company's organizational hierarchy.

#### Acceptance Criteria

1. THE Screen_3 SHALL display a Departments tab containing a Data_Grid with columns: Name, Head, Parent Department, and Status.
2. WHEN the Departments tab is loaded, THE System SHALL query all rows from the `departments` table and display them in the Data_Grid.
3. THE Screen_3 SHALL display an "Add New Department" button on the Departments tab.
4. WHEN an Admin clicks "Add New Department", THE Screen_3 SHALL display a modal form containing: a required Name text field (max 100 characters), an optional dropdown to select a `parent_department_id` (populated from the `departments` table), and an optional dropdown to select a `head_id` (populated from the `profiles` table).
5. WHEN an Admin submits the "Add New Department" modal with a Name that is non-empty, non-whitespace-only, at most 100 characters, and case-insensitively unique within the `departments` table, THE System SHALL INSERT a new row into the `departments` table, close the modal, and refresh the Data_Grid to display the new department.
6. IF an Admin submits the "Add New Department" modal with a blank or whitespace-only Name, THEN THE Screen_3 SHALL display a validation error on the Name field and the modal SHALL remain open.
7. IF an Admin submits the "Add New Department" modal with a Name that already exists in the `departments` table (case-insensitive), THEN THE Screen_3 SHALL display an error message indicating the department name must be unique, and the modal SHALL remain open with the Admin's input preserved.

---

### Requirement 13: Screen 3 — Asset Categories Tab

**User Story:** As an Admin, I want to view and create asset categories, so that I can define the types of assets the organization manages.

#### Acceptance Criteria

1. THE Screen_3 SHALL display a Categories tab containing a Data_Grid with columns: Name and Attributes.
2. WHEN the Categories tab is loaded, THE System SHALL query all rows from the `asset_categories` table and display them in the Data_Grid sorted in ascending alphabetical order by Name.
3. THE Screen_3 SHALL display an "Add Category" button on the Categories tab.
4. WHEN an Admin clicks "Add Category", THE Screen_3 SHALL display a modal form containing: a required Name text field (max 100 characters) and an optional Attributes field for defining JSONB key-value pairs.
5. WHEN an Admin submits the "Add Category" modal with a Name that contains at least one non-whitespace character and does not already exist in the `asset_categories` table, THE System SHALL INSERT a new row into the `asset_categories` table and refresh the Data_Grid.
6. IF an Admin submits the "Add Category" modal with a blank or whitespace-only Name, THEN THE Screen_3 SHALL display a validation error on the Name field and the modal SHALL remain open.
7. IF an Admin submits the "Add Category" modal with a Name that already exists in the `asset_categories` table, THEN THE Screen_3 SHALL display an error message indicating the category name must be unique, and the modal SHALL remain open with the Admin's input preserved.
8. IF an Admin dismisses or cancels the "Add Category" modal without submitting, THEN THE Screen_3 SHALL close the modal and make no changes to the `asset_categories` table.

---

### Requirement 14: Screen 3 — Employee Directory Tab

**User Story:** As an Admin, I want to view all employees and manage their roles and department assignments from a single directory, so that I can control access levels across the organization.

#### Acceptance Criteria

1. THE Screen_3 SHALL display an Employee Directory tab containing a Data_Grid with columns: Full Name, Email, Department, Role, and Status.
2. WHEN the Employee Directory tab is loaded, THE System SHALL query all rows from the `profiles` table and display them in the Data_Grid; the `email` column SHALL be read directly from `profiles.email` without requiring a join to `auth.users`.
3. WHEN an Admin clicks on an employee row in the Data_Grid, THE Screen_3 SHALL display a modal form showing the employee's Full Name and Email as read-only identity fields, and pre-populating the Role dropdown with the employee's current role and the Department dropdown with the employee's current `department_id` (or an "Unassigned" option if `department_id` is NULL).
4. WHEN the employee modal is displayed, THE Screen_3 modal SHALL provide a Role dropdown with options: `'Employee'`, `'Department Head'`, `'Asset Manager'`, and `'Admin'`.
5. WHEN the employee modal is displayed, THE Screen_3 modal SHALL provide a Department dropdown populated from the `departments` table where `status = 'Active'`, plus an "Unassigned" option representing a NULL `department_id`.
6. WHEN an Admin submits the employee modal with updated Role or Department values, THE System SHALL UPDATE the corresponding `role` and `department_id` fields in the `profiles` table and refresh the Data_Grid.
7. IF the UPDATE operation on the `profiles` table fails (e.g., due to a network or database error), THEN THE Screen_3 SHALL display an error message and keep the modal open with the Admin's submitted values preserved.

---

### Requirement 15: Admin Bootstrap

**User Story:** As a developer setting up the system for the first time, I want to be able to manually set a user's role to 'Admin' directly in the Supabase table, so that I can bootstrap the first Admin account without requiring a pre-existing Admin to do it.

#### Acceptance Criteria

1. IF an UPDATE of the `role` column in the `profiles` table is performed by a Supabase service role key or database superuser, THEN THE Database SHALL permit the operation, bypassing all RLS policies.
2. WHEN a user whose `role` was manually updated to `'Admin'` signs in via Google OAuth, THE System SHALL read the `role` from the `profiles` table after the OAuth callback and route the user to Screen_3 per Requirement 10.
3. IF an authenticated non-Admin user attempts to UPDATE their own `role` column in the `profiles` table to `'Admin'` or any other role, THEN THE RLS SHALL deny the operation with an error, preventing self-elevation of privileges.
