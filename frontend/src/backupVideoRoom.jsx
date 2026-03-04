import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const HOST_IP = '10.0.0.183'; 
const socket = io(`http://${HOST_IP}:8000`, { transports: ['websocket'] });
const iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const VideoRoom = () => {
  const [joined, setJoined] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [availableRooms, setAvailableRooms] = useState([]);
  const [stream, setStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({}); // { sid: MediaStream }
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  const pcs = useRef({}); 
  const localVideoRef = useRef(null);

  const createPC = (targetSid, localStream) => {
    const pc = new RTCPeerConnection(iceServers);
    pcs.current[targetSid] = pc;

    // Add local tracks
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('signal', { to: targetSid, payload: { type: 'ice-candidate', candidate: e.candidate } });
    };

    pc.ontrack = (e) => {
      // Update state with the new remote stream
      setRemoteStreams(prev => ({ ...prev, [targetSid]: e.streams[0] }));
    };

    return pc;
  };

  useEffect(() => {
    socket.on('room_list_update', (rooms) => setAvailableRooms(rooms));
    
    socket.on('user_joined', async (data) => {
      if (!stream) return;
      const pc = createPC(data.sid, stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal', { to: data.sid, payload: { type: 'offer', sdp: offer } });
    });

    socket.on('signal', async ({ from, payload }) => {
      let pc = pcs.current[from];
      if (payload.type === 'offer') {
        pc = createPC(from, stream);
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { to: from, payload: { type: 'answer', sdp: answer } });
      } else if (payload.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      } else if (payload.type === 'ice-candidate') {
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      }
    });

    socket.on('user_left', (sid) => {
      if (pcs.current[sid]) {
        pcs.current[sid].close();
        delete pcs.current[sid];
      }
      setRemoteStreams(prev => {
        const newState = { ...prev };
        delete newState[sid];
        return newState;
      });
    });

    return () => {
      ['room_list_update', 'user_joined', 'signal', 'user_left'].forEach(e => socket.off(e));
    };
  }, [stream]);

  const joinRoom = async (selectedRoom = null) => {
    const targetRoom = selectedRoom || roomName;
    if (!targetRoom) return alert("Enter room name");
    const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    setStream(localStream);
    setJoined(true);
    setRoomName(targetRoom);
    setTimeout(() => { if (localVideoRef.current) localVideoRef.current.srcObject = localStream; }, 100);
    socket.emit('join_room', { room: targetRoom });
  };

  // UI Components
  if (!joined) {
    return (
      <div style={{ padding: '50px', textAlign: 'center', backgroundColor: '#f0f2f5', height: '100vh' }}>
        <h1>Video Lobby</h1>
        <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Room Name" style={{ padding: '10px' }} />
        <button onClick={() => joinRoom()}>Join Room</button>
        <div style={{ marginTop: '20px' }}>
          {availableRooms.map(r => <button key={r} onClick={() => joinRoom(r)} style={{ margin: '5px' }}>Join {r}</button>)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', backgroundColor: '#202124' }}>
      {/* 100% Width Video Grid - No Sidebar */}
      <div style={{ 
        flex: 1, 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', 
        gap: '20px', 
        padding: '20px',
        alignContent: 'center',
        justifyItems: 'center'
      }}>
        {/* Local Feed */}
        <div style={{ width: '100%', maxWidth: '640px', aspectRatio: '16/9', background: '#000', borderRadius: '8px', overflow: 'hidden', position: 'relative' }}>
          <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', bottom: '10px', left: '10px', color: 'white', background: 'rgba(0,0,0,0.5)', padding: '2px 8px' }}>You</div>
        </div>

        {/* Remote Feeds mapped from State */}
        {Object.entries(remoteStreams).map(([sid, remoteStream]) => (
          <div key={sid} style={{ width: '100%', maxWidth: '640px', aspectRatio: '16/9', background: '#000', borderRadius: '8px', overflow: 'hidden' }}>
            <video 
              autoPlay playsInline 
              ref={(el) => { if (el) el.srcObject = remoteStream; }} 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
            />
          </div>
        ))}
      </div>

      {/* Control Bar */}
      <div style={{ height: '80px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px', borderTop: '1px solid #3c4043' }}>
        <button onClick={() => { stream.getAudioTracks()[0].enabled = !isMuted; setIsMuted(!isMuted); }} style={{ padding: '10px 20px' }}>
          {isMuted ? '🔇 Unmute' : '🎙️ Mute'}
        </button>
        <button onClick={() => window.location.reload()} style={{ padding: '10px 20px', backgroundColor: '#ea4335', color: 'white', border: 'none', borderRadius: '5px' }}>
          Leave Meeting
        </button>
      </div>
    </div>
  );
};

export default VideoRoom;
