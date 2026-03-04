import VideoRoom from './VideoRoom';

function App() {
  return (
    <div style={{ padding: '20px', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h1>Python + React Video Chat</h1>
      <p>Phase 2: Camera Capture & Signaling</p>
      <hr style={{ margin: '20px 0' }} />
      <VideoRoom />
    </div>
  );
}

export default App;
