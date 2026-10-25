# TraceLens — Asynchronous API Monitoring & Incident Detection

TraceLens is a monitoring platform that ingests application logs and metrics asynchronously, detects repeated error bursts, and tracks incidents through a web dashboard.

## Features

- REST API for application logs, metrics, services, and incidents
- RabbitMQ-based asynchronous message processing
- Node.js/TypeScript workers for log and metric persistence
- PostgreSQL storage for logs, metrics, services, and incidents
- Automatic detection of repeated error bursts
- Incident severity and lifecycle management
- React dashboard with incident filtering and status actions
- Docker Compose deployment

## Technology Stack

- **Frontend:** React, TypeScript, Vite
- **Backend:** Node.js, Express, TypeScript
- **Database:** PostgreSQL
- **Message broker:** RabbitMQ
- **Workers:** Node.js, TypeScript
- **Deployment:** Docker and Docker Compose

## Architecture

1. Applications submit logs and metrics through the API.
2. The backend validates incoming data and publishes messages to RabbitMQ.
3. Workers consume messages and persist the data to PostgreSQL.
4. The incident detector evaluates error activity and creates incidents when configured thresholds are reached.
5. The dashboard retrieves incident and metric data through the API.
6. Operators investigate and resolve incidents through the dashboard.

## Prerequisites

- Node.js and npm for local development
- Docker Desktop with Docker Compose
- Git

## Run with Docker

Clone the repository, enter the project directory, and configure the root `.env` file with the required PostgreSQL credentials and application settings.

Build and start the stack:

```powershell
docker compose up -d --build
```

Inspect container status:

```powershell
docker compose ps
```

View application logs:

```powershell
docker compose logs --tail=100 backend log-worker metrics-worker
```

Stop the stack:

```powershell
docker compose down
```

This preserves named database volumes. To remove persisted data as well, Docker volumes must be explicitly removed; do so only when you intend to erase stored data.

## Local Development

Start the backend:

```powershell
cd backend
npm install
npm run dev
```

Start the frontend in another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Start the workers in separate terminals:

```powershell
cd workers
npm install
npm run dev
```

For the metrics worker, use:

```powershell
npm run dev:metrics
```

Local development requires PostgreSQL, RabbitMQ, and the root environment variables to be configured and reachable.

## Service URLs

| Component | URL |
|---|---|
| Dashboard (Docker) | http://localhost:8081 |
| Backend health | http://localhost:3000/health |
| Incident API | http://localhost:3000/api/incidents?limit=100 |
| RabbitMQ management | http://localhost:15672 |
| PostgreSQL host port | `5433` |

Port mappings can vary depending on the local environment and Compose configuration.

## API Overview

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/services` | List services |
| GET | `/api/services/:name` | Get service details |
| POST | `/api/validate-log` | Validate a log payload |
| POST | `/api/logs` | Submit a log asynchronously |
| GET | `/api/logs` | Retrieve persisted logs |
| GET | `/api/incidents` | List incidents |
| GET | `/api/incidents/:id` | Get incident details |
| PATCH | `/api/incidents/:id/status` | Update incident status |

Incident transitions supported by the current implementation include `OPEN → INVESTIGATING`, `OPEN → RESOLVED`, and `INVESTIGATING → RESOLVED`.

## Testing and Build

Run backend tests and TypeScript checks:

```powershell
cd backend
npm test
npm run typecheck
npm run build
```

Build the frontend:

```powershell
cd frontend
npm run build
```

Build the workers:

```powershell
cd workers
npm run build
```

## Example Incident Scenario

1. Submit repeated `ERROR` logs for a registered service.
2. Confirm the log worker persists the messages.
3. Wait for the incident detector to evaluate recent errors.
4. Inspect the generated incident in the API or dashboard.
5. Mark the incident as `INVESTIGATING`.
6. Resolve it and verify that `resolved_at` is populated.

The detector's configured threshold and evaluation window determine when an incident is generated.

## Security and Configuration

- Keep `.env` files and credentials out of version control.
- Change development-only credentials before any shared or production deployment.
- Configure allowed CORS origins for the intended deployment environment.
- Add authentication and authorization before exposing management or incident APIs publicly.
- Use bounded retry policies and dead-letter handling for production message processing.

## Project Status

The core API, asynchronous processing pipeline, incident lifecycle, dashboard, and Docker deployment have been implemented and verified in the development environment. Further production hardening and integration testing remain areas for improvement.
