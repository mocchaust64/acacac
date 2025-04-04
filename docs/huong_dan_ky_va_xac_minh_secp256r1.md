# Hướng dẫn sử dụng Secp256r1 trong Agave/Solana

## 1. Giới thiệu

Secp256r1 (còn được gọi là P-256 hoặc NIST P-256) là một đường cong elliptic được sử dụng rộng rãi trong mật mã. Trong Solana/Agave, Secp256r1 được triển khai như một chương trình precompiled native có địa chỉ cố định `Secp256r1SigVerify1111111111111111111111111`, cho phép xác thực chữ ký ECDSA dựa trên đường cong secp256r1.

Đây là đường cong chính được sử dụng trong WebAuthn/FIDO2, được hỗ trợ bởi hầu hết các thiết bị phần cứng bảo mật như YubiKey, Touch ID của Apple, và Windows Hello.

## 2. Thông số kỹ thuật của Secp256r1 trong Agave

### 2.1. Các hằng số quan trọng

- **COMPRESSED_PUBKEY_SERIALIZED_SIZE**: 33 bytes - Kích thước khóa công khai ở định dạng nén
- **SIGNATURE_SERIALIZED_SIZE**: 64 bytes - Kích thước chữ ký (32 bytes cho r và 32 bytes cho s)
- **FIELD_SIZE**: 32 bytes - Kích thước của mỗi thành phần r hoặc s trong chữ ký
- **SECP256R1_ORDER**: Bậc của đường cong (n)
- **SECP256R1_HALF_ORDER**: n/2, được sử dụng cho kiểm tra Low-S
- **SECP256R1_ORDER_MINUS_ONE**: n-1, được sử dụng để kiểm tra phạm vi hợp lệ

### 2.2. Cấu trúc dữ liệu Offsets

Để gọi chương trình Secp256r1SigVerify, cần chuẩn bị dữ liệu đầu vào với định dạng:

```
[số lượng chữ ký (1 byte)] [padding (1 byte)]
[offsets (14 bytes)]
[khóa công khai (33 bytes, dạng nén)]
[chữ ký (64 bytes)]
[tin nhắn]
```

Trong đó:
- **Số lượng chữ ký**: Thường là 1
- **Offsets**: Chứa thông tin vị trí của khóa công khai, chữ ký và tin nhắn
- **Khóa công khai**: Dạng nén (compressed format) 33 bytes
- **Chữ ký**: 64 bytes (r và s, mỗi phần 32 bytes)
- **Tin nhắn**: Nội dung cần xác minh chữ ký

## 3. Cách thức hoạt động

### 3.1. Quá trình xác thực chữ ký

- **Kiểm tra số lượng chữ ký**: Tối đa 8 chữ ký có thể được xác thực trong một lần gọi
- **Trích xuất dữ liệu**: Sử dụng offsets để trích xuất chữ ký, khóa công khai và message
- **Kiểm tra phạm vi hợp lệ**:
  - r và s phải lớn hơn 1
  - r phải nhỏ hơn n-1
  - s phải nhỏ hơn n/2 (đảm bảo chuẩn Low-S)
- **Tạo đối tượng chữ ký ECDSA**: Chuyển đổi r, s thành định dạng ASN.1 DER
- **Tạo đối tượng khóa công khai**: Từ khóa công khai nén (33 bytes)
- **Xác thực với SHA-256**: Sử dụng OpenSSL để xác thực chữ ký

### 3.2. Yêu cầu định dạng dữ liệu

- **Khóa công khai**: Định dạng nén (33 bytes), byte đầu tiên là 0x02 hoặc 0x03
- **Chữ ký**: 64 bytes, gồm r (32 bytes) theo sau là s (32 bytes)
- **Message**: Đã được hash bằng SHA-256 hoặc sẽ được hash trong quá trình xác thực

## 4. Hướng dẫn sử dụng trong ứng dụng

### 4.1. Tạo instruction để xác thực chữ ký

```javascript
function createSecp256r1Instruction(message, pubkey, signature) {
  const totalSize = DATA_START + SIGNATURE_SERIALIZED_SIZE + COMPRESSED_PUBKEY_SERIALIZED_SIZE + message.length;
  const instructionData = Buffer.alloc(totalSize);

  // Tính offset
  const numSignatures = 1;
  const publicKeyOffset = DATA_START;
  const signatureOffset = publicKeyOffset + COMPRESSED_PUBKEY_SERIALIZED_SIZE;
  const messageDataOffset = signatureOffset + SIGNATURE_SERIALIZED_SIZE;

  // Ghi số lượng chữ ký
  instructionData.writeUInt8(numSignatures, 0);
  instructionData.writeUInt8(0, 1); // padding

  // Tạo và ghi offset
  const offsets = {
    signature_offset: signatureOffset,
    signature_instruction_index: 0xffff, // u16::MAX
    public_key_offset: publicKeyOffset,
    public_key_instruction_index: 0xffff,
    message_data_offset: messageDataOffset,
    message_data_size: message.length,
    message_instruction_index: 0xffff,
  };

  // Ghi offsets
  instructionData.writeUInt16LE(offsets.signature_offset, SIGNATURE_OFFSETS_START);
  instructionData.writeUInt16LE(offsets.signature_instruction_index, SIGNATURE_OFFSETS_START + 2);
  instructionData.writeUInt16LE(offsets.public_key_offset, SIGNATURE_OFFSETS_START + 4);
  instructionData.writeUInt16LE(offsets.public_key_instruction_index, SIGNATURE_OFFSETS_START + 6);
  instructionData.writeUInt16LE(offsets.message_data_offset, SIGNATURE_OFFSETS_START + 8);
  instructionData.writeUInt16LE(offsets.message_data_size, SIGNATURE_OFFSETS_START + 10);
  instructionData.writeUInt16LE(offsets.message_instruction_index, SIGNATURE_OFFSETS_START + 12);

  // Ghi dữ liệu vào instruction
  pubkey.copy(instructionData, publicKeyOffset);
  signature.copy(instructionData, signatureOffset);
  message.copy(instructionData, messageDataOffset);

  return new TransactionInstruction({
    keys: [],
    programId: SECP256R1_PROGRAM_ID,
    data: instructionData,
  });
}
```

### 4.2. Xử lý chữ ký WebAuthn

WebAuthn trả về chữ ký ở định dạng DER, cần chuyển đổi sang định dạng raw (r||s):

```javascript
function convertDERSignatureToRaw(derSignature) {
  // Phân tích cấu trúc DER
  const derAsn = asn1.fromDer(derSignature.toString('hex'));
  
  // Lấy các giá trị r và s từ ASN.1
  const r = BigInteger.fromHex(derAsn.value[0].value);
  const s = BigInteger.fromHex(derAsn.value[1].value);
  
  // Chuyển đổi sang Buffer có độ dài cố định 32 bytes
  const rBuffer = Buffer.from(r.toHex().padStart(64, '0'), 'hex');
  const sBuffer = Buffer.from(s.toHex().padStart(64, '0'), 'hex');
  
  // Nối r và s thành một buffer 64 bytes
  return Buffer.concat([rBuffer, sBuffer]);
}
```

### 4.3. Chuẩn hóa chữ ký về dạng Low-S

Solana/Agave yêu cầu chữ ký ở dạng Low-S để tránh signature malleability:

```javascript
function normalizeSignatureToLowS(signature) {
  const r = signature.slice(0, 32);
  const s = signature.slice(32, 64);
  
  const sBigInt = new BN(s);
  
  // Kiểm tra nếu s > half_order, thì s = order - s
  if (sBigInt.gt(SECP256R1_HALF_ORDER)) {
    const sNormalized = SECP256R1_ORDER.sub(sBigInt);
    const sNormalizedBuffer = Buffer.from(sNormalized.toArray('be', 32));
    return Buffer.concat([r, sNormalizedBuffer]);
  }
  
  return signature;
}
```

## 5. Tích hợp với WebAuthn và Solana

### 5.1. Xác thực người dùng với WebAuthn và ký giao dịch

```javascript
async function verifyWebAuthnSignature(message, publicKey, signature) {
  // Chuyển đổi chữ ký DER sang raw
  const rawSignature = convertDERSignatureToRaw(signature);
  
  // Chuẩn hóa về low-S
  const normalizedSignature = normalizeSignatureToLowS(rawSignature);
  
  // Tạo instruction xác thực chữ ký
  const verifyInstruction = createSecp256r1Instruction(
    message,
    publicKey,
    normalizedSignature
  );
  
  // Thêm instruction vào transaction
  const transaction = new Transaction().add(verifyInstruction);
  
  // Gửi transaction
  return await sendAndConfirmTransaction(connection, transaction, [payer]);
}
```

### 5.2. Tích hợp với Smart Contract

Để tích hợp WebAuthn với smart contract trên Solana, cần:
- Thêm instruction secp256r1 đầu tiên trong transaction
- Thêm instruction của smart contract với dữ liệu liên quan
- Verify trong contract: Kiểm tra thông tin giao dịch khớp với message được ký

```javascript
async function integrateWithSmartContract(message, publicKey, signature, contractInstruction) {
  // Tạo instruction xác thực chữ ký
  const verifyInstruction = createSecp256r1Instruction(
    message,
    publicKey,
    normalizeSignatureToLowS(convertDERSignatureToRaw(signature))
  );
  
  // Tạo transaction với cả hai instruction
  const transaction = new Transaction()
    .add(verifyInstruction)
    .add(contractInstruction);
  
  // Gửi transaction
  return await sendAndConfirmTransaction(connection, transaction, [payer]);
}
```

## 6. Các vấn đề thường gặp và cách khắc phục

### 6.1. InvalidSignature

**Nguyên nhân**:
- Giá trị S quá lớn (> half_order)
- r hoặc s không nằm trong phạm vi hợp lệ
- Chữ ký không khớp với message hoặc public key

**Giải pháp**:
- Đảm bảo chữ ký đã được chuẩn hóa về dạng Low-S
- Kiểm tra định dạng chữ ký (64 bytes, r||s)
- Kiểm tra lại message hash

### 6.2. InvalidPublicKey

**Nguyên nhân**:
- Khóa công khai không ở định dạng nén
- Khóa không thuộc đường cong secp256r1

**Giải pháp**:
- Đảm bảo khóa công khai ở định dạng nén (33 bytes)
- Kiểm tra byte đầu tiên là 0x02 hoặc 0x03
- Xác minh khóa thuộc đường cong secp256r1

### 6.3. InvalidDataOffsets

**Nguyên nhân**:
- Offset không chính xác trong instruction data
- Dữ liệu vượt quá giới hạn

**Giải pháp**:
- Kiểm tra lại cách tính offset trong instruction data
- Đảm bảo kích thước dữ liệu chính xác

## 7. So sánh với Ed25519

| Thuộc tính | Secp256r1 (P-256) | Ed25519 |
|------------|-------------------|---------|
| Đường cong | NIST P-256 | Curve25519 |
| Kích thước khóa | 32 bytes | 32 bytes |
| Kích thước chữ ký | 64 bytes | 64 bytes |
| Hỗ trợ thiết bị | Rộng rãi (Apple, Windows, YubiKey) | Giới hạn hơn |
| Tích hợp WebAuthn | Được hỗ trợ natively | Không hỗ trợ trực tiếp |
| Tốc độ xác thực | Chậm hơn một chút | Nhanh hơn |
| Mức độ bảo mật | Cao (NIST chuẩn) | Cao (cải tiến hơn) |

## 8. Kết luận

Secp256r1 là một chuẩn mật mã mạnh mẽ và được hỗ trợ rộng rãi trong các thiết bị phần cứng và WebAuthn. Trên Solana/Agave, chương trình native Secp256r1SigVerify cung cấp khả năng xác thực chữ ký secp256r1 hiệu quả, cho phép tích hợp với WebAuthn và cung cấp trải nghiệm người dùng an toàn và thân thiện hơn.

Việc kết hợp với WebAuthn cho phép sử dụng sinh trắc học (vân tay, Face ID) để ký giao dịch blockchain, cải thiện đáng kể trải nghiệm và bảo mật cho người dùng.

Kiểm tra của chúng ta đã xác nhận rằng:

1. Solana hỗ trợ xác minh chữ ký secp256r1 thông qua chương trình native `Secp256r1SigVerify1111111111111111111111111`
2. Việc xác minh được thực hiện hoàn toàn trên blockchain, không chỉ ở phía client
3. Cơ chế xác minh chính xác, từ chối các chữ ký không hợp lệ
4. Chức năng này có thể được sử dụng để tích hợp các giải pháp xác thực bảo mật FIDO2/WebAuthn vào ứng dụng Solana
``` 