import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import GuardianSignup from './components/GuardianSignup';

// Thêm khai báo global cho Buffer
declare global {
  interface Window {
    Buffer: typeof Buffer;
  }
}

// Để đảm bảo Buffer hoạt động trong browser
window.Buffer = window.Buffer || require('buffer').Buffer;

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <Router>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="guardian-signup/:inviteCode" element={<GuardianSignup />} />
        <Route path="*" element={
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <h1>404 - Không tìm thấy trang</h1>
            <p>URL hiện tại: {window.location.href}</p>
            <p>Bạn có thể đang truy cập vào một đường dẫn không đúng. Hãy kiểm tra định dạng URL.</p>
            <p>Đường dẫn hợp lệ có dạng: <code>/#/guardian-signup/[inviteCode]</code></p>
            <button 
              onClick={() => window.location.href = `${window.location.origin}/#/`}
              style={{ padding: '10px 20px', backgroundColor: '#0066cc', color: 'white', border: 'none', borderRadius: '4px' }}
            >
              Quay lại trang chính
            </button>
          </div>
        } />
      </Routes>
    </Router>
  </React.StrictMode>
);
