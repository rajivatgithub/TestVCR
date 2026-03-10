## Overview

This project is a small, containerized video chat application composed of a **Python backend** (FastAPI + Socket.IO) and a **React frontend** (Vite + WebRTC + Socket.IO client). It is designed primarily as a signaling server and WebRTC client demo, with all state stored in memory (no database).

At a high level:

- **Backend** exposes:
  - A health endpoint (`GET /health`) for monitoring.
  - A lobby endpoint (`GET /`) that lists currently active rooms.
  - Socket.IO events for joining/leaving rooms and exchanging WebRTC signaling messages between peers.
- **Frontend** is a single-page React app that:
  - Shows a lobby of active rooms.
  - Lets a user create or join a room.
  - Manages local/remote media streams and WebRTC peer connections.
- **limitations**
  - Only two participants in a room. 
    - Note: no code check is added yet, but a simple check in function `handle_join_room` should suffice.
  - No explicit join functionality exist
    - user can either crete a room or join a room, joining a room is equivalen to creating a connection
    - both audio and video streams are allowed and user can disable either while maintinaing the connection.

Everything can run locally via `docker-compose` (backend on port `8000`, frontend on port `5173`), or be deployed to Vercel using the provided `vercel.json`.

---

## Directory Structure

- `backend/`
  - `app/main.py` — FastAPI app, Socket.IO server, in-memory room tracking, and ASGI wrapper.
  - `requirements.txt` — Python dependencies (`fastapi`, `uvicorn`, `python-socketio`, `aiortc`, `python-dotenv`, etc.).
  - `tests/test_main.py` — Basic HTTP and Socket.IO tests.
- `frontend/`
  - `src/App.jsx` — Root React component, renders `VideoRoom`.
  - `src/VideoRoom.jsx` — Main UI and WebRTC/Socket.IO client logic.
  - `vite.config.js` — Vite configuration.
  - `package.json` — Frontend dependencies and scripts.
- `docker-compose.yml` — Local dev orchestration for backend and frontend.
- `infra/docker-compose.yml` — Alternate compose file (similar to root); useful for infra-specific setups.
- `vercel.json` — Vercel deployment configuration for backend and frontend.

---

## Backend Design

### Technologies

- **FastAPI** for HTTP endpoints.
- **python-socketio** (`AsyncServer` + `ASGIApp`) for real-time signaling over WebSocket.
- **Uvicorn** as the local ASGI server (via `__main__` block).

### Application Shape

`backend/app/main.py` currently serves as a single-module backend that wires everything together:

- **FastAPI app** (`app`) with:
  - `GET /health` → `{"status": "ok"}` for probes/monitoring.
  - `GET /` → `{"rooms": [...]}` listing active rooms for the lobby.
- **Socket.IO server** (`sio`) with events:
  - `connect` — logs new connections and sends the current room list to the new client.
  - `join_room` — joins the client to a room, updates the global `active_rooms`, and emits:
    - `room_list_update` to all clients.
    - `user_joined` to participants in that specific room (excluding the new user).
  - `signal` — targeted signaling between peers. Payloads are generic and can carry offers, answers, or ICE candidates, which the frontend interprets.
  - `signal_broadcast` — broadcasts signaling payloads (e.g., ICE candidates) to all other participants in the same room.
  - `disconnect` — cleans up rooms when users leave and emits `user_left` and `room_list_update`.
- **In-memory room state**:
  - `active_rooms: set[str]` tracks all rooms that currently have participants.
  - Detailed per-room membership is derived from `sio.manager.rooms`.

The Socket.IO server is wrapped in:

- `socket_app = socketio.ASGIApp(socketio_server=sio, other_asgi_app=app)`

This `socket_app` is the ASGI application that should be mounted in production (e.g., by Vercel or an ASGI server).

### Data & State

There is no external database. All data lives in memory:

- Rooms are ephemeral; when the last participant disconnects, the room is dropped from `active_rooms`.
- Client identity is represented by Socket.IO session IDs (`sid`).

This makes the app **stateless across restarts** and **not horizontally scalable** without sticky sessions or a shared state store (e.g., Redis + Socket.IO adapter).

---

## Frontend Design

### Technologies

- **React** (via Vite) for the UI.
- **socket.io-client** for real-time communication with the backend.
- **WebRTC** (`RTCPeerConnection`, media streams) for audio/video.

### Application Shape

The core of the frontend lives in `src/VideoRoom.jsx`:

- **Lobby mode** (before joining a room):
  - Shows an input to enter a room name.
  - Displays a list of active rooms from the backend.
  - Allows creating/joining a room.
- **In-room mode**:
  - Captures local audio/video via `getUserMedia`.
  - Shows the local video + remote participant videos in a responsive grid.
  - Provides simple controls: mute/unmute audio, start/stop video, and leave meeting.

### Signaling Flow (WebRTC)

At a high level:

1. Client connects to the backend via Socket.IO at `VITE_BACKEND_URL` (or `http://<host>:8000` by default).
2. When a user joins a room:
   - The backend adds them to the room and notifies others via `user_joined`.
3. On `user_joined`:
   - Existing participants create a `RTCPeerConnection`, add local tracks, create an **offer**, and send it via `signal` to the new participant.
4. On receiving a `signal` payload:
   - If payload is an **offer**, the receiver:
     - Creates/uses a `RTCPeerConnection`.
     - Sets remote description to the offer.
     - Creates an **answer**, sets local description, and sends it back via `signal`.
   - If payload is an **answer**, the original offerer sets it as the remote description.
   - If payload is an **ICE candidate**, it is added to the relevant peer connection.

This is a **full-mesh** topology: every participant creates direct peer connections with each other participant in the room.

---

## Configuration & Deployment

### Environment and URLs

- **Backend URL for frontend**:
  - Controlled via `VITE_BACKEND_URL` (e.g., set in `docker-compose.yml`).
  - If not set, the frontend falls back to `http(s)://<current-host>:8000`.
- **Docker Compose**:
  - `backend` service → builds `./backend`, exposes `8000:8000`.
  - `frontend` service → builds `./frontend`, exposes `5173:5173`, with `VITE_BACKEND_URL=http://localhost:8000`.
- **Vercel**:
  - `vercel.json` defines:
    - Python backend build using `backend/app/main.py`.
    - Frontend static build from `frontend`.
  - Rewrites route `/socket.io` and `/api` traffic to the backend.

---

## NAT, STUN/TURN, and Connectivity

### Current behavior

- The frontend configures `RTCPeerConnection` with a single public STUN server:
  - `stun:stun.l.google.com:19302`
- This allows browsers to discover public-facing ICE candidates when NAT allows it, and then attempt a direct peer-to-peer connection.

### Limitations and common issues

- **Symmetric/strict NATs and CGNAT**:
  - Some routers and mobile networks allocate different external ports per destination and only allow traffic for those exact mappings.
  - In these environments, STUN-only setups often fail, and peers cannot establish a direct connection.
- **Corporate/locked-down networks**:
  - UDP or specific ports may be blocked; even if ICE candidates are gathered, media traffic may not flow.
- **No TURN relay**:
  - When all direct candidates fail, there is no relay path; users experience silent failures (never connecting, black video).

### Recommended options

- **Add a TURN server in production**:
  - Deploy a TURN server (e.g., `coturn`) alongside the backend (same region/zone) and expose it on UDP 3478 and optionally TCP/TLS 443.
  - Configure ICE servers to include both STUN and TURN:
    - STUN for low-latency direct connections when possible.
    - TURN as a fallback relay when direct paths are blocked.
- **Prefer HTTPS/WSS and TURN over 443**:
  - Many restrictive networks still allow HTTPS on 443; TURN-over-TLS on 443 significantly improves connection success rates.
- **Improve observability**:
  - Log ICE connection states on the client and surface user-friendly errors when the connection fails, to make debugging connectivity issues easier.

---

## Scalability Considerations

- **Current model**:
  - Backend:
    - Single-process FastAPI + Socket.IO server with in-memory room tracking (`active_rooms` and `sio.manager.rooms`).
    - Suited for a single instance (one container/VM) and modest (< 50) traffic.
  - WebRTC:
    - Full-mesh topology inside each room: every participant connects directly to every other participant.
- **Implications**:
  - Horizontal scaling:
    - Running multiple backend instances requires a shared state store (e.g., Redis) and a Socket.IO adapter so that events and room membership are consistent across instances. [Note: thsi will add additional complexity]
    - In-memory-only state does not work across multiple instances or restarts.
  - Media scaling:
    - Full-mesh rooms scale poorly as participant count grows; bandwidth and CPU per client grow roughly with the number of peers.
    - For larger rooms, a media server (SFU/MCU like Janus, mediasoup, or Jitsi) would be needed instead of pure peer-to-peer.
- **Potential future evolution**:
  - Introduce:
    - A Redis-backed Socket.IO adapter and external room store for multi-instance backend deployments.
    - Authentication and basic user identity to better manage permissions and room membership.
  - For higher-scale or large rooms:
    - Replace or augment the current WebRTC mesh with an SFU, keeping this app as the signaling and control plane while delegating media mixing/forwarding to a dedicated media server.

---

## Testing, Limitations, and Required Packages

### Backend unit tests

- Tests live in `backend/tests/test_main.py` and use `pytest`.
- **Current limitation**: Socket.IO tests assume a running backend server on `http://localhost:8000`.
  - You need **two terminals** to run the full test suite:
    - **Terminal 1** — start the backend server:
      - `cd backend`
      - `~/code/.venv/bin/python -m uvicorn app.main:socket_app --host 0.0.0.0 --port 8000 --reload`
    - **Terminal 2** — run tests:
      - `cd backend`
      - `~/code/.venv/bin/python -m pytest -q`

In the future, the tests can be refactored to spin up the ASGI app in-process so they do not depend on an external server.

### Backend Python packages

- Runtime (from `backend/requirements.txt`):
  - `fastapi`
  - `uvicorn`
  - `python-socketio`
  - `aiortc`
  - `python-dotenv`
- Testing (usually installed in the same virtualenv):
  - `pytest`
  - Optionally `pytest-asyncio` if you add more async-heavy tests.

---

## Known Limitations and Future Improvements

- **Scalability and persistence**:
  - All state is in memory; consider introducing a shared store (e.g., Redis) and a Socket.IO adapter for multi-instance deployments.
  - There is no user identity/authentication; all participants are anonymous `sid`s.
- **Error handling**:
  - Both backend event handlers and frontend WebRTC flows have minimal error handling; structured logging and richer user-facing error states would improve debuggability.
- **Separation of concerns**:
  - Backend logic is concentrated in `main.py`. Extracting routes, event handlers, and services into separate modules would improve maintainability.
  - Frontend logic for signaling and WebRTC lives in a single `VideoRoom` component; extracting custom hooks (e.g., `useSocket`, `useWebRTC`) would make the code easier to test and extend.
- **Security**:
  - CORS is currently wide open (`allow_origins=["*"]`) for simplicity. For production, restrict to trusted frontend origins and consider CSRF and rate-limiting strategies.

Despite these limitations, the current design is well-suited for experimentation, demos, and small deployments, with a clear upgrade path to a more modular and scalable architecture.

