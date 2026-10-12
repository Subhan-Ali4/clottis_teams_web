# Simple Authentication: Vertical Slice

Owner/Admin-managed user accounts with email + password login, cookie sessions, and role-aware routes.

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

Open http://localhost:5173 and sign in with the Owner you seeded. The seed step is needed once because there is no public sign-up: users only exist when an Owner/Admin creates them.

On Windows PowerShell, set the variables first: `$env:OWNER_NAME="Your Name"; $env:OWNER_EMAIL="you@example.com"; $env:OWNER_PASSWORD="choose-a-long-password"; npm run seed:owner`

## Run the tests

```bash
cd backend  && npm test     # 25 tests: API success flows + access-denial paths
cd frontend && npm test     # 16 tests: route protection, role-aware UI, form errors
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
