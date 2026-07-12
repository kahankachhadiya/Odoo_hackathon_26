PRD: AssetFlow - Stage 1 (Infrastructure & Access Control)
==========================================================

1\. Objective
-------------

Establish the foundational master data, user authentication flow, and role-based access control (RBAC) required for AssetFlow. By the end of this stage, the system must securely handle user onboarding and allow Administrators to configure the organizational hierarchy (Departments, Asset Categories, and Employee Roles).

2\. Database Architecture (Supabase Schema)
-------------------------------------------

The database must be normalized to prevent circular dependency deadlocks during the hackathon, while strictly enforcing relational integrity.

### Table: profiles

Extends the native Supabase auth.users table to hold application-specific user data.

*   **id** (UUID, Primary Key): Directly references auth.users.id.
    
*   **full\_name** (Text): The user's display name.
    
*   **role** (Enum): Defines access levels. Allowed values: 'Employee', 'Department Head', 'Asset Manager', 'Admin'. Default must be 'Employee'.
    
*   **department\_id** (UUID, Foreign Key, Nullable): References departments.id. Nullable upon initial signup before an Admin assigns them.
    
*   **status** (Text): Current standing of the employee. Allowed values: 'Active', 'Inactive'. Default is 'Active'.
    
*   **created\_at** (Timestamp): Auto-generated.
    

### Table: departments

Stores the organizational structure.

*   **id** (UUID, Primary Key): Auto-generated.
    
*   **name** (Text, Unique): e.g., "Engineering", "Facilities".
    
*   **head\_id** (UUID, Foreign Key, Nullable): References profiles.id. Represents the Department Head.
    
*   **parent\_department\_id** (UUID, Foreign Key, Nullable): Self-referencing to departments.id to allow for hierarchy (e.g., "Field Ops (East)" under "Field Ops").
    
*   **status** (Text): Allowed values: 'Active', 'Inactive'. Default is 'Active'.
    

### Table: asset\_categories

Defines the types of assets the organization manages.

*   **id** (UUID, Primary Key): Auto-generated.
    
*   **name** (Text, Unique): e.g., "Electronics", "Furniture", "Vehicles".
    
*   **attributes** (JSONB, Nullable): A flexible column for category-specific fields (e.g., storing {"requires\_warranty": true}). _Hackathon tip: Use JSONB to avoid creating infinite joining tables for custom fields._
    

3\. Security & Access Control (Row Level Security)
--------------------------------------------------

Supabase RLS must be activated on all three tables. The policies act as our backend logic:

*   **Profiles Table:**
    
    *   _Read:_ Any authenticated user can read all profiles (needed for directory/dropdowns).
        
    *   _Insert:_ Triggered automatically via a database function when a new auth.users record is created.
        
    *   _Update:_ Only a user with role = 'Admin' can update the role, department\_id, or status of another user. Users can update their own full\_name.
        
*   **Departments & Asset Categories Tables:**
    
    *   _Read:_ Any authenticated user can read (needed to populate dropdowns in later stages).
        
    *   _Insert/Update/Delete:_ Strictly limited to users where role = 'Admin'.
        

4\. User Interface Requirements
-------------------------------

### Screen 1: Login / Signup

**Purpose:** Secure entry point with strictly controlled account creation.

*   **Authentication Method:** Standard Email & Password via Supabase Auth.
    
*   **Signup Flow Constraints:** The UI form must only ask for Email, Password, and Full Name. **Crucially:** There must be no UI option to select a role during signup. The backend must force all new signups to the 'Employee' role.
    
*   **Post-Login Routing:** Upon successful authentication, the frontend must check the user's role in the profiles table and route them accordingly (e.g., Admins to Screen 3, Employees to a placeholder Dashboard).
    

### Screen 3: Organization Setup (Admin Only)

**Purpose:** The master control panel for defining the company structure. Must be wrapped in a route guard that blocks non-Admins.

*   **Tab A: Departments**
    
    *   **Data Grid:** Display a table of all departments showing Name, Head, Parent Dept, and Status.
        
    *   **Actions:** "Add New Department" modal. The form requires a Name string, an optional dropdown to select a parent\_department\_id, and a dropdown to select a head\_id (populated by querying the profiles table).
        
*   **Tab B: Categories**
    
    *   **Data Grid:** Display a simple list of Asset Categories.
        
    *   **Actions:** "Add Category" modal requiring just a Name string (and optionally defining keys for the JSONB attributes).
        
*   **Tab C: Employee Directory (Role Assignment)**
    
    *   **Data Grid:** Display all users from the profiles table showing Name, Email, Department, Role, and Status.
        
    *   **Actions:** This is the only interface where roles change. Clicking an employee opens a modal allowing the Admin to change their role dropdown to 'Department Head' or 'Asset Manager', and assign them to a specific department\_id.
        

5\. Definition of Done (Stage 1 Acceptance Criteria)
----------------------------------------------------

1.  I can create a new account via Screen 1, and my database automatically generates a profile record with the role of "Employee".
    
2.  I can manually set my user to "Admin" directly in the Supabase table (to bootstrap the system).
    
3.  Logging in as that Admin gives me access to Screen 3.
    
4.  From Screen 3, I can successfully create a Department ("Engineering") and an Asset Category ("Laptops").
    
5.  I can view my standard "Employee" account in the Tab C directory and successfully promote them to "Asset Manager".