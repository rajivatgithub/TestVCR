import os
import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 1. Setup Socket.io Server
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = FastAPI()

# Track active rooms and their participants (avoid relying on manager.rooms internal structure)
active_rooms = set()
room_participants = {}  # room_name -> set of sids

# 2. Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/")
async def root():
    return {"rooms": list(active_rooms)}

# 3. Socket.io Events
@sio.event
async def connect(sid, environ):
    print(f"✅ User Connected: {sid}")
    # Send current room list to the new user
    await sio.emit("room_list_update", list(active_rooms), to=sid)

@sio.on('get_room_list')
async def handle_get_room_list(sid):
    """Send current room list to a client that asked (e.g. after listener was attached)."""
    await sio.emit("room_list_update", list(active_rooms), to=sid)

@sio.on('join_room')
async def handle_join_room(sid, data):
    room = data.get('room', 'default-room')
    username = data.get('username', 'Unknown')
    
    active_rooms.add(room)
    room_participants.setdefault(room, set()).add(sid)
    await sio.enter_room(sid, room)
    
    await sio.emit("room_list_update", list(active_rooms))
    
    print(f"👤 {username} joined room: {room}")
    await sio.emit("user_joined", {"username": username, "sid": sid}, room=room, skip_sid=sid)

@sio.on('leave_room')
async def handle_leave_room(sid, data):
    """Remove client from room without disconnecting. Emit user_left and update room list."""
    room = data.get('room')
    if not room:
        return
    # Notify others in the room first (while we're still in the room), then leave
    await sio.emit("user_left", sid, room=room, skip_sid=sid)
    await sio.leave_room(sid, room)
    room_participants.get(room, set()).discard(sid)
    if not room_participants.get(room):
        room_participants.pop(room, None)
        active_rooms.discard(room)
    await sio.emit("room_list_update", list(active_rooms))

@sio.event
async def signal(sid, data):
    """Targeted signaling between two peers."""
    recipient_sid = data['to']
    payload = data['payload']
    await sio.emit("signal", {"from": sid, "payload": payload}, to=recipient_sid)

@sio.event
async def signal_broadcast(sid, data):
    """Broadcast ICE candidates to everyone else in the SAME room."""
    user_rooms = sio.rooms(sid)
    for room in user_rooms:
        if room != sid: # Skip the user's private SID room
            await sio.emit("signal", {"from": sid, "payload": data['payload']}, room=room, skip_sid=sid)

@sio.event
async def disconnect(sid):
    print(f"❌ User Disconnected: {sid}")
    await sio.emit("user_left", sid)
    # Remove sid from our room_participants (sid may be in one room)
    for room in list(room_participants.keys()):
        room_participants[room].discard(sid)
        if not room_participants[room]:
            room_participants.pop(room, None)
            active_rooms.discard(room)
            print(f"🏠 Room {room} is now empty. Deleting...")
    await sio.emit("room_list_update", list(active_rooms))   

# Unified Wrapper
socket_app = socketio.ASGIApp(socketio_server=sio, other_asgi_app=app)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:socket_app", host="0.0.0.0", port=8000, reload=True)
