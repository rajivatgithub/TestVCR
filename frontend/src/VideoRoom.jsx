import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const backendUrl =
  import.meta.env.VITE_BACKEND_URL ||
  `${window.location.protocol}//${window.location.hostname}:8000`;

const socket = io(backendUrl, {
  transports: ['websocket'],
});
const iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const VideoRoom = () => {
  // --- State ---
  const [joined, setJoined] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [availableRooms, setAvailableRooms] = useState([]);
  const [stream, setStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({}); // { sid: MediaStream }
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  // --- Refs ---
  const pcs = useRef({}); 
  const localVideoRef = useRef(null);

  // --- Helper: Create Peer Connection ---
  const createPC = (targetSid, localStream) => {
    if (pcs.current[targetSid]) return pcs.current[targetSid];

    const pc = new RTCPeerConnection(iceServers);
    pcs.current[targetSid] = pc;

    // Add local tracks to the connection
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('signal', { to: targetSid, payload: { type: 'ice-candidate', candidate: e.candidate } });
      }
    };

    pc.ontrack = (e) => {
      console.log(`📡 Receiving remote track from ${targetSid}`);
      setRemoteStreams(prev => ({ ...prev, [targetSid]: e.streams[0] }));
    };

    return pc;
  };

  // --- Socket Effects ---
  useEffect(() => {
    socket.on('room_list_update', (rooms) => setAvailableRooms(rooms));
    
    socket.on('user_joined', async (data) => {
      if (!stream) return;
      console.log("New user joined, creating offer...");
      const pc = createPC(data.sid, stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal', { to: data.sid, payload: { type: 'offer', sdp: offer } });
    });

    socket.on('signal', async ({ from, payload }) => {
      if (!stream) return;
      let pc = pcs.current[from];

      if (payload.type === 'offer') {
        pc = createPC(from, stream);
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { to: from, payload: { type: 'answer', sdp: answer } });
      } else if (payload.type === 'answer') {
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
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

  // --- Actions ---
  const joinRoom = async (selectedRoom = null) => {
    const targetRoom = selectedRoom || roomName;
    if (!targetRoom) return alert("Enter room name");
    
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(localStream);
      setJoined(true);
      setRoomName(targetRoom);
      
      // Attach local stream to video element
      setTimeout(() => { 
        if (localVideoRef.current) localVideoRef.current.srcObject = localStream; 
      }, 100);

      socket.emit('join_room', { room: targetRoom });
    } catch (err) {
      console.error("Camera error:", err);
      alert("Could not access camera/microphone.");
    }
  };

  const toggleAudio = () => {
    if (stream) {
      const enabled = stream.getAudioTracks()[0].enabled;
      stream.getAudioTracks()[0].enabled = !enabled;
      setIsMuted(enabled); // State follows the track (if it was enabled, we are now muted)
    }
  };

  const toggleVideo = () => {
    if (stream && stream.getVideoTracks().length > 0) {
      const track = stream.getVideoTracks()[0];
      const newEnabledStatus = !track.enabled;
      track.enabled = newEnabledStatus;
      setIsVideoOff(!newEnabledStatus); // If track is disabled (false), VideoOff is true
    }
  };
  // --- Render ---

  if (!joined) {
    return (
      <div style={{ padding: '50px', textAlign: 'center', backgroundColor: '#f0f2f5', height: '100vh', fontFamily: 'sans-serif' }}>
        <h1>Video Lobby</h1>
        <div style={{ marginBottom: '20px' }}>
          <input 
            value={roomName} 
            onChange={(e) => setRoomName(e.target.value)} 
            placeholder="Room Name" 
            style={{ padding: '12px', fontSize: '16px', borderRadius: '5px', border: '1px solid #ccc' }} 
          />
          <button onClick={() => joinRoom()} style={{ padding: '12px 24px', marginLeft: '10px', cursor: 'pointer' }}>Join Room</button>
        </div>
        <h3>Active Rooms:</h3>
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '10px' }}>
          {availableRooms.length === 0 && <p>No active rooms. Create the first one!</p>}
          {availableRooms.map(r => (
            <button key={r} onClick={() => joinRoom(r)} style={{ padding: '8px 16px', cursor: 'pointer' }}>Join {r}</button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', backgroundColor: '#202124', color: 'white', fontFamily: 'sans-serif' }}>
      
      <div style={{ padding: '10px 20px', backgroundColor: '#2c2d30' }}>
        <strong>Room: {roomName}</strong>
      </div>

      {/* Video Grid */}
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
        <div style={{ width: '100%', maxWidth: '600px', aspectRatio: '16/9', background: '#000', borderRadius: '12px', overflow: 'hidden', position: 'relative' }}>
          <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', bottom: '10px', left: '10px', background: 'rgba(0,0,0,0.5)', padding: '4px 10px', borderRadius: '4px' }}>You</div>
          {isVideoOff && <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>Camera Off</div>}
        </div>

        {/* Remote Feeds */}
        {Object.entries(remoteStreams).map(([sid, rStream]) => (
          <div key={sid} style={{ width: '100%', maxWidth: '600px', aspectRatio: '16/9', background: '#000', borderRadius: '12px', overflow: 'hidden', position: 'relative' }}>
            <video 
              autoPlay playsInline 
              ref={(el) => { if (el) el.srcObject = rStream; }} 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
            />
            <div style={{ position: 'absolute', bottom: '10px', left: '10px', background: 'rgba(0,0,0,0.5)', padding: '4px 10px', borderRadius: '4px' }}>Participant</div>
          </div>
        ))}
      </div>

      {/* Control Bar */}
      <div style={{ height: '100px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', borderTop: '1px solid #3c4043' }}>
        
        <button 
          onClick={toggleAudio} 
          style={{ padding: '12px 24px', borderRadius: '30px', border: 'none', cursor: 'pointer', background: isMuted ? '#ea4335' : '#3c4043', color: 'white' }}>
          {isMuted ? '🔇 Unmute' : '🎙️ Mute'}
        </button>

        <button 
          onClick={toggleVideo} 
          style={{ padding: '12px 24px', borderRadius: '30px', border: 'none', cursor: 'pointer', background: isVideoOff ? '#ea4335' : '#3c4043', color: 'white' }}>
          {isVideoOff ? '📹 Start Video' : '📹 Stop Video'}
        </button>

        <button 
          onClick={() => window.location.reload()} 
          style={{ padding: '12px 30px', borderRadius: '30px', border: 'none', background: '#ea4335', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}>
          Leave Meeting
        </button>
      </div>
    </div>
  );
};

export default VideoRoom;
