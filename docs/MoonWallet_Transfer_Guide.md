# Tài liệu: Hướng dẫn sử dụng chức năng chuyển tiền SOL trong MoonWallet

## 1. Tổng quan

MoonWallet sử dụng công nghệ WebAuthn kết hợp với Solana để đảm bảo an toàn khi chuyển SOL. Cơ chế này giúp xác thực người dùng thông qua sinh trắc học (vân tay, FaceID) trước khi thực hiện giao dịch.

## 2. Cơ chế hoạt động

### 2.1. Lưu trữ tiền
- SOL được lưu trong tài khoản PDA (Program Derived Address) được tạo từ credential ID
- PDA này vừa chứa dữ liệu ví (thông tin guardians) vừa lưu trữ SOL

### 2.2. Quy trình chuyển tiền
1. Frontend tạo thông điệp với định dạng:
   ```
   transfer:<số_SOL>_SOL_to_<địa_chỉ_nhận>,nonce:<số_nonce>,timestamp:<thời_gian>,pubkey:<hash_public_key>
   ```

2. Người dùng xác thực bằng WebAuthn (vân tay/FaceID)

3. Contract xác minh:
   - Chữ ký WebAuthn hợp lệ
   - Thông điệp khớp với dữ liệu giao dịch
   - Nonce và timestamp hợp lệ

4. Khi đã xác minh, contract chuyển SOL bằng cách điều chỉnh số dư lamports của tài khoản nguồn (PDA) và tài khoản đích

## 3. Sử dụng trong frontend

### 3.1. Chuẩn bị dữ liệu
```javascript
// Lấy các thông tin cần thiết
const destinationAddress = "địa_chỉ_người_nhận";
const amountInSol = 1; // Số SOL muốn chuyển
const amountInLamports = amountInSol * LAMPORTS_PER_SOL;
const nextNonce = currentNonce + 1;
const timestamp = Math.floor(Date.now() / 1000);

// Tính hash của WebAuthn public key (lấy 6 bytes đầu)
const publicKeyHash = sha256(webAuthnPublicKey).slice(0, 6);
const publicKeyHashHex = Buffer.from(publicKeyHash).toString('hex');

// Tạo thông điệp chuyển tiền
const message = `transfer:${amountInSol}_SOL_to_${destinationAddress},nonce:${nextNonce},timestamp:${timestamp},pubkey:${publicKeyHashHex}`;
```

### 3.2. Xác thực và ký
```javascript
// Xác thực WebAuthn với thông điệp đã tạo
const assertion = await navigator.credentials.get({
  publicKey: {
    challenge: new TextEncoder().encode(message),
    allowCredentials: [{
      id: credentialId,
      type: 'public-key'
    }],
    userVerification: 'required'
  }
});

// Lấy dữ liệu từ kết quả xác thực
const signature = assertion.response.signature;
const clientDataJSON = assertion.response.clientDataJSON;
```

### 3.3. Gửi giao dịch
```javascript
// Tạo secp256r1 instruction để xác thực chữ ký WebAuthn
const secp256r1Instruction = createSecp256r1Instruction(
  webAuthnPublicKey,
  signature,
  clientDataJSON
);

// Tạo instruction chuyển tiền
const transferInstruction = createTransferInstruction(
  multisigPDA,
  guardianPDA,
  destinationAddress,
  amountInLamports,
  nextNonce,
  timestamp,
  message
);

// Tạo và gửi transaction
const transaction = new Transaction().add(secp256r1Instruction, transferInstruction);
const signature = await sendAndConfirmTransaction(connection, transaction, [feePayer]);
```

## 4. Lưu ý quan trọng

1. **Xử lý số dư**:
   - Luôn kiểm tra số dư trước khi chuyển
   - Số lượng chuyển là số nguyên lamports, không phải số thập phân SOL

2. **Định dạng số**:
   - Khi hiển thị, sử dụng `amount / LAMPORTS_PER_SOL` để chuyển từ lamports sang SOL
   - Đảm bảo định dạng số khớp giữa frontend và contract

3. **Bảo mật**:
   - Nonce tăng dần, không tái sử dụng
   - Timestamp trong khoảng hợp lệ (không quá cũ, không trong tương lai)
   - Hash public key phòng tránh tấn công thay đổi khóa

4. **Xử lý lỗi**:
   - `InvalidNonce`: Kiểm tra nonce lấy từ contract
   - `InsufficientFunds`: Kiểm tra số dư ví
   - `MessageMismatch`: Đảm bảo định dạng thông điệp chính xác
   - `ExpiredTimestamp`: Đồng bộ thời gian hệ thống

## 5. Chi tiết kỹ thuật

### 5.1. Cơ chế chuyển tiền trong contract
```rust
// Lấy thông tin tài khoản PDA
let multisig_info = ctx.accounts.multisig.to_account_info();

// Lấy số dư hiện tại
let dest_starting_lamports = ctx.accounts.destination.lamports();
let multisig_starting_lamports = multisig_info.lamports();

// Tăng số dư tài khoản đích
**ctx.accounts.destination.lamports.borrow_mut() = dest_starting_lamports.checked_add(amount)
    .ok_or(WalletError::ArithmeticOverflow)?;

// Giảm số dư tài khoản nguồn
**multisig_info.lamports.borrow_mut() = multisig_starting_lamports.checked_sub(amount)
    .ok_or(WalletError::InsufficientFunds)?;
```

### 5.2. Cấu trúc thông điệp
| Phần | Mô tả | Ví dụ |
|------|-------|-------|
| Prefix | Loại giao dịch | `transfer:` |
| Số lượng | Số SOL cần chuyển | `1_SOL_to_` |
| Địa chỉ | Địa chỉ người nhận | `9oEcGop5FrvQu6hw3...` |
| Nonce | Số thứ tự giao dịch | `,nonce:1` |
| Timestamp | Thời gian giao dịch (Unix timestamp) | `,timestamp:1743739746` |
| Public key hash | 6 bytes đầu của hash public key | `,pubkey:a3c4ede21bdf` |

## 6. Kết luận

Cơ chế chuyển tiền hiện tại kết hợp giữa xác thực WebAuthn và điều chỉnh lamports trực tiếp trong Solana, đảm bảo tính bảo mật cao nhất cho người dùng. Việc chuyển SOL từ PDA chứa dữ liệu hoạt động hiệu quả và an toàn.

Hiện tại, cơ chế này chỉ áp dụng cho việc chuyển SOL. Nếu muốn mở rộng sang SPL tokens, cần phát triển thêm các chức năng sử dụng Token Program. 