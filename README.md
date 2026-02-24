# DBAuto

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
- **Real backup execution**: `pg_dump -Fc` (PostgreSQL), `mysqldump | gzip` (MySQL), `shutil.copy2` (SQLite)
- **Real restore execution**: `pg_restore` / `mysql` / file copy, run asynchronously via Celery
- **Real SFTP replication**: paramiko-based upload with `BackupReplication` status tracking per backup per host
- Retention enforcement with most-recent-success protection
- Audit logging for backup / restore / replication / deletion events
- Dashboard metrics with Redis cache
- Owner-filtered access with admin override

## Frontend Pages
- **Dashboard** — operational analytics (largest DBs, backup frequency, failure rate, growth)
- **Hosts** — four-tab interface: Storage Hosts · Databases · Backup Configs · Replication Policies
- **Backups** — backup table with per-row replication status, restore modal, and delete action

## Notes
- SQLite databases: set the `host` field to the absolute file path of the `.db` file.
- Restore runs asynchronously. For PostgreSQL/MySQL the target database is created if it does not exist.
- `pg_dump`, `pg_restore`, `mysqldump`, and `mysql` must be available in `PATH` on the server running the Celery worker. MySQL dumps are compressed using Python's built-in `gzip` module — no system `gzip` required.
- Manual backup trigger runs a preflight check and will return a clear API error if required backup binaries are missing.
- `paramiko` must be installed (`pip install paramiko`) for SFTP replication — it is included in `requirements.txt`.
