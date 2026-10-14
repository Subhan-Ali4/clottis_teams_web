# Simple Authentication + Task Kanban: Vertical Slices

Slice 1 (KAN-5): Owner/Admin-managed user accounts with email + password login, cookie sessions, and role-aware routes.
Slice 2 (KAN-15): task management and a Kanban board, built in the same project on top of those users and sessions. See [Tasks and Kanban](#tasks-and-kanban-kan-15).

**Stack:** Node.js + Express + SQLite (backend), React + Vite (frontend). Needs **Node 22.13 or newer** (Node 24 works). SQLite is Node's built-in one, so `npm install` compiles nothing and needs no Visual Studio or Windows SDK.

## Run it

Two terminals.

```bash
# 1) Backend  (http://localhost:4000)
cd backend
npm install
OWNER_NAME="Your Name" OWNER_EMAIL=you@example.com OWNER_PASSWORD='choose-a-long-password' npm run seed:owner
npm start

# 2) Frontend (http://localhost:5173)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and sign in with the Owner you seeded. Database changes are applied automatically on start (see Migrations below). The seed step is needed once because there is no public sign-up: users only exist when an Owner/Admin creates them.

On Windows PowerShell, set the variables first: `$env:OWNER_NAME="Your Name"; $env:OWNER_EMAIL="you@example.com"; $env:OWNER_PASSWORD="choose-a-long-password"; npm run seed:owner`

## Run the tests

```bash
cd backend  && npm test     # 50 tests: auth (25) + tasks, movement, migrations (25)
cd frontend && npm test     # 37 tests: auth UI (16) + board, drag and drop, task forms (21)
```

## Acceptance criteria → tests

| Acceptance criterion | Covered by (backend `tests/auth.test.js`) |
|---|---|
| Created user can log in with the generated password | "Owner creates a user and that user can log in with the generated password" |
| Wrong credentials rejected safely | "wrong password and unknown email get the same generic 401" |
| Duplicate email rejected safely | "duplicate email is rejected, case-insensitively, without changing the original user" |
| Password change invalidates the old password | "changing password invalidates the old password and enables the new one" |
| Deactivated users cannot continue authenticated access | "deactivated users lose access immediately and cannot log in…", "…session row still exists is still refused" |
| Member cannot perform Owner/Admin actions | "Member cannot perform any Owner/Admin action" |
| Session survives refresh, logout ends access | "session survives repeated requests", "logout ends access, and the old cookie cannot be replayed"; frontend: "keeps the session across a refresh" |
| Never store/log plaintext passwords | "only a hash is stored: plaintext never appears in the database" |

## API

| Method & path | Who | What |
|---|---|---|
| `POST /api/auth/login` | anyone | Email + password. Sets the session cookie. |
| `POST /api/auth/logout` | anyone | Deletes the session, clears the cookie. |
| `GET /api/auth/me` | signed in | Current user. |
| `POST /api/auth/change-password` | signed in | `currentPassword`, `newPassword`. Signs out the user's other sessions. |
| `GET /api/users` | Owner, Admin | List users. |
| `POST /api/users` | Owner, Admin | `name`, `email`, `role`. Returns the generated password once. |
| `POST /api/users/:id/reset-password` | Owner, Admin | New generated password (returned once). Signs the user out everywhere. |
| `PATCH /api/users/:id/status` | Owner, Admin | `{ "isActive": true/false }`. Deactivating ends all of the user's sessions. |

## How it is secured

- **Passwords:** scrypt with a random salt per user. Only the hash is stored; no password is logged or written to a file. The generated password appears only in the one API response that creates or resets it.
- **Sessions:** random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when `NODE_ENV=production` or `COOKIE_SECURE=true`). The database stores only a SHA-256 of the token. Sessions last 7 days.
- **Deactivation is immediate:** every request re-checks the session and that the user is still active.
- **Login errors:** wrong password and unknown email give the same message, and take the same time.
- **CSRF:** every state-changing request must carry an `X-Requested-With` header (the frontend adds it), on top of `SameSite=Lax`.

## Decisions I made where the brief was silent

| Topic | Choice |
|---|---|
| First Owner | Created with the seed script; password comes from an env variable and is never printed. |
| Roles | `owner`, `admin`, `member`. Admins can create/manage admins and members but not Owners. Only an Owner can create an Owner. |
| Self-protection | You cannot deactivate yourself, and you reset your own password through "Change password". |
| Password rule | 8 to 128 characters for passwords a user chooses. |
| Users page | The frontend scope listed login, create-user, change-password and logout. I added a small users table on the Create user page so Reset password and Activate/Deactivate can actually be used. Remove `Users.jsx`'s table section if sir wants only the listed pages. |
| Real email | Format is validated and duplicates are blocked (case-insensitive). Whether the mailbox exists cannot be checked because email verification is out of scope. |

## Out of scope (not built, as specified)

Email verification or recovery, OTP/2FA/social login, mandatory first-login password change, email provider setup. Login rate limiting is also not included.

---

# Tasks and Kanban (KAN-15)

Everything below is inside this same project: Express + SQLite backend, React frontend, same login and cookie session.

## Migrations and demo data

Schema changes live in `backend/src/migrations.js` and run once each, in order, every time the backend starts (recorded in the `schema_migrations` table). An existing `data.sqlite` from slice 1 is upgraded in place; nothing is lost.

| Migration | What it does |
|---|---|
| `001_auth_baseline` | The users and sessions tables from slice 1 (no change for existing databases) |
| `002_tasks_schema` | `projects`, `sprints`, `board_columns`, `tasks`, `task_activity` |
| `003_seed_demo_data` | Demo users (for assignee and reviewer), two projects with sprints and 4 board columns each, and 5 sample tasks |

**Demo users** (all use the password `DemoPass#2026`; only a hash is stored): Demo Admin `admin.demo@example.com` (admin), Aisha Khan `aisha.demo@example.com`, Bilal Ahmed `bilal.demo@example.com`, Sara Malik `sara.demo@example.com` (members). This password is public in this README, so it is for demos only. To skip migration 003, start the backend with `SEED_DEMO_DATA=false` (PowerShell: `$env:SEED_DEMO_DATA="false"`). It is then skipped without being recorded, so it can still be applied later.

## Using it

Sign in, then use **Board** (Kanban) or **Tasks** (list) in the top menu. Create tasks with **New task**. Drag a card to another column or to another place in the same column; the blue line shows where it will land. Each card also has a "move to column" dropdown for keyboard and touch use. Click a card title to see the task detail and its activity history.

## Tasks API

All routes need a signed-in user (any role) and, for writes, the `X-Requested-With: XMLHttpRequest` header, like the rest of the API.

| Method & path | What |
|---|---|
| `GET /api/projects` | Projects with their ordered `columns` and `sprints` |
| `GET /api/directory/users` | Active users (`id`, `name`, `role` only) for the assignee and reviewer pickers |
| `GET /api/tasks` | List. Filters: `projectId`, `sprintId` (or `none`), `columnId`, `assigneeId`, `priority`. Ordered by column, then position |
| `GET /api/tasks/:id` | `{ task, activity }` |
| `POST /api/tasks` | Create. Needs `title` and `projectId`; the task goes to the bottom of `columnId` (default: the project's first column) |
| `PATCH /api/tasks/:id` | Update the fields you send. **Needs `version`.** Sending a different `columnId` moves the task to the bottom of that column |
| `POST /api/tasks/:id/move` | `{ columnId, position, version }`: move to a column at an index. Writes a `moved` activity entry |

Task fields: `title` (1 to 200), `description`, `projectId`, `sprintId`, `columnId`, `priority` (`low` `medium` `high` `urgent`, default `medium`), `dueDate` (`YYYY-MM-DD`), `assigneeId`, `reviewerId`, `acceptanceCriteria`. Responses also carry `version`, `position`, and expanded `project`, `sprint`, `column`, `assignee`, `reviewer`, `createdBy`.

### Ordering

Each column keeps its tasks numbered `0..n-1` with no gaps, stored in the database, so the order is the same after a refresh and for every user. `position` in a move is the index the card should have in the target column once it has left its old place (so `0` is the top, and the largest allowed value is the number of other cards in that column, which is the bottom).

### Stale-update protection and the conflict response

Every task has an integer `version`, starting at 1 and bumped by every update or move. `PATCH` and `/move` must send the `version` the client last saw.

- Version matches: the change is applied and the new task (with the new version) is returned.
- Version is older: **`409 Conflict`**, nothing is changed, and the body is
  `{ "error": "...", "code": "VERSION_CONFLICT", "current": { ...the latest task... } }`.
  The client can show the difference, then retry with `current.version`. The web app does this: the board reloads, and the edit form keeps what you typed and offers "Load the latest version".
- Version missing: `400` with `fields.version`.
- Moving other cards around does not change their version, so reordering a column never causes false conflicts on cards someone else is editing.

### Validation errors

`400` with `{ "error": "Please fix the highlighted fields", "code": "VALIDATION_ERROR", "fields": { "<field>": "<message>" } }`. The web forms show each message next to its field. Invalid relationships that are rejected:

- a project that does not exist, or changing a task's project after creation
- a sprint or board column that belongs to a different project (or does not exist)
- an assignee or reviewer that does not exist or is deactivated
- a reviewer who is the same person as the assignee
- a move to a column of another project, or to a position outside `0..n`

## Decisions I made where the brief was silent

| Topic | Choice |
|---|---|
| Who can use tasks | Any signed-in user can view, create, edit and move tasks. Owner/Admin-only rules were not in the brief. |
| Shared API contract | None was available, so the contract above is the documented one. Field names are camelCase, errors use `code` and `fields`, conflicts use 409. It can be changed to match a team contract. |
| Board columns | Per project. Demo projects use To Do, In Progress, In Review, Done. There is no column editor (not in scope). |
| Reviewer | Must be a different person from the assignee. |
| Project of a task | Fixed after creation, because its sprint and column belong to the project. |
| Delete | No delete: the brief lists create, update, list and detail only. |
| Same-spot drop | Dropping a card where it already is does nothing: no new version and no activity entry. |
| Activity | Three types: `created`, `updated` (what changed, old to new), `moved` (from/to column and position). |

## Out of scope for tasks (not built, as specified)

Comments and chat, files and attachments, notifications and SSE, multiple collaborators and dependencies, complex task visibility and time tracking.
