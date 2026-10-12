p# Worklink

A minimal Node.js starter app for the Worklink project.

## Getting started

1. Install dependencies:
   npm install
2. Start the server:
   npm start
3. Visit the frontend in your browser:
   - http://localhost:3000/
4. API endpoints are available at:
   - http://localhost:3000/health
   - http://localhost:3000/jobs

## Frontend UI

The app serves a simple browser-based dashboard at `/` that lets you log in, create jobs, and update status/priority without leaving the page.

## Authentication

The job API is protected by bearer-token authentication.

1. Log in with one of the default local accounts:
   - `admin` / `admin` (admin access)
   - `manager` / `manager` (manager access)
   - `member` / `member` (read-only access)
2. Call `POST /login` to receive a token.
3. Include the token as:
   `Authorization: Bearer <token>`
4. Use that header for all `/jobs` requests.

The default admin account can be overridden with `WORKLINK_USERNAME`, `WORKLINK_PASSWORD`, and `WORKLINK_SECRET` environment variables.

## Roles and permissions

The app supports three user roles:

- `admin`: can create and update jobs
- `manager`: can create and update jobs
- `member`: can view jobs but cannot create or edit them

The server exposes `GET /me` to return the current user and role from the bearer token.

## Job API

The project uses SQLite for persistent job storage in the local `data/worklink.sqlite` file.

Examples:

- GET /jobs
- POST /jobs with `{ "title": "Build landing page", "description": "Create the homepage hero", "status": "queued", "priority": "high", "assignee": "alice" }`
- GET /jobs/:id
- PATCH /jobs/:id with `{ "status": "in_progress", "priority": "low" }`

Supported job fields:

- `title` (required)
- `description`
- `status` (`queued`, `in_progress`, `done`, `blocked`)
- `priority` (`low`, `medium`, `high`)
- `assignee`

## Testing

npm test

## Notes

This starter includes a minimal HTTP server with health checks, authentication, role-based permissions, SQLite-backed job storage, and basic tests.
