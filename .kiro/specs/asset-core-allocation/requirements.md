# Requirements Document - AssetFlow Stage 2: Asset Core & Allocation Engine

## Introduction

AssetFlow Stage 2 builds upon the foundation of user authentication and organization setup (Stage 1) by introducing the core asset management functionality. This stage implements a comprehensive asset state machine and allocation engine that enables Asset Managers to register physical assets, allocate them to employees and departments, and maintain strict database-level integrity to prevent double-allocation scenarios.

The system provides robust asset lifecycle management through a well-defined state machine, automatic asset tag generation, and comprehensive transfer workflow capabilities. Database-level constraints and triggers ensure data integrity while Row Level Security (RLS) policies maintain proper access control.

## Glossary

- **Asset_Core_System**: The central asset management system responsible for asset registration, state management, and allocation tracking
- **Asset_Manager**: A user role with permissions to register assets, manage allocations, and oversee asset transfers
- **Asset**: A physical item tracked by the system with unique identification, status, and allocation state
- **Allocation_Engine**: The subsystem responsible for managing asset assignments to employees or departments
- **Asset_Tag**: A unique identifier automatically generated for each asset in the format AF-NNNN (e.g., AF-0001)
- **Transfer_Request**: A formal request to transfer an asset from one assignee to another
- **Double_Allocation**: The prohibited state where a single asset is allocated to multiple entities simultaneously
- **Database_Trigger**: Automatic database procedures that maintain data consistency and status synchronization
- **RLS_Policy**: Row Level Security policies that control data access based on user roles and organizational membership

## Requirements

### Requirement 1: Asset Registration and Management

**User Story:** As an Asset Manager, I want to register physical assets in the system, so that I can track and manage organizational inventory effectively.

#### Acceptance Criteria

1. WHEN an Asset Manager registers a new asset, THE Asset_Core_System SHALL create a new asset record with auto-generated Asset_Tag in AF-NNNN format
2. WHEN creating an asset, THE Asset_Core_System SHALL require name, description, serial number, asset category, and purchase information
3. WHEN an asset is created, THE Asset_Core_System SHALL set the initial status to "Available"
4. THE Asset_Core_System SHALL validate that serial numbers are unique within the organization
5. WHEN an Asset Manager provides asset details, THE Asset_Core_System SHALL validate all required fields before creation
6. THE Asset_Core_System SHALL associate each asset with the creating user's organization automatically

### Requirement 2: Asset State Machine and Status Management

**User Story:** As an Asset Manager, I want assets to have clearly defined statuses, so that I can track their current state and lifecycle.

#### Acceptance Criteria

1. THE Asset_Core_System SHALL support exactly these asset statuses: Available, Allocated, Reserved, Under Maintenance, Lost, Retired, Disposed
2. WHEN an asset status changes, THE Asset_Core_System SHALL validate the transition is allowed according to business rules
3. WHEN an asset is allocated to someone, THE Database_Trigger SHALL automatically update the asset status to "Allocated"
4. WHEN an allocation is removed, THE Database_Trigger SHALL automatically update the asset status to "Available"
5. THE Asset_Core_System SHALL prevent manual status changes to "Allocated" when no active allocation exists
6. THE Asset_Core_System SHALL prevent manual status changes from "Allocated" when an active allocation exists

### Requirement 3: Asset Allocation Engine

**User Story:** As an Asset Manager, I want to allocate assets to employees or departments, so that I can track who is responsible for each asset.

#### Acceptance Criteria

1. WHEN allocating an asset, THE Allocation_Engine SHALL verify the asset status is "Available" before proceeding
2. WHEN an allocation is created, THE Allocation_Engine SHALL record the allocated_to user, allocated_by user, allocation_date, and notes
3. THE Allocation_Engine SHALL support allocation to both individual employees and entire departments
4. WHEN an asset is allocated, THE Database_Trigger SHALL automatically update the asset status to "Allocated"
5. THE Allocation_Engine SHALL validate that the allocated_to user belongs to the same organization
6. WHEN allocation fails, THE Allocation_Engine SHALL provide clear error messages indicating the reason

### Requirement 4: Double-Allocation Prevention

**User Story:** As a system administrator, I want to ensure assets cannot be double-allocated, so that data integrity is maintained at the database level.

#### Acceptance Criteria

1. THE Asset_Core_System SHALL implement a partial unique index "only_one_active_allocation" preventing multiple active allocations per asset
2. WHEN attempting to create a second active allocation for an asset, THE Asset_Core_System SHALL reject the operation with a constraint violation
3. THE Asset_Core_System SHALL allow multiple allocations per asset only when all previous allocations are marked as returned
4. WHEN an allocation is marked as returned, THE Database_Trigger SHALL set the returned_date and returned_by fields
5. THE Asset_Core_System SHALL validate allocation uniqueness before any allocation creation attempt

### Requirement 5: Asset Transfer Workflow

**User Story:** As an employee, I want to request asset transfers, so that I can properly hand over assets when changing roles or departments.

#### Acceptance Criteria

1. WHEN a user requests an asset transfer, THE Asset_Core_System SHALL create a transfer request record
2. THE Asset_Core_System SHALL require current assignee, requested new assignee, asset ID, and reason for transfer requests
3. WHEN a transfer request is created, THE Asset_Core_System SHALL set the status to "Pending" and record the request timestamp
4. THE Asset_Core_System SHALL validate that the requesting user is either the current assignee or an Asset Manager
5. WHEN an Asset Manager approves a transfer, THE Allocation_Engine SHALL complete the allocation transfer automatically
6. WHEN a transfer is completed, THE Asset_Core_System SHALL update the transfer request status to "Completed"

### Requirement 6: Asset Tag Generation

**User Story:** As an Asset Manager, I want assets to have unique, automatically generated tags, so that I can easily identify and reference assets.

#### Acceptance Criteria

1. WHEN a new asset is created, THE Asset_Core_System SHALL generate a unique Asset_Tag using the sequence "asset_tag_sequence"
2. THE Asset_Core_System SHALL format Asset_Tags as "AF-" followed by a zero-padded 4-digit number (e.g., AF-0001, AF-0142)
3. THE Asset_Core_System SHALL ensure Asset_Tag uniqueness across the entire system, not just per organization
4. WHEN asset creation fails after tag generation, THE Asset_Core_System SHALL not reuse the generated tag number
5. THE Asset_Core_System SHALL make Asset_Tag immutable after creation

### Requirement 7: Database Schema and Relationships

**User Story:** As a system architect, I want proper database relationships and constraints, so that data integrity is maintained and the system is scalable.

#### Acceptance Criteria

1. THE Asset_Core_System SHALL create an "assets" table with foreign keys to profiles, asset_categories, and departments
2. THE Asset_Core_System SHALL create an "allocations" table with proper foreign key relationships to assets and profiles
3. THE Asset_Core_System SHALL create a "transfer_requests" table linking assets and user profiles
4. THE Asset_Core_System SHALL implement cascading rules that preserve data integrity when parent records are modified
5. THE Asset_Core_System SHALL use appropriate PostgreSQL data types for all fields (UUIDs, timestamps, enums)
6. THE Asset_Core_System SHALL create indexes on frequently queried columns for optimal performance

### Requirement 8: Row Level Security and Access Control

**User Story:** As a security administrator, I want proper access controls on asset data, so that users can only access assets within their organization and according to their role.

#### Acceptance Criteria

1. THE Asset_Core_System SHALL implement RLS policies that restrict asset access to the user's organization
2. WHEN a user queries assets, THE RLS_Policy SHALL filter results to only show assets from their organization
3. THE Asset_Core_System SHALL allow Asset Managers and Admins to perform all CRUD operations on assets within their organization
4. THE Asset_Core_System SHALL allow Employees to view assets but restrict modification capabilities
5. THE Asset_Core_System SHALL prevent cross-organization data access through all asset-related tables
6. THE RLS_Policy SHALL use the existing is_admin() function for privilege checking where appropriate

### Requirement 9: Asset Registration User Interface

**User Story:** As an Asset Manager, I want an intuitive interface to register new assets, so that I can efficiently add inventory to the system.

#### Acceptance Criteria

1. WHEN accessing the Asset Registration screen, THE Asset_Core_System SHALL display a form with all required asset fields
2. THE Asset_Core_System SHALL provide dropdown selection for asset categories populated from the asset_categories table
3. WHEN submitting the registration form, THE Asset_Core_System SHALL validate all required fields client-side before submission
4. WHEN registration is successful, THE Asset_Core_System SHALL display the generated Asset_Tag and redirect to the asset directory
5. WHEN registration fails, THE Asset_Core_System SHALL display specific error messages for each validation failure
6. THE Asset_Core_System SHALL provide clear field labels and help text to guide user input

### Requirement 10: Allocation and Transfer Management Interface

**User Story:** As an Asset Manager, I want a comprehensive interface to manage asset allocations and transfers, so that I can efficiently assign and reassign assets.

#### Acceptance Criteria

1. WHEN accessing the Allocation & Transfer screen, THE Asset_Core_System SHALL display a searchable list of all assets
2. THE Asset_Core_System SHALL provide filtering capabilities by asset status, category, and current assignee
3. WHEN selecting an asset for allocation, THE Asset_Core_System SHALL show a modal with employee/department selection
4. THE Asset_Core_System SHALL display pending transfer requests with approve/deny action buttons for Asset Managers
5. WHEN completing an allocation or transfer, THE Asset_Core_System SHALL update the display immediately without requiring page refresh
6. THE Asset_Core_System SHALL provide clear visual indicators for different asset statuses and allocation states