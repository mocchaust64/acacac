# Hướng Dẫn Xác Minh Chữ Ký WebAuthn với Secp256r1 trên Solana

## Tóm tắt vấn đề

Khi thực hiện xác minh chữ ký WebAuthn thông qua chương trình Secp256r1SigVerify của Solana, có thể gặp lỗi `{"InstructionError":[0,{"Custom":2}]}`. Đây là lỗi từ chương trình Secp256r1SigVerify báo hiệu chữ ký không hợp lệ.

## Nguyên nhân gốc rễ

Qua phân tích mã nguồn, có một số nguyên nhân chính:

1. **Sử Dụng Sai Dữ Liệu Xác Minh**: WebAuthn không ký trực tiếp message mà ký dữ liệu đặc biệt
2. **Chuyển Đổi Định Dạng Chữ Ký Không Đúng**: Cần chuyển đổi chính xác từ DER sang raw format
3. **Thiếu Chuẩn Hóa Low-S**: Solana yêu cầu chữ ký ở dạng Low-S

## Phương pháp đúng để xác minh chữ ký WebAuthn trên Solana

### 1. Tạo Dữ Liệu Xác Minh Đúng

WebAuthn không ký trực tiếp message được cung cấp. Thay vào đó, nó ký một tổ hợp dữ liệu bao gồm:

```javascript
// Trong hàm xử lý xác minh chữ ký
// 1. Lấy client data hash
const clientDataHash = await crypto.subtle.digest('SHA-256', assertion.clientDataJSON);
const clientDataHashBytes = new Uint8Array(clientDataHash);

// 2. Tạo verification data bằng cách ghép authenticatorData và clientDataHash
const verificationData = new Uint8Array(assertion.authenticatorData.length + clientDataHashBytes.length);
verificationData.set(new Uint8Array(assertion.authenticatorData), 0);
verificationData.set(clientDataHashBytes, assertion.authenticatorData.length);

// 3. Sử dụng verificationData làm message khi gọi Secp256r1SigVerify
const secp256r1Ix = createSecp256r1Instruction(
  Buffer.from(verificationData),
  webAuthnPubKey,
  normalizedSignature,
  false // hoặc true, nên thử cả hai
);
```

### 2. Chuyển Đổi Chữ Ký DER sang Raw Format

WebAuthn trả về chữ ký trong định dạng DER, nhưng Solana cần định dạng raw (r||s):

```javascript
function derToRaw(derSignature) {
  // Kiểm tra format DER
  if (derSignature[0] !== 0x30) {
    throw new Error('Chữ ký không đúng định dạng DER');
  }
  
  // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  const rLength = derSignature[3];
  const rStart = 4;
  const rEnd = rStart + rLength;
  
  const sLength = derSignature[rEnd + 1];
  const sStart = rEnd + 2;
  const sEnd = sStart + sLength;
  
  // Trích xuất r và s
  let r = derSignature.slice(rStart, rEnd);
  let s = derSignature.slice(sStart, sEnd);
  
  // Chuẩn bị r và s cho định dạng raw (mỗi phần 32 bytes)
  const rPadded = new Uint8Array(32);
  const sPadded = new Uint8Array(32);
  
  if (r.length <= 32) {
    // Thêm padding cho r
    rPadded.set(new Uint8Array(r), 32 - r.length);
  } else {
    // Lấy 32 bytes cuối (trường hợp có byte 0x00 ở đầu)
    rPadded.set(new Uint8Array(r.slice(r.length - 32)));
  }
  
  if (s.length <= 32) {
    // Thêm padding cho s
    sPadded.set(new Uint8Array(s), 32 - s.length);
  } else {
    // Lấy 32 bytes cuối
    sPadded.set(new Uint8Array(s.slice(s.length - 32)));
  }
  
  // Nối r và s
  const rawSignature = new Uint8Array(64);
  rawSignature.set(rPadded, 0);
  rawSignature.set(sPadded, 32);
  
  return rawSignature;
}
```

### 3. Chuẩn Hóa Chữ Ký về Dạng Low-S

Solana yêu cầu chữ ký ở dạng Low-S để tránh signature malleability:

```javascript
function normalizeSignatureToLowS(signature) {
  const r = signature.slice(0, 32);
  const s = signature.slice(32, 64);
  
  const sBN = new BN(s);
  
  // Kiểm tra nếu s > half_order
  if (sBN.gt(SECP256R1_HALF_ORDER)) {
    // Tính s' = order - s
    const sNormalized = SECP256R1_ORDER.sub(sBN);
    const sNormalizedBuffer = sNormalized.toArrayLike(Buffer, 'be', 32);
    return Buffer.concat([r, sNormalizedBuffer]);
  }
  
  return signature;
}
```

### 4. Tạo Instruction Secp256r1 Đúng Cách

```javascript
function createSecp256r1Instruction(message, publicKey, signature, shouldFlipPublicKey = false) {
  // Các hằng số
  const COMPRESSED_PUBKEY_SIZE = 33;
  const SIGNATURE_SIZE = 64;
  const DATA_START = 16; // 1 byte + 1 byte padding + 14 bytes offsets
  const SIGNATURE_OFFSETS_START = 2;
  
  // Xử lý flip public key nếu cần
  let pubkeyToUse = publicKey;
  if (shouldFlipPublicKey) {
    pubkeyToUse = Buffer.from(publicKey);
    pubkeyToUse[0] = pubkeyToUse[0] === 0x02 ? 0x03 : 0x02;
  }

  // Tính tổng kích thước dữ liệu
  const totalSize = DATA_START + SIGNATURE_SIZE + COMPRESSED_PUBKEY_SIZE + message.length;
  const instructionData = Buffer.alloc(totalSize);

  // Tính offset
  const numSignatures = 1;
  const publicKeyOffset = DATA_START;
  const signatureOffset = publicKeyOffset + COMPRESSED_PUBKEY_SIZE;
  const messageDataOffset = signatureOffset + SIGNATURE_SIZE;

  // Ghi số lượng chữ ký và padding
  instructionData.writeUInt8(numSignatures, 0);
  instructionData.writeUInt8(0, 1); // padding

  // Chuẩn bị offsets
  const offsets = {
    signature_offset: signatureOffset,
    signature_instruction_index: 0xffff, // u16::MAX
    public_key_offset: publicKeyOffset,
    public_key_instruction_index: 0xffff,
    message_data_offset: messageDataOffset,
    message_data_size: message.length,
    message_instruction_index: 0xffff,
  };

  // Ghi offsets vào instruction data
  instructionData.writeUInt16LE(offsets.signature_offset, SIGNATURE_OFFSETS_START);
  instructionData.writeUInt16LE(offsets.signature_instruction_index, SIGNATURE_OFFSETS_START + 2);
  instructionData.writeUInt16LE(offsets.public_key_offset, SIGNATURE_OFFSETS_START + 4);
  instructionData.writeUInt16LE(offsets.public_key_instruction_index, SIGNATURE_OFFSETS_START + 6);
  instructionData.writeUInt16LE(offsets.message_data_offset, SIGNATURE_OFFSETS_START + 8);
  instructionData.writeUInt16LE(offsets.message_data_size, SIGNATURE_OFFSETS_START + 10);
  instructionData.writeUInt16LE(offsets.message_instruction_index, SIGNATURE_OFFSETS_START + 12);

  // Ghi dữ liệu vào instruction
  pubkeyToUse.copy(instructionData, publicKeyOffset);
  signature.copy(instructionData, signatureOffset);
  message.copy(instructionData, messageDataOffset);
  
  return new TransactionInstruction({
    keys: [],
    programId: SECP256R1_PROGRAM_ID,
    data: instructionData,
  });
}
```

### 5. Không Hash Message Trước Khi Gửi Đến WebAuthn

Khi gọi WebAuthn để ký, gửi message gốc làm challenge mà không hash trước:

```javascript
function getWebAuthnAssertion(credentialId, message) {
  // Tạo challenge từ message gốc không hash
  const challenge = new TextEncoder().encode(message);
  
  // Tạo options
  const options = {
    challenge: challenge,
    timeout: 60000,
    userVerification: 'required',
    allowCredentials: [{
      id: Buffer.from(credentialId, 'hex'),
      type: 'public-key',
      transports: ['internal', 'hybrid', 'usb', 'ble', 'nfc']
    }]
  };

  // Thực hiện xác thực và trả về kết quả
  return navigator.credentials.get({ publicKey: options });
}
```

### 6. Thử Cả Hai Dạng Public Key

Do một số sự khác biệt trong cách triển khai WebAuthn giữa các trình duyệt và thiết bị, nên thử cả hai cách:

```javascript
// Thử với public key không đảo byte đầu tiên
try {
  const tx1 = new Transaction().add(
    createSecp256r1Instruction(
      Buffer.from(verificationData),
      webAuthnPubKey,
      normalizedSignature,
      false
    )
  );
  
  // Thực hiện giao dịch...
  
} catch (error1) {
  // Thử với public key đảo byte đầu tiên
  const tx2 = new Transaction().add(
    createSecp256r1Instruction(
      Buffer.from(verificationData),
      webAuthnPubKey,
      normalizedSignature,
      true
    )
  );
  
  // Thực hiện giao dịch...
}
```

## Ghi chú quan trọng

1. **Thứ tự quan trọng**: Dữ liệu xác minh phải đúng thứ tự: `authenticatorData` + `hash(clientDataJSON)`
2. **Không hash message trước**: Gửi message gốc làm challenge cho WebAuthn
3. **Chuẩn hóa chữ ký**: Đảm bảo chữ ký ở dạng Low-S
4. **Thử cả hai dạng public key**: Do cách triển khai khác nhau giữa các thiết bị

## Kết luận

Để xác minh chữ ký WebAuthn với Secp256r1 trên Solana, cần phải hiểu rõ dữ liệu mà WebAuthn ký và định dạng dữ liệu mà chương trình Secp256r1SigVerify yêu cầu. Bằng cách tuân theo các bước trên, có thể thực hiện xác minh chữ ký WebAuthn thành công trên blockchain Solana. 