import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Sử dụng biến môi trường cho cấu hình Firebase
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID
};

// In ra console để debug
console.log("Firebase config:", {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY ? "Defined" : "Undefined",
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN ? "Defined" : "Undefined",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID ? "Defined" : "Undefined",
});

// Khởi tạo Firebase
const app = initializeApp(firebaseConfig);

// Khởi tạo Firestore
export const db = getFirestore(app);

// Bỏ emulator để kết nối trực tiếp đến Firebase
// Uncomment nếu muốn sử dụng emulator
// if (process.env.NODE_ENV === 'development') {
//   connectFirestoreEmulator(db, 'localhost', 8080);
// } 