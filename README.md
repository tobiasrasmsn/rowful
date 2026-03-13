# Rowful

Rowful is a self-hosted spreadsheet workspace for teams and operators who still run real work out of Excel files.

It lets you import `.xlsx` workbooks, edit them in the browser, organize spreadsheet ranges as Kanban boards, and send row-based emails using saved SMTP profiles. The app is designed to run on your own VPS with Docker, Caddy, and SQLite.

## Highlights

- Import `.xlsx` workbooks
- Create blank workbooks in the browser
- Edit sheets, cells, formatting, rows, and columns
- Work across multi-sheet files
- Turn spreadsheet ranges into Kanban boards
- Save reusable SMTP profiles
- Send templated emails from spreadsheet data
- Manage custom domains through Caddy
- Run everything as a self-hosted Docker deployment

## Stack

### Frontend

- React 19
- TypeScript
- Vite
- Zustand
- Tailwind CSS v4
- `@revolist/react-datagrid`
- `@dnd-kit/react`

### Backend

- Go 1.25
- Chi
- SQLite
- `excelize`

### Deployment

- Docker Compose
- Caddy
- Nginx for static frontend serving

## Project Structure

```text
.
├── backend/              Go API, auth, storage, formulas, email, domain logic
├── frontend/             React/Vite app
├── caddy/                Base Caddy config and generated domain includes
├── docker-compose.yml    Production-style local/self-hosted stack
├── Dockerfile.backend    Backend container image
├── Dockerfile.frontend   Frontend container image
└── install.sh            Easy VPS installer for Ubuntu/Debian
```

## How Rowful Works

Rowful imports Excel workbooks into its own storage model.

- Uploaded `.xlsx` files are stored on disk
- Workbook structure, cells, formulas, formatting, Kanban regions, and settings are persisted in SQLite
- The browser loads sheet windows on demand instead of loading every cell at once
- Workbook ownership is scoped per user
- SMTP credentials are encrypted at rest using `APP_ENCRYPTION_KEY`

At the moment, Rowful is strongest as a browser workspace built from Excel files, not as a round-trip Excel editor. It imports `.xlsx` well, but it does not currently export edited workbooks back to `.xlsx`.

## Features

### Workbooks

- User accounts with persistent sessions
- Per-user workbook library
- Recent files
- Blank workbook creation
- `.xlsx` import
- Rename and delete stored workbooks

### Spreadsheet Editing

- Multi-sheet workbook support
- Cell editing
- Row and column insert/delete
- Sheet create/rename/delete
- Range, row, column, and sheet formatting
- Clear formatting and clear values
- Formula bar and cell inspector

### Formula Support

Rowful stores formulas separately and recalculates supported formulas on the backend.

Currently supported:

- `SUM`
- `AVERAGE`
- `MIN`
- `MAX`
- `COUNT`
- `COUNTA`
- `IF`
- `ROUND`
- `ABS`
- `LEN`
- `SUMIF`
- `AVERAGEIF`
- `INDEX`
- `MATCH`

Unsupported formulas from imported files may still be preserved, but they are not fully evaluated by Rowful.

### Kanban Views

- Create Kanban regions from a selected spreadsheet range
- Choose title and status columns
- Drag cards between columns
- Reorder cards
- Extend Kanban regions
- Configure visible fields
- Apply simple color mapping to cards or columns

### Email Workflows

- Save SMTP profiles per user
- Assign an email profile to a workbook
- Send a test email from workbook settings
- Detect email addresses inside selected ranges
- Use placeholders like `{name}` or `{HeaderName}` from row data
- Queue outbound emails with throttling

### Domains and Deployment

- DNS verification against configured public IPs
- Caddy config generation for managed domains
- Caddy reload through the admin API
- HTTPS-ready self-hosted deployment flow

## Production Setup

The recommended production path is [install.sh](/Users/tobiasrasmussen/Desktop/Rasmussen Solutions/Projects/planarv1/install.sh).

It is an opinionated Ubuntu/Debian VPS installer that:

- installs Docker and the Compose plugin if needed
- clones the repository to `/opt/rowful` by default
- prepares runtime data directories
- generates an `.env`
- builds and starts the containers
- prints the app URL, backend URL, and healthcheck URL

Run it on a fresh server like this:

```bash
chmod +x install.sh
./install.sh
```

Optional install location:

```bash
ROWFUL_INSTALL_DIR=/srv/rowful ./install.sh
```

After install, the stack runs as:

- `backend` on port `8080`
- `frontend` behind Nginx
- `caddy` on ports `80` and `443`

## Docker Compose

If you want to manage the stack yourself, you can run it directly with Compose.

Create a `.env` file at the project root:

```bash
APP_ENCRYPTION_KEY=replace-with-a-long-random-secret
PUBLIC_IPS=203.0.113.10
ALLOWED_ORIGINS=http://localhost,http://127.0.0.1,http://localhost:5173,http://127.0.0.1:5173
```

Then start the app:

```bash
docker compose up -d --build
```

Persistent data is stored in:

- `./data`
- `./caddy/data`
- `./caddy/config`

## Local Development

The frontend and backend are separate apps.

### Backend

```bash
cd backend
export APP_ENCRYPTION_KEY="replace-with-at-least-32-characters"
export ALLOWED_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"
go run ./main.go
```

### Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173).

Vite proxies `/api` to `http://localhost:8080` by default. If your backend runs elsewhere, set:

```bash
VITE_DEV_API_PROXY_TARGET=http://your-backend-host:port
```

## Configuration

### Backend

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Backend HTTP port |
| `MAX_FILE_SIZE_MB` | `25` | Upload size limit |
| `ALLOWED_ORIGINS` | localhost Vite URLs | CORS allowlist |
| `DB_PATH` | `./rowful.db` | SQLite file path |
| `UPLOAD_DIR` | `./uploads` | Uploaded workbook storage |
| `APP_ENCRYPTION_KEY` | required | Encrypts stored SMTP secrets |
| `PUBLIC_IPS` | empty | Used for domain DNS checks |
| `CADDY_ADMIN_URL` | `http://caddy:2019` | Caddy admin API |
| `CADDY_CONFIG_PATH` | `/etc/caddy/Caddyfile` | Base Caddyfile path |
| `CADDY_SITES_PATH` | `/etc/caddy/sites` | Generated site config directory |

`APP_ENCRYPTION_KEY` must be set and must be at least 32 characters.

### Frontend

| Variable | Purpose |
| --- | --- |
| `VITE_DEV_API_PROXY_TARGET` | Dev proxy target for `/api` |
| `VITE_API_BASE_URL` | Explicit API base URL for containerized/frontend deployments |

## Auth and Ownership

- The first user to sign up becomes an admin
- Sessions are cookie-based
- Mutating requests require a CSRF token
- Workbooks are scoped to the owning user

## Domain Management

Rowful can manage custom domains when it is running behind Caddy.

Typical flow:

1. Set `PUBLIC_IPS` to your server IPs
2. Point a domain to the server with `A` and/or `AAAA` records
3. Check DNS from the Rowful admin UI
4. When the records match, let Rowful generate and load the Caddy site config

## Testing

### Backend

```bash
cd backend
go test ./...
```

### Frontend

```bash
cd frontend
pnpm typecheck
pnpm build
pnpm lint
```

## Current Notes

- `.xlsx` import is supported
- Edited workbooks are stored in Rowful's database model
- `.xlsx` export is not implemented yet
- Real-time collaboration is not implemented
- Formula coverage is partial by design
- There is allowlist/invite-related code in the project, but the main signup flow is still effectively open after first-user bootstrap

## Status

Rowful is already a working product for self-hosted spreadsheet workflows, especially where Excel files are used as the starting point for browser editing, task tracking, and operational email sends.
