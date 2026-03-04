import os
import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 1. Setup Socket.io Server
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
app = FastAPI()

# Track active rooms globally
active_rooms = set()

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

@sio.on('join_room')
async def handle_join_room(sid, data):
    room = data.get('room', 'default-room')
    username = data.get('username', 'Unknown')
    
    # Register room and join
    active_rooms.add(room)
    await sio.enter_room(sid, room)
    
    # Notify everyone of the new room list
    await sio.emit("room_list_update", list(active_rooms))
    
    print(f"👤 {username} joined room: {room}")
    # Notify ONLY users in that specific room
    await sio.emit("user_joined", {"username": username, "sid": sid}, room=room, skip_sid=sid)

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
    # We iterate through a copy of active_rooms to check occupancy
    for room in list(active_rooms):
        # Get list of remaining users in that room
        participants = sio.manager.rooms.get('/', {}).get(room, {})
        if not participants or len(participants) == 0:
            print(f"🏠 Room {room} is now empty. Deleting...")
            active_rooms.discard(room)
    
    # 3. Update the lobby list for everyone still in the lobby
    await sio.emit("room_list_update", list(active_rooms))   

# Unified Wrapper
socket_app = socketio.ASGIApp(socketio_server=sio, other_asgi_app=app)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:socket_app", host="0.0.0.0", port=8000, reload=True)
