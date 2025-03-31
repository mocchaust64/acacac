const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use((req, res, next) => {
    // Kiểm tra nếu request là cho một file tĩnh và không tồn tại
    const fileExtRegex = /\.\w+$/;
    if (fileExtRegex.test(req.url)) {
      next();
      return;
    }
    
    // Nếu URL bắt đầu bằng "/guardian-signup" và không phải là file tĩnh
    if (req.url.startsWith('/guardian-signup')) {
      req.url = '/index.html';
    }
    
    next();
  });
}; 