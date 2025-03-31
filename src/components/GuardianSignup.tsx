import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import '../App.css';
import { createWebAuthnCredential } from '../utils/webauthnUtils';
import { compressPublicKey } from '../utils/bufferUtils';
import { getInvitation, saveGuardianData, InviteData } from '../firebase/guardianService';

// Hàm hash recovery phrase
const hashRecoveryPhrase = async (phrase: string): Promise<Uint8Array> => {
  // Chuyển recovery phrase thành bytes
  const phraseBytes = new TextEncoder().encode(phrase);
  
  // Tạo buffer 32 bytes để lưu dữ liệu
  const inputBytes = new Uint8Array(32);
  
  // Sao chép dữ liệu từ phrase, đảm bảo không vượt quá 32 bytes
  inputBytes.set(phraseBytes.slice(0, Math.min(phraseBytes.length, 32)));
  
  // Hash bằng SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', inputBytes);
  
  // Chuyển kết quả thành Uint8Array
  return new Uint8Array(hashBuffer);
};

const GuardianSignup: React.FC = () => {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [guardianName, setGuardianName] = useState<string>('');
  const [recoveryPhrase, setRecoveryPhrase] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [isCompleted, setIsCompleted] = useState<boolean>(false);
  
  // Tải thông tin invite từ Firebase
  useEffect(() => {
    const loadInviteData = async () => {
      try {
        if (!inviteCode) {
          setError('Mã mời không hợp lệ.');
          setLoading(false);
          return;
        }
        
        setLoading(true);
        
        // Lấy thông tin invite từ Firebase
        const data = await getInvitation(inviteCode);
        
        if (!data) {
          setError('Link mời không hợp lệ hoặc đã hết hạn.');
          setLoading(false);
          return;
        }
        
        setInviteData(data);
        setLoading(false);
      } catch (error: any) {
        console.error("Lỗi khi tải thông tin mời:", error);
        setError('Không thể tải thông tin mời. Vui lòng thử lại sau.');
        setLoading(false);
      }
    };
    
    loadInviteData();
  }, [inviteCode]);
  
  // Xử lý khi guardian đăng ký
  const handleSignup = async () => {
    try {
      if (!inviteData) {
        setStatus('Không có thông tin mời hợp lệ.');
        return;
      }
      
      if (!guardianName || !recoveryPhrase || recoveryPhrase.length < 8) {
        setStatus('Vui lòng nhập tên guardian và recovery phrase (ít nhất 8 ký tự).');
        return;
      }
      
      setStatus('Đang đăng ký guardian...\n\nBước 1: Tạo khóa WebAuthn...');
      
      // 1. Tạo khóa WebAuthn
      const guardianIdentifier = `${inviteData.multisigAddress}_guardian_${inviteData.guardianId}`;
      const webAuthnResult = await createWebAuthnCredential(guardianIdentifier, guardianName);
      
      setStatus(prev => prev + '\nĐã tạo khóa WebAuthn thành công!');
      
      // 2. Hash recovery phrase
      const hashedRecoveryBytes = await hashRecoveryPhrase(recoveryPhrase);
      
      // 3. Nén khóa WebAuthn
      const uncompressedKeyBuffer = Buffer.from(webAuthnResult.publicKey, 'hex');
      const compressedKeyBuffer = compressPublicKey(uncompressedKeyBuffer);
      
      // 4. Lưu dữ liệu vào Firebase
      await saveGuardianData({
        inviteCode: inviteCode || '',
        guardianId: inviteData.guardianId,
        multisigAddress: inviteData.multisigAddress,
        guardianName,
        hashedRecoveryBytes: Array.from(hashedRecoveryBytes), // Chuyển Uint8Array thành mảng thường để JSON hóa
        webauthnCredentialId: webAuthnResult.credentialId,
        webauthnPublicKey: Array.from(new Uint8Array(compressedKeyBuffer)), // Lưu khóa đã nén
        status: 'ready'
      });
      
      // Hiển thị thông tin chi tiết và hướng dẫn
      setStatus(`Đăng ký thành công với mã mời ${inviteCode}!

Thông tin Guardian:
- Tên: ${guardianName}
- ID: ${inviteData.guardianId}
- Ví Multisig: ${inviteData.multisigAddress.slice(0, 10)}...

Chủ ví sẽ nhận được thông báo và thêm bạn vào danh sách guardian. Vui lòng đợi chủ ví xác nhận.`);

      setIsCompleted(true);
    } catch (error: any) {
      console.error("Lỗi khi đăng ký guardian:", error);
      setStatus(`Lỗi khi đăng ký guardian: ${error.message}`);
    }
  };
  
  if (loading) return <div className="container">Đang tải...</div>;
  if (error) return <div className="container error-message">{error}</div>;
  if (isCompleted) return (
    <div className="container success-message">
      <h2>Đăng ký thành công!</h2>
      <p>{status}</p>
    </div>
  );
  
  return (
    <div className="container">
      <h1>Đăng ký Guardian cho Moon Wallet</h1>
      
      <button 
        onClick={() => window.location.href = `${window.location.origin}/#/`}
        style={{ 
          position: 'absolute', 
          top: '10px', 
          right: '10px',
          padding: '8px 16px',
          backgroundColor: '#333',
          color: 'white',
          border: 'none',
          borderRadius: '4px'
        }}
      >
        Quay lại trang chính
      </button>
      
      <div className="info-box">
        <p><strong>Ví:</strong> {inviteData?.multisigAddress}</p>
        <p><strong>ID Guardian:</strong> {inviteData?.guardianId}</p>
      </div>
      
      <div className="form-group">
        <label>Tên Guardian: </label>
        <input 
          type="text" 
          value={guardianName} 
          onChange={(e) => setGuardianName(e.target.value)} 
          maxLength={32}
          placeholder="Nhập tên của bạn"
          className="input-field"
        />
      </div>
      
      <div className="form-group">
        <label>Recovery Key: <span className="required">*</span></label>
        <input 
          type="text" 
          value={recoveryPhrase} 
          onChange={(e) => setRecoveryPhrase(e.target.value)} 
          placeholder="Nhập recovery key (ít nhất 8 ký tự)"
          className="input-field"
          required
        />
        {recoveryPhrase && recoveryPhrase.length < 8 && (
          <p className="error-message">Recovery key phải có ít nhất 8 ký tự</p>
        )}
      </div>
      
      <button 
        onClick={handleSignup} 
        disabled={!guardianName || !recoveryPhrase || recoveryPhrase.length < 8}
        className="action-button"
      >
        Đăng ký làm Guardian
      </button>
      
      {status && <div className="status-message">{status}</div>}
      
      <div className="note">
        <p>Lưu ý:</p>
        <ul>
          <li>Guardian sẽ có thể giúp bạn khôi phục ví trong trường hợp mất quyền truy cập.</li>
          <li>Recovery key rất quan trọng. Hãy lưu lại ở nơi an toàn và không chia sẻ với người khác.</li>
          <li>Quá trình đăng ký sẽ yêu cầu xác thực bằng sinh trắc học (Touch ID, Face ID, Windows Hello...)</li>
        </ul>
      </div>
    </div>
  );
};

export default GuardianSignup; 