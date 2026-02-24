# Database Hoarder

A multi-tenant Database Backup Automation platform.

## Stack
- Backend: Django + DRF + SimpleJWT + Celery + Redis + SQLite (dev default, PostgreSQL-ready)
- Frontend: React (Vite + TypeScript) + Tailwind + Framer Motion + CVA

## Core Concepts

| Concept | Description |
|---|---|
| **Storage Host** | An SSH server used purely to store replicated backup files. Defined by name, address, SSH port, username, and password. Has no dependency on databases. |
| **Database** | A database to be backed up, defined by name, type (PostgreSQL / MySQL / SQLite), host address, port, username, and password. Entirely separate from storage hosts. |
| **Backup Config** | A backup schedule attached to a single database (frequency in minutes, retention in days). Backups are stored **locally** on the server by default. |
| **Replication Policy** | An opt-in rule that copies a successful local backup to a Storage Host via SFTP. Replication only occurs when a policy exists for a config. |

## Quick Start

### Backend
1. `cd backend`
2. `python -m venv venv`
3. `venv\Scripts\activate`
4. `pip install -r requirements.txt`
5. `copy .env.example .env`
6. `python manage.py migrate`
7. `python manage.py createsuperuser`
8. `python manage.py runserver`

Run workers in separate terminals (also from `backend/` with the venv active):
- `celery -A config worker -l info`
- `celery -A config beat -l info`

> **Windows / Python 3.14 note**: `billiard`'s multiprocessing pool crashes on Python 3.14 due to a WMI API change. `CELERY_WORKER_POOL = "solo"` is set in `settings.py` to work around this — tasks run in the main worker process instead of subprocesses.

### Frontend
1. `cd frontend`
2. `npm install`
3. `npm run dev`
4. Open `http://localhost:5173/login`
5. Sign in with your Django superuser credentials

## API Endpoints

| Prefix | Resource |
|---|---|
| `POST /api/auth/token/` | Obtain JWT token pair |
| `POST /api/auth/token/refresh/` | Refresh access token |
| `GET /api/users/password-rules/` | List active password requirements |
| `GET/POST /api/users/access-profiles/` | Access profile CRUD |
| `GET/POST /api/hosts/storage-hosts/` | Storage host CRUD |
| `GET/POST /api/hosts/databases/` | Database CRUD |
| `GET/POST /api/hosts/configs/` | Backup config CRUD |
| `GET/POST /api/hosts/replication-policies/` | Replication policy CRUD |
| `GET /api/backups/` | List backups (with replication status) |
| `POST /api/backups/{id}/restore/` | Trigger async restore |
| `DELETE /api/backups/{id}/manual_delete/` | Delete backup file and record |
| `GET /api/dashboard/metrics/` | Dashboard analytics (Redis-cached) |

## Implemented Scope
- JWT auth with custom user model (`ADMIN` / `USER` roles)
- **Storage Hosts**: SSH servers registered independently of databases
- **Databases**: DB connection CRUD (PostgreSQL, MySQL, SQLite) with encrypted password storage
- **Backup Configs**: Per-database schedule + retention, with Celery beat scheduler
- **Replication Policies**: Per-config SFTP replication to storage hosts (opt-in, post-backup)
- **Password UX**: Settings page now displays server-enforced password rules before submit, and password changes use Django password validators for clear errors.
- **Scalable access rights**: Reusable Access Profiles can be assigned to users and grant hosts/databases/configs in bulk, with optional per-user direct grant overrides.
- **Backup execution**: Configurable engine mode for PostgreSQL/MySQL — Python modules, Native CLI, or Auto (prefer native). Native mode provides production-grade parity with `pg_dump`/`mysqldump` and `pg_restore`/`mysql`.
- **SQLite backup/restore**: `shutil.copy2` file copy, run asynchronously via Celery
- **Real SFTP replication**: paramiko-based upload with `BackupReplication` status tracking per backup per host
- Retention enforcement with most-recent-success protection
- Audit logging for backup / restore / replication / deletion events
- Dashboard metrics with Redis cache
- Owner-filtered access with admin override
- Profile-based + direct-grant resource authorization through a single access filter path

## Frontend Pages
- **Dashboard** — operational analytics (largest DBs, backup frequency, failure rate, growth)
- **Hosts** — four-tab interface: Storage Hosts · Databases · Backup Configs · Replication Policies
- **Backups** — backup table with per-row replication status, restore modal, and delete action

## Notes
- SQLite databases: set the `host` field to the absolute file path of the `.db` file.
- Restore runs asynchronously. For PostgreSQL/MySQL the target database is created if it does not exist.
- Backup Engine Mode is configurable from **Settings** (admin) and also via `BACKUP_EXECUTION_MODE` (`python`, `native`, or `auto`) as environment fallback.
- For production-grade parity with native database dump/restore semantics, use `native` (or `auto` when tools are installed).
- In `native` mode, manual backup preflight checks fail early when required DB CLI tools are not available.
- `paramiko` must be installed (`pip install paramiko`) for SFTP replication — it is included in `requirements.txt`.
