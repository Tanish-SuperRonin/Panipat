# Panipat Sports Event (React + Node)

## What you get

- React UI (Vite) with role-based views (Admin / Captain / Player)
- Admin can:
  - update standings/scoreboard
  - create fixtures/games
  - broadcast chat to all teams or message one team
- Captains/Players:
  - see dashboard with standings + fixtures
  - see chat messages (broadcast + their team)
- Node backend (Express) with Socket.IO for live updates (in-memory storage)

## Run (Windows)

Open two terminals:

### Terminal 1 (backend)

```bash
cd c:\Panipat\server
npm install
npm run dev
```

Backend runs on `http://localhost:3001`.

### Terminal 2 (frontend)

```bash
cd c:\Panipat
npm install
npm run dev
```

Frontend runs on `http://localhost:5173` and proxies `/api` + websockets to the backend.

## Notes

- Data is stored in memory for now (restarts will reset). If you want persistence, next step is adding a database (MongoDB/Postgres).

