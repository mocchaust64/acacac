import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

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
    <App />
  </React.StrictMode>
);
