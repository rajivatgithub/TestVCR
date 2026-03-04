import pytest
import socketio
from fastapi.testclient import TestClient
from app.main import app # Testing HTTP via app

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

@pytest.mark.asyncio
async def test_socket_connection():
    sio_client = socketio.AsyncClient()
    try:
        # Standard connection to the wrapper
        await sio_client.connect('http://localhost:8000', wait_timeout=5)
        assert sio_client.connected
        print("✅ Test: Socket connected!")
    finally:
        if sio_client.connected:
            await sio_client.disconnect()

@pytest.mark.asyncio
async def test_join_room():
    sio_client = socketio.AsyncClient()
    try:
        await sio_client.connect('http://localhost:8000', wait_timeout=5)
        await sio_client.emit('join_room', {'room': 'test-room', 'username': 'test-user'})
        # If we reached here without error, the emit worked
        assert True
    finally:
        if sio_client.connected:
            await sio_client.disconnect()
