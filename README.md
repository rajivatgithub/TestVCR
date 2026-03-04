# TestVCR — Video Chat (Signaling + WebRTC)

A small, containerized video chat app: **Python backend** (FastAPI + Socket.IO) and **React frontend** (Vite + WebRTC + Socket.IO). All state is in memory (no database).

- **Backend**: `GET /health`, `GET /` (active rooms), Socket.IO for join/leave and WebRTC signaling.
- **Frontend**: Lobby with room list, create/join room, in-room video grid. **Leave Meeting** returns you to the lobby without reloading the page.

For full architecture, signaling flow, and limitations, see **[DESIGN.md](DESIGN.md)**.

---

## Quick start

### Docker (recommended)

```bash
docker-compose up --build
```

- Backend: http://localhost:8000  
- Frontend: http://localhost:5173  

Open the frontend, enter or pick a room, and join. Use **Leave Meeting** to go back to the lobby.

### Local

**Terminal 1 — backend**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn app.main:socket_app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 — frontend**

```bash
cd frontend
npm install
npm run dev
```

Set the frontend’s backend URL (e.g. `VITE_BACKEND_URL` or in `VideoRoom.jsx`) to `http://localhost:8000`.

---

## Project layout

| Path | Description |
|------|-------------|
| `backend/app/main.py` | FastAPI + Socket.IO, `leave_room` + other events |
| `frontend/src/VideoRoom.jsx` | Lobby, WebRTC, Leave Meeting (no reload) |
| `docker-compose.yml` | Backend :8000, frontend :5173 |
| `vercel.json` | Vercel: backend + frontend, rewrites for `/socket.io`, `/api` |
| `DESIGN.md` | Full design, NAT/TURN notes, scalability |

---

## Backend Socket.IO

- `connect` — sends room list to client  
- `join_room` — add to room, emit `room_list_update` and `user_joined`  
- **`leave_room`** — remove from room, emit `user_left` and `room_list_update` (used by Leave Meeting)  
- `signal` / `signal_broadcast` — WebRTC signaling  
- `disconnect` — cleanup and room list update  

---

## Deployment (Vercel)

Connect the repo; `vercel.json` builds the Python backend and static frontend and rewrites `/socket.io` and `/api` to the backend.
