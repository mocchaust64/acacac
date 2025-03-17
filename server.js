const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const https = require('https');
const fs = require('fs');

const app = express();
const port = 3001;

// Lưu trữ các phiên đăng ký và thiết bị
const sessions = {};
const devices = {};

// Cấu hình CORS cho tất cả domain
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());

// Middleware để log tất cả request
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// API endpoint để kiểm tra trạng thái phiên
app.get('/api/session/:id', (req, res) => {
  const sessionId = req.params.id;
  console.log(`Kiểm tra phiên ${sessionId}, sessions:`, Object.keys(sessions));
  
  if (sessions[sessionId]) {
    res.json(sessions[sessionId]);
  } else {
    res.status(404).json({ error: 'Session not found', message: `Session ${sessionId} không tồn tại` });
  }
});

// API endpoint để tạo phiên mới
app.post('/api/session', (req, res) => {
  const { sessionId, walletAddress } = req.body;
  console.log('Tạo phiên mới:', sessionId, walletAddress);
  
  sessions[sessionId] = {
    id: sessionId,
    walletAddress,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  console.log('Phiên đã được tạo:', sessions[sessionId]);
  
  res.json(sessions[sessionId]);
});

// API endpoint để cập nhật trạng thái phiên
app.post('/api/session/:id/complete', (req, res) => {
  const sessionId = req.params.id;
  const { deviceInfo } = req.body;
  console.log('Hoàn thành phiên:', sessionId, deviceInfo);
  
  if (!sessions[sessionId]) {
    return res.status(404).json({ error: 'Session not found', message: `Session ${sessionId} không tồn tại` });
  }
  
  // Cập nhật trạng thái phiên
  sessions[sessionId].status = 'completed';
  sessions[sessionId].completedAt = new Date().toISOString();
  
  // Lưu thông tin thiết bị
  devices[sessionId] = deviceInfo;
  console.log('Phiên đã hoàn thành, thiết bị:', devices[sessionId]);
  
  res.json({ success: true, session: sessions[sessionId] });
});

// API endpoint để lấy thông tin thiết bị
app.get('/api/device/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  console.log('Lấy thông tin thiết bị cho phiên:', sessionId);
  
  if (devices[sessionId]) {
    res.json(devices[sessionId]);
  } else {
    res.status(404).json({ error: 'Device not found', message: `Không tìm thấy thiết bị cho phiên ${sessionId}` });
  }
});

// Route để kiểm tra server đang hoạt động
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Route debug để xem tất cả phiên và thiết bị
app.get('/api/debug', (req, res) => {
  res.json({ 
    sessions: sessions,
    devices: devices
  });
});

// Sử dụng chứng chỉ có sẵn trong thư mục .cert
const options = {
  key: fs.readFileSync('.cert/key.pem'),
  cert: fs.readFileSync('.cert/cert.pem')
};

// Tạo server HTTPS trên port 3001
https.createServer(options, app).listen(port, () => {
  console.log(`API server HTTPS đang chạy trên port ${port}`);
}); 