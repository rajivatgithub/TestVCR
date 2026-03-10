# System Design: Scalable 1-on-1 & Group Video Chat

This document outlines the current architectural/design choices for the video chat application, identifies scaling bottlenecks for a 10,000-room target, and provides a roadmap for expanding to larger group meetings (more than 2 participants in a room)

---

## Current Design Choices

### 1. 1-on-1 Full-Mesh P2P

The application currently uses a **Full-Mesh WebRTC** topology where peers connect directly to one another. While the code does not yet strictly enforce a 2-person limit, it is the ideal choice for 1-on-1 use cases because:

* **Zero Media Cost**: Audio and video flow directly between users; the server only handles signaling, keeping backend bandwidth costs near zero.
* **Minimal Latency**: Without an intermediary server processing video, aka low latency solution.
* **Simplified Backend**: The server acts only as a "matchmaker" (signaling server) to exchange connection metadata. This keeps the code complexity low.

### 2. FastAPI & Asynchronous Socket.IO

The backend is built using **FastAPI** and `python-socketio`.

* **High Concurrency**: Asynchronous I/O is perfect for signaling, as the server spends most of its time waiting for network packets without blocking the execution thread.
* **Real-time Signaling**: Socket.IO efficiently manages the exchange of WebRTC offers, answers, and ICE candidates.

---

## Implementing the 2-Person Limit

Currently, `handle_join_room` adds users to a room without checking the existing occupancy. To enforce a strict 1-on-1 limit, a guard clause must be added to the `join_room` event in `backend/app/main.py`.

### Proposed Implementation:

```python
@sio.on('join_room')
async def handle_join_room(sid, data):
    room = data.get('room', 'default-room')
    
    # Check current participant count from the in-memory tracker
    participants = room_participants.get(room, set())
    
    if len(participants) >= 2:
        await sio.emit("error", {"message": "Room is full. Max 2 participants."}, to=sid)
        print(f"🚫 Join rejected: Room {room} is full.")
        return

    # Proceed with existing joining logic...
    active_rooms.add(room)
    room_participants.setdefault(room, set()).add(sid)

```

---

## Scaling to 10K Rooms: Limitations & Solutions

To scale to 20K concurrent users (10K rooms), the current design will hit three major bottlenecks:

### 1. The "Lobby Broadcast" Storm

**Issue**: Currently, every time a user joins or leaves, the server broadcasts the **entire** list of active rooms to **every** connected client.

* **Result**: Sending 10K strings to 20K users simultaneously will saturate the server's network bandwidth and freeze the app.
* **Solution**: Remove the global `room_list_update` broadcast. Implement a **Search-based** UI or a **Paginated API** where users fetch only the first 20 rooms or search by name.

### 2. Memory & Horizontal Scaling

**Issue**: All state (rooms and participants) is stored in local Python variables (`active_rooms`, `room_participants`).

* **Result**: If the server restarts, all data is lost. Furthermore, you cannot add a second server instance because Server A won't know about rooms on Server B.
* **Solution**: Use a **Redis-backed Socket.IO adapter**. This allows multiple backend instances to share the same room state.

### 3. The "Silo" Effect (Horizontal scaling)

If User A is on Server 1 and User B is on Server 2, they are in "silos." Server 1 has no idea User B is waiting in the same room. Signaling messages will simply vanish.

The Solution: Redis Pub/Sub Adapter
Use a Redis-backed Socket.IO adapter. This allows multiple backend instances to share room state and persist data through restarts.
Redis acts as a middleman. When Server 1 wants to send a message to a room, it tells Redis. Redis then "broadcast" that message to all other servers.


### 4. NAT Traversal Reliability

**Issue**: The frontend currently uses only a public STUN server.

* **Result**: Roughly 20% of users on strict corporate or mobile networks will fail to connect.
* **Solution**: Deploy a **TURN Server** (e.g., Coturn) to relay media when direct P2P connections are blocked by firewalls.

---

## Enabling More Than 2 Participants

Supporting larger groups (e.g., 5+ people) requires a fundamental shift in how video is distributed.

### The Mesh Limitation

In a Full-Mesh setup, $N$ participants require each user to maintain $N-1$ connections. In a 10-person room, every user must upload their video 9 times, which quickly exceeds home upload speeds and crashes browsers.

### The Solution: Selective Forwarding Unit (SFU)

To enable larger rooms, the architecture must move to an **SFU model**.

* **How it works**: Every participant sends their video **once** to a central server (the SFU). The SFU then clones and forwards that single stream to the other participants.
* **Benefit**: This drastically reduces the CPU and bandwidth load on the user's device, allowing for dozens of participants in a single room.
* **Tools**: Recommended SFU integrations include **Mediasoup**, **LiveKit**, or **Janus**.

