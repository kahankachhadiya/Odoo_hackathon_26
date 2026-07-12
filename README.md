# 📦 AssetFlow

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![React](https://img.shields.io/badge/React-18.x-blue?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)
![Supabase](https://img.shields.io/badge/Supabase-Cloud-43A047?logo=supabase)

**Enterprise Asset & Resource Management System** *Built during an 8-hour hackathon sprint.*

## 🚀 Overview

AssetFlow is a centralized ERP platform designed to simplify and digitize how organizations track, allocate, and maintain their physical assets and shared resources.

Built to replace manual spreadsheets and paper logs, AssetFlow provides real-time visibility into asset lifecycles, prevents double-allocations, and streamlines resource booking through a secure, role-based architecture.

### 🎯 The Hackathon Mission

This project was conceptualized, designed, and developed from scratch within an 8-hour window. Our primary technical focus was executing complex state management, strict mathematical overlap validation for bookings, and impenetrable backend security using PostgreSQL Row Level Security (RLS).

## ✨ Key Features

* **Strict Role-Based Access Control (RBAC):** Four distinct user tiers (Admin, Asset Manager, Department Head, Employee), governed entirely at the database level by Supabase RLS.
* **Conflict-Free Asset Allocation:** A robust backend constraint system that explicitly prevents the double-allocation of any physical asset, forcing transfer request workflows instead.
* **Smart Resource Booking:** Calendar-based booking for shared spaces (e.g., conference rooms) that mathematically blocks overlapping time slots.
* **Lifecycle State Machine:** Assets fluidly transition between dynamic states (*Available, Allocated, Reserved, Under Maintenance, Lost, Retired, Disposed*) based on user actions.
* **Automated Audits & Maintenance:** Kanban-style maintenance ticketing and streamlined, department-wide audit cycles with auto-generated discrepancy reports.

## 🛠 Tech Stack

**Frontend:**
* **Framework:** React (TypeScript)
* **Routing:** React Router v6
* **UI Components:** (Insert your UI library here, e.g., Shadcn UI / MUI)
* **Data Fetching:** `@supabase/supabase-js` v2

**Backend & Infrastructure:**
* **Database:** Supabase Cloud (PostgreSQL)
* **Authentication:** Supabase Auth
* **Security:** Native Postgres Row Level Security (RLS) & Database Triggers

## 🏗 Architecture Highlights

To ensure maximum security and efficiency during rapid development, we made several strict architectural decisions:

1. **RLS is the ONLY Authorization Layer:** The frontend never checks a user's role before a mutation. Postgres RLS policies independently evaluate the user's role directly in the database, rejecting unauthorized operations natively.
2. **Trigger-Based Profile Creation:** Profile records are not created by the frontend application. They are handled by a PostgreSQL database function and trigger that fires atomically when a new user signs up in the `auth.users` table.
3. **JSONB for Schema Flexibility:** The `asset_categories` table utilizes a `JSONB` column to store category-specific metadata. This prevented the need to write complex database migrations during the hackathon every time a new asset attribute was required.

## 🏁 Getting Started (Local Development)

### Prerequisites

* Node.js (v18+)

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/assetflow.git
cd assetflow
```

### 2. Set up Environment Variables

Create a `.env.local` file in the root directory and add your Supabase Cloud project credentials:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Run the Frontend

```bash
npm install
npm run dev
```

## 👨💻 Team

* Kahan Kachhadiya
* Darsh Dobariya
* Shyam Piparva

AssetFlow was built to demonstrate clean ERP architecture, reusable module design, and secure backend workflows at speed.
