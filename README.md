# PGJ Booking System

The PGJ (Personal Growth Journey) Booking System is a web-based scheduling platform built for Anglo Singapore International School. It allows parents to book Parent-Teacher meetings online through a dedicated interface, and provides school administrators with a comprehensive dashboard to manage teacher schedules, blocked times, parent logins, and dynamic PDF/Email templates.

## System Architecture

**Current Stack:**
* **Backend Framework:** Node.js with Express.js
* **Database:** Microsoft SQL Server (MSSQL) using the `mssql` driver
* **Session Management:** `express-session` 
* **Templating Engine:** EJS (`express-ejs-layouts`)
* **Process Manager:** PM2 (for production deployment)

### Process Flow
1. **Parent Portal (`/booking`):** Parents log in using their child's Student ID. The system queries the `Students` table and generates a session. Parents select an available teacher and time slot based on `TeacherAvailability` and `TimeSlots`. 
2. **Booking Engine:** Bookings are processed via pessimistic locking (`UPDLOCK`, `ROWLOCK` in T-SQL) to prevent double-booking. Confirmation emails and PDF itineraries are automatically generated.
3. **Admin Dashboard (`/admin`):** Secured by a tiered role system (`ADMIN` and `SUPER_ADMIN`). Administrators can manage system configurations, translate UI text dynamically, oversee bookings, and generate advanced reports.

---

## 🎨 Frontend Modernization Roadmap

### Frontend
- **Framework**: Bootstrap 5 + Vanilla JavaScript
- **Styling**: Custom Premium Design System (`style.css`), Google Fonts (Inter)
- **Icons**: Bootstrap Icons
- **Data Tables**: DataTables.js (for search, pagination, and sorting)
- **Templating**: EJS

### Proposed Modern UI Stack
To achieve a "WOW" factor and rich aesthetics without entirely rewriting the Express backend, we will integrate:

1. **Tailwind CSS:** Replacing standard Bootstrap with Tailwind to allow for highly customizable, utility-first styling. We will use curated, harmonious color palettes (deep blues, sleek whites, and glassmorphism accents).
2. **Alpine.js:** Replacing Vanilla JS for frontend interactivity. Alpine provides reactive, declarative data binding directly in our EJS HTML, perfect for smooth micro-animations, modals, and dynamic form validation.
3. **Modern Typography & Micro-Animations:** Implementing fonts like *Inter* or *Outfit* from Google Fonts, alongside CSS transition effects for hover states, loading skeletons, and seamless page transitions.

### Aesthetic Goals
* **Vibrant & Clean:** Move away from generic colors. The UI will reflect the school's branding with a premium, polished feel.
* **Responsive Design:** 100% mobile-friendly interfaces, ensuring parents can book easily from smartphones.
* **Interactive Elements:** Smooth button transitions, dynamic dropdowns, and clear visual feedback for all booking actions.

---

## Installation & Setup (Local)

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Configure your environment variables in a `.env` file (Database, SMTP, etc.).
3. Start the application:
   ```bash
   npm run dev
   ```

## Contribution & Git Workflow
To ensure stability, **all new features and modifications MUST be developed on dedicated branches** (e.g., `feature/modernize-system`). Direct pushes to `main` are restricted. All changes require explicit confirmation and review before being committed or merged.
