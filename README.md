# Mini ATS

A small Applicant Tracking System: manage candidates, move them through hiring stages, search/filter, and view dashboard metrics.

## Features
- **Candidates**: add, edit, delete; validation (required fields, email format, duplicate email, experience range).
- **Hiring stages**: Applied → Screening → Interview → Offer → Hired / Rejected. Change a stage in the candidate dialog or by dragging cards on the **Board**. Every change is stored in a stage history.
- **Search & filter**: free-text search (name, email, role, skills, notes), filter by role and stage, sortable columns, pagination.
- **Dashboard**: totals, in-pipeline, hired/rejected, hire rate, new in last 7 days, average time to hire, candidates by stage, hiring funnel, by role, by source.

## Stack
Zero npm dependencies: Node.js 22.5+ (built-in `node:sqlite` and `http`) and a vanilla JS frontend.

## Run locally
```
npm start          # http://localhost:3000
npm test
```
Environment variables: `PORT`, `DB_FILE` (SQLite file path; default is in-memory), `SEED=0` to skip demo data.

## API
| Method | Path | Notes |
|---|---|---|
| GET | `/api/candidates?q=&stage=&role=&sort=&dir=&page=&pageSize=` | search/filter/sort/paginate |
| POST | `/api/candidates` | create |
| GET / PATCH / DELETE | `/api/candidates/:id` | detail (with history), update (incl. `stage`), delete |
| GET | `/api/metrics` | dashboard data |
| GET | `/api/meta` | stages and roles |

## Deploy
A `Dockerfile` is included; any Node host works (Render, Railway, Fly.io). Start command: `node lib/server.js`. Without `DB_FILE` on a persistent disk, data resets on restart and demo data is re-seeded.
