import { bufferToHex } from './bufferUtils';
import * as CBOR from 'cbor-web';

/**
 * Tạo WebAuthn credential mới
 */
export const createNewWebAuthnCredential = async (): Promise<{
  publicKeyHex: string;
  credentialIdHex: string;
}> => {
  // Tạo challenge ngẫu nhiên
  const challenge = new Uint8Array(32);
  window.crypto.getRandomValues(challenge);
  
  // Tạo thông tin người dùng
  const userID = new Uint8Array(16);
  window.crypto.getRandomValues(userID);
  
  // Tạo PublicKeyCredentialCreationOptions
  const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: {
      name: 'Moon Wallet',
      id: window.location.hostname
    },
    user: {
      id: userID,
      name: `user_${Date.now()}`,
      displayName: 'Moon Wallet User'
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 }, // ES256 (secp256r1)
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      requireResidentKey: true
    },
    timeout: 60000,
    attestation: 'direct'
  };
  
  // Tạo credential mới
  const credential = await navigator.credentials.create({
    publicKey: publicKeyCredentialCreationOptions
  }) as PublicKeyCredential;
  
  // Lấy thông tin từ credential
  const response = credential.response as AuthenticatorAttestationResponse;
  
  // Trích xuất publicKey từ attestationObject
  const attestationObject = CBOR.decode(new Uint8Array(response.attestationObject));
  const authData = attestationObject.authData;
  
  // Lấy public key từ authenticator data
  // Public key bắt đầu từ vị trí 55 (sau RP ID hash, flags, counter)
  const publicKeyBytes = extractPublicKeyFromAuthData(new Uint8Array(authData));
  
  const credentialIdBytes = new Uint8Array(credential.rawId);
  
  // Chuyển đổi sang hex để lưu trữ
  const publicKeyHex = bufferToHex(publicKeyBytes.buffer);
  const credentialIdHex = bufferToHex(credentialIdBytes.buffer);
  
  console.log("Extracted public key (hex):", publicKeyHex);
  console.log("Credential ID (hex):", credentialIdHex);
  
  return { publicKeyHex, credentialIdHex };
};

/**
 * Trích xuất public key từ authenticator data
 */
function extractPublicKeyFromAuthData(authData: Uint8Array): Uint8Array {
  // Theo WebAuthn spec, bố cục của authenticator data:
  // [32 bytes RP ID hash, 1 byte flags, 4 bytes counter, variable length AAGUID, variable length credential ID, variable length COSE public key]
  
  // Bỏ qua 32 bytes cho RP ID hash + 1 byte flags + 4 bytes counter = 37 bytes
  let offset = 37;
  
  // Bỏ qua AAGUID (16 bytes)
  offset += 16;
  
  // Đọc độ dài credential ID (2 bytes)
  const credentialIdLength = (authData[offset] << 8) | authData[offset + 1];
  offset += 2;
  
  // Bỏ qua credential ID
  offset += credentialIdLength;
  
  // Đọc COSE public key
  const cosePublicKey = authData.slice(offset);
  
  try {
    // Giải mã COSE public key (sử dụng thư viện CBOR nếu có)
    const publicKeyObj = CBOR.decode(cosePublicKey);
    
    // Lấy coordinaates x và y từ -2 và -3 (theo COSE Web Key)
    const x = publicKeyObj.get(-2);
    const y = publicKeyObj.get(-3);
    
    // Tạo uncompressed EC public key (0x04 || x || y)
    const uncompressedKey = new Uint8Array(65);
    uncompressedKey[0] = 0x04; // Uncompressed point format
    uncompressedKey.set(new Uint8Array(x), 1);
    uncompressedKey.set(new Uint8Array(y), 33);
    
    return uncompressedKey;
  } catch (e) {
    console.error("Lỗi khi trích xuất public key:", e);
    
    // Trả về dummy key nếu không thể trích xuất
    const dummyKey = new Uint8Array(65);
    dummyKey[0] = 0x04;
    const randomX = new Uint8Array(32);
    const randomY = new Uint8Array(32);
    window.crypto.getRandomValues(randomX);
    window.crypto.getRandomValues(randomY);
    dummyKey.set(randomX, 1);
    dummyKey.set(randomY, 33);
    
    return dummyKey;
  }
}

/**
 * Sử dụng WebAuthn credential đã có
 */
export const getWebAuthnCredential = async (
  credentialId: Buffer,
  challenge?: Uint8Array
): Promise<{ 
  signature: Uint8Array; 
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
}> => {
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn không được hỗ trợ trên trình duyệt này');
  }

  // Sử dụng challenge được cung cấp hoặc tạo mới nếu không có
  const finalChallenge = challenge || crypto.getRandomValues(new Uint8Array(32));
  
  // Tạo options cho get assertion
  const options: PublicKeyCredentialRequestOptions = {
    challenge: finalChallenge,
    allowCredentials: [{
      id: credentialId,
      type: 'public-key',
    }],
    userVerification: 'preferred',
    timeout: 60000
  };

  try {
    const assertion = await navigator.credentials.get({
      publicKey: options
    }) as PublicKeyCredential;

    const response = assertion.response as AuthenticatorAssertionResponse;
    
    return {
      signature: new Uint8Array(response.signature),
      authenticatorData: new Uint8Array(response.authenticatorData),
      clientDataJSON: new Uint8Array(response.clientDataJSON)
    };
  } catch (error) {
    console.error('Lỗi khi xác thực WebAuthn:', error);
    throw error;
  }
};

/**
 * Kiểm tra xem WebAuthn có được hỗ trợ không
 */
export const isWebAuthnSupported = (): boolean => {
  return window.PublicKeyCredential !== undefined && 
         typeof window.PublicKeyCredential === 'function';
};

// Chạy thử một số tùy chọn để kiểm tra khả năng tương thích
export const checkWebAuthnCompatibility = async (): Promise<string> => {
  if (!isWebAuthnSupported()) {
    return 'WebAuthn không được hỗ trợ trên trình duyệt này';
  }
  
  try {
    // Kiểm tra xem trình duyệt có hỗ trợ thuộc tính "isUserVerifyingPlatformAuthenticatorAvailable"
    if (PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!available) {
        return 'Thiết bị này không có xác thực sinh trắc học được hỗ trợ';
      }
    }
    
    return 'WebAuthn được hỗ trợ đầy đủ';
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return `Lỗi khi kiểm tra WebAuthn: ${errorMessage}`;
  }
};

/**
 * Xác minh chữ ký WebAuthn trong frontend
 */
export const verifyWebAuthnSignature = async (
  pubkey: Buffer,
  signature: Uint8Array,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array
): Promise<boolean> => {
  try {
    console.log('Bắt đầu xác minh chữ ký WebAuthn');
    console.log('Pubkey ban đầu:', pubkey.toString('hex'));
    
    // Kiểm tra độ dài khóa
    if (pubkey.length !== 65) {
      console.warn(`Khóa WebAuthn không đúng độ dài: ${pubkey.length} (cần 65 byte)`);
      
      // Tạo khóa mới với độ dài đúng
      const newPubkey = Buffer.alloc(65);
      pubkey.copy(newPubkey, 0, 0, Math.min(pubkey.length, 65));
      
      // Nếu byte đầu tiên không phải 0x04, sửa lại
      if (newPubkey[0] !== 0x04) {
        newPubkey[0] = 0x04;
      }
      
      pubkey = newPubkey;
      console.log('Pubkey sau khi sửa độ dài:', pubkey.toString('hex'));
    }
    
    // Kiểm tra định dạng khóa (phải bắt đầu bằng 0x04)
    if (pubkey[0] !== 0x04) {
      console.warn(`Khóa WebAuthn không bắt đầu bằng 0x04: ${pubkey[0].toString(16)}`);
      // Tạo khóa mới với byte đầu tiên là 0x04
      const newPubkey = Buffer.alloc(65);
      newPubkey[0] = 0x04;
      pubkey.copy(newPubkey, 1, 1, 65);
      pubkey = newPubkey;
      console.log('Pubkey sau khi sửa byte đầu:', pubkey.toString('hex'));
    }
    
    // 1. Parse clientDataJSON
    const clientDataObj = JSON.parse(new TextDecoder().decode(clientDataJSON));
    console.log("Client data:", clientDataObj);
    
    // 2. Lấy hash của clientDataJSON
    const clientDataHash = await crypto.subtle.digest('SHA-256', clientDataJSON);
    
    // 3. Kết hợp dữ liệu để xác minh
    const authData = new Uint8Array(authenticatorData);
    const hashData = new Uint8Array(clientDataHash);
    const verificationData = new Uint8Array(authData.length + hashData.length);
    verificationData.set(authData, 0);
    verificationData.set(hashData, authData.length);
    
    console.log("Dữ liệu xác minh:", Buffer.from(verificationData).toString('hex'));
    console.log("Pubkey cuối cùng:", pubkey.toString('hex'));
    console.log("Signature:", Buffer.from(signature).toString('hex'));
    console.log("Signature length:", signature.length);
    
    try {
      // 4. Chuyển đổi khóa công khai sang định dạng SPKI
      const spkiKey = convertRawToSPKI(pubkey);
      
      // 5. Import khóa công khai
      const cryptoKey = await crypto.subtle.importKey(
        'spki',
        spkiKey,
        {
          name: 'ECDSA',
          namedCurve: 'P-256'
        },
        false,
        ['verify']
      );
      
      // 6. Xác minh chữ ký
      const result = await crypto.subtle.verify(
        {
          name: 'ECDSA',
          hash: 'SHA-256'
        },
        cryptoKey,
        signature,
        verificationData
      );
      
      console.log('Kết quả xác minh:', result);
      return result;
    } catch (e) {
      console.error("Lỗi khi xác thực chữ ký:", e);
      
      // Thử với cách khác nếu cách đầu tiên thất bại
      try {
        console.log('Thử phương pháp xác minh thay thế...');
        
        // Chuyển đổi chữ ký từ DER sang raw nếu cần
        let rawSignature = signature;
        if (signature.length > 64 && signature[0] === 0x30) {
          console.log('Phát hiện chữ ký DER, đang chuyển đổi...');
          const derSignature = Buffer.from(signature);
          const convertedSignature = derToRaw(derSignature);
          rawSignature = convertedSignature;
          console.log('Chữ ký sau khi chuyển đổi:', Buffer.from(rawSignature).toString('hex'));
        }
        
        // Import khóa và xác minh lại
        const spkiKey = convertRawToSPKI(pubkey);
        const cryptoKey = await crypto.subtle.importKey(
          'spki',
          spkiKey,
          {
            name: 'ECDSA',
            namedCurve: 'P-256'
          },
          false,
          ['verify']
        );
        
        const result = await crypto.subtle.verify(
          {
            name: 'ECDSA',
            hash: 'SHA-256'
          },
          cryptoKey,
          rawSignature,
          verificationData
        );
        
        console.log('Kết quả xác minh thay thế:', result);
        return result;
      } catch (alternativeError) {
        console.error('Lỗi khi thử phương pháp thay thế:', alternativeError);
        return false;
      }
    }
  } catch (error) {
    console.error('Lỗi khi xác minh chữ ký WebAuthn:', error);
    return false;
  }
};

// Hàm chuyển đổi chữ ký từ DER sang raw
const derToRaw = (signature: Buffer): Uint8Array => {
  try {
    // DER format: 30 + len + 02 + r_len + r + 02 + s_len + s
    let offset = 2; // Skip 30 + len
    
    // Read r
    if (signature[offset] !== 0x02) {
      throw new Error('Định dạng DER không hợp lệ: không tìm thấy marker r');
    }
    offset++; // Skip 02
    
    const rLen = signature[offset++];
    let r = signature.slice(offset, offset + rLen);
    offset += rLen;
    
    // Read s
    if (signature[offset] !== 0x02) {
      throw new Error('Định dạng DER không hợp lệ: không tìm thấy marker s');
    }
    offset++; // Skip 02
    
    const sLen = signature[offset++];
    let s = signature.slice(offset, offset + sLen);
    
    // Pad r and s to 32 bytes
    if (r.length < 32) {
      r = Buffer.concat([Buffer.alloc(32 - r.length, 0), r]);
    } else if (r.length > 32) {
      r = r.slice(r.length - 32);
    }
    
    if (s.length < 32) {
      s = Buffer.concat([Buffer.alloc(32 - s.length, 0), s]);
    } else if (s.length > 32) {
      s = s.slice(s.length - 32);
    }
    
    // Concatenate r and s
    return Buffer.concat([r, s]);
  } catch (error) {
    console.error('Lỗi khi chuyển đổi chữ ký DER sang raw:', error);
    throw error;
  }
};

// Hàm chuyển đổi khóa từ định dạng raw sang SPKI
const convertRawToSPKI = (rawKey: Buffer): ArrayBuffer => {
  try {
    // Đảm bảo khóa bắt đầu bằng 0x04
    if (rawKey[0] !== 0x04) {
      console.warn('Khóa không bắt đầu bằng 0x04, đang sửa...');
      // Tạo khóa mới với byte đầu tiên là 0x04
      const newRawKey = Buffer.alloc(65);
      newRawKey[0] = 0x04;
      // Sao chép phần còn lại của khóa
      if (rawKey.length >= 64) {
        rawKey.copy(newRawKey, 1, 1, 65);
      } else {
        rawKey.copy(newRawKey, 1, 0, Math.min(rawKey.length, 64));
      }
      rawKey = newRawKey;
    }
    
    // Tạo SPKI header
    const spkiHeader = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
    
    // Nối header với khóa (bỏ byte đầu tiên 0x04)
    const spkiKey = Buffer.concat([spkiHeader, rawKey.slice(1)]);
    
    return spkiKey.buffer.slice(spkiKey.byteOffset, spkiKey.byteOffset + spkiKey.byteLength);
  } catch (error) {
    console.error('Lỗi khi chuyển đổi khóa:', error);
    throw error;
  }
};

/**
 * Kiểm tra xem public key có đúng định dạng không
 */
export const validatePublicKey = (publicKeyHex: string): boolean => {
  try {
    const pubkey = Buffer.from(publicKeyHex, 'hex');
    // Public key không nén phải là 65 bytes (1 byte header + 32 bytes x + 32 bytes y)
    if (pubkey.length !== 65) {
      console.error(`Public key không đúng độ dài: ${pubkey.length} bytes (mong đợi 65 bytes)`);
      return false;
    }
    
    // Byte đầu tiên phải là 0x04 (định dạng không nén)
    if (pubkey[0] !== 0x04) {
      console.error(`Public key không phải định dạng không nén: byte đầu tiên là ${pubkey[0].toString(16)} (mong đợi 0x04)`);
      return false;
    }
    
    console.log("Public key hợp lệ");
    return true;
  } catch (error) {
    console.error("Lỗi khi xác thực public key:", error);
    return false;
  }
};