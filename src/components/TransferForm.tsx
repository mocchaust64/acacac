import React, { useState, useEffect } from 'react';
import { PublicKey, Transaction, Connection } from '@solana/web3.js';
import { web3 } from '@coral-xyz/anchor';
// Xóa useConnection hook vì sẽ nhận connection từ props
// import { useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { 
  createTransferTx, 
  createSecp256r1Instruction 
} from '../utils/transactionUtils';
import { getWebAuthnAssertion } from '../utils/webauthnUtils';
import { getGuardianPDA, getMultisigPDA } from '../utils/credentialUtils';

// Interface cho props của component
interface TransferFormProps {
  walletAddress: string;  
  credentialId: string;   
  guardianId: number;     
  onTransferSuccess?: () => void;
  onTransferError?: (error: Error) => void;
  // Thêm connection vào props
  connection: Connection;
  // Thêm pdaBalance để hiển thị số dư chính xác
  pdaBalance?: number;
}

export const TransferForm: React.FC<TransferFormProps> = ({
  walletAddress,
  credentialId,
  guardianId,
  onTransferSuccess,
  onTransferError,
  // Thêm connection và pdaBalance vào tham số destructuring
  connection,
  pdaBalance = 0
}) => {
  // State
  const [destinationAddress, setDestinationAddress] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [nonce, setNonce] = useState<number>(0);
  
  // Xóa dòng này vì đã nhận connection từ props
  // const { connection } = useConnection();
  
  // Cập nhật walletBalance khi pdaBalance thay đổi
  useEffect(() => {
    if (pdaBalance !== undefined) {
      setWalletBalance(pdaBalance);
    }
  }, [pdaBalance]);
  
  // Lấy số dư ví và nonce hiện tại - giữ nguyên nếu vẫn cần lấy nonce
  useEffect(() => {
    const loadWalletInfo = async () => {
      try {
        if (!walletAddress) return;
        
        // Tính PDA của ví từ credential ID
        const multisigPDA = await getMultisigPDA(credentialId);
        
        // Lấy thông tin account
        const accountInfo = await connection.getAccountInfo(multisigPDA);
        
        if (!accountInfo) {
          console.error('Không tìm thấy thông tin ví');
          return;
        }
        
        // Chỉ cập nhật nonce từ accountInfo, không cập nhật balance nữa vì đã có pdaBalance
        // const balance = await connection.getBalance(multisigPDA);
        // setWalletBalance(balance / LAMPORTS_PER_SOL);
        
        // Tạm thời đặt nonce = 0 cho demo
        setNonce(0);
      } catch (error) {
        console.error('Lỗi khi tải thông tin ví:', error);
      }
    };
    
    loadWalletInfo();
  }, [walletAddress, credentialId, connection]);
  
  // Xử lý khi nhập địa chỉ đích
  const handleDestinationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDestinationAddress(e.target.value);
    // Reset thông báo lỗi và thành công
    setError('');
    setSuccess('');
  };
  
  // Xử lý khi nhập số lượng SOL
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Chỉ cho phép nhập số dương và dấu chấm (số thập phân)
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setAmount(value);
      // Reset thông báo lỗi và thành công
      setError('');
      setSuccess('');
    }
  };
  
  // Xử lý khi submit form - cập nhật phần check balance để sử dụng pdaBalance từ props
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    setIsTransferring(true);
    setError('');
    setSuccess('');
    
    try {
      // Kiểm tra đầu vào
      if (!destinationAddress) {
        throw new Error('Vui lòng nhập địa chỉ đích');
      }
      
      if (!amount || parseFloat(amount) <= 0) {
        throw new Error('Vui lòng nhập số lượng SOL hợp lệ');
      }
      
      // Chuyển đổi số lượng SOL sang lamports
      const amountLamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);
      
      // Kiểm tra số dư - sử dụng pdaBalance từ props thay vì walletBalance từ state
      if (amountLamports > pdaBalance * LAMPORTS_PER_SOL) {
        throw new Error('Số dư không đủ để thực hiện giao dịch');
      }
      
      // Kiểm tra địa chỉ hợp lệ
      let destinationPublicKey: PublicKey;
      try {
        destinationPublicKey = new PublicKey(destinationAddress);
      } catch (error) {
        throw new Error('Địa chỉ đích không hợp lệ');
      }
      
      // Thêm 1 vào nonce hiện tại
      const nextNonce = nonce + 1;
      
      // Lấy timestamp hiện tại (giây)
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Tạo message chuẩn cho giao dịch chuyển tiền
      const messageString = `transfer:${amount}_SOL_to_${destinationAddress},nonce:${nextNonce},timestamp:${timestamp}`;
      console.log('Message chuẩn:', messageString);
      
      // Chuyển message thành bytes
      const messageBytes = new TextEncoder().encode(messageString);
      
      // Tính hash của message
      const messageHash = await crypto.subtle.digest('SHA-256', messageBytes);
      const messageHashBytes = new Uint8Array(messageHash);
      
      // Lấy PDA từ credential ID
      const multisigPDA = await getMultisigPDA(credentialId);
      console.log('MultisigPDA:', multisigPDA.toBase58());
      
      // Lấy PDA của guardian
      const guardianPDA = await getGuardianPDA(multisigPDA, guardianId);
      console.log('GuardianPDA:', guardianPDA.toBase58());
      
      // Yêu cầu người dùng ký message bằng WebAuthn
      setIsTransferring(true); // Hiển thị trạng thái đang ký
      
      // Hiển thị thông báo để người dùng biết cần xác thực
      console.log('Đang yêu cầu xác thực WebAuthn...');
      setError('Vui lòng xác thực bằng WebAuthn (vân tay hoặc Face ID) khi được yêu cầu');
      
      // Ký message bằng WebAuthn
      const assertion = await getWebAuthnAssertion(credentialId);
      
      if (!assertion) {
        throw new Error('Lỗi khi ký message bằng WebAuthn hoặc người dùng đã hủy xác thực');
      }
      
      // Xóa thông báo khi đã ký thành công
      setError('');
      console.log('Đã ký thành công bằng WebAuthn');
      
      // Sử dụng kết quả từ WebAuthn assertion
      const signature = Buffer.from(assertion.signature);
      
      // Lấy guardian public key từ guardianPDA
      // Trong thực tế, bạn cần truy vấn blockchain hoặc localStorage để lấy public key của guardian
      const guardianAccount = await connection.getAccountInfo(guardianPDA);
      
      if (!guardianAccount) {
        throw new Error('Không thể tìm thấy thông tin guardian');
      }
      
      // Giả định: public key được lưu trong guardianAccount.data sau 8 byte discriminator
      // Lưu ý: Đây chỉ là mẫu, bạn cần điều chỉnh logic này dựa trên cấu trúc dữ liệu thực tế của guardian account
      // Nếu không thể truy xuất public key, bạn có thể dùng một dummy key tạm thời để testing
      const publicKey = Buffer.alloc(33); // Compressed public key (33 bytes)
      publicKey[0] = 0x02; // Compressed key bắt đầu với 0x02 hoặc 0x03
      crypto.getRandomValues(publicKey.slice(1)); // Điền phần còn lại bằng dữ liệu ngẫu nhiên (chỉ để test)
      
      // Tạo instruction secp256r1
      const secp256r1Ix = createSecp256r1Instruction(
        publicKey,
        signature,
        Buffer.from(messageHashBytes)
      );
      
      // Fee payer (tạm thời là keypair ngẫu nhiên)
      const feePayer = web3.Keypair.generate();
      
      // Xin SOL airdrop để trả phí
      setError('Đang yêu cầu SOL để trả phí giao dịch...');
      const airdropSignature = await connection.requestAirdrop(
        feePayer.publicKey,
        web3.LAMPORTS_PER_SOL / 100 // 0.01 SOL để trả phí
      );
      await connection.confirmTransaction(airdropSignature);
      
      // Tạo instruction verify_and_execute
      setError('Đang xây dựng giao dịch...');
      const transferTx = createTransferTx(
        multisigPDA,
        guardianPDA,
        destinationPublicKey,
        amountLamports,
        nextNonce,
        timestamp,
        messageBytes,
        feePayer.publicKey
      );
      
      // Thêm cả hai instruction vào transaction
      transferTx.add(secp256r1Ix);
      
      // Đặt fee payer và blockhash
      transferTx.feePayer = feePayer.publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      transferTx.recentBlockhash = blockhash;
      
      // Ký transaction bằng fee payer
      transferTx.sign(feePayer);
      
      // Gửi transaction
      setError('Đang gửi giao dịch lên blockchain...');
      const txId = await connection.sendRawTransaction(transferTx.serialize());
      console.log('Transaction ID:', txId);
      
      // Chờ xác nhận
      setError('Đang chờ xác nhận giao dịch...');
      const confirmation = await connection.confirmTransaction(txId);
      
      if (confirmation.value.err) {
        throw new Error(`Lỗi khi xác nhận giao dịch: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      // Hiển thị thông báo thành công
      setError('');
      setSuccess(`Đã chuyển ${amount} SOL đến ${destinationAddress} thành công! ID giao dịch: ${txId}`);
      setAmount('');
      setDestinationAddress('');
      
      // Gọi callback nếu có
      if (onTransferSuccess) {
        onTransferSuccess();
      }
    } catch (error: any) {
      console.error('Lỗi khi chuyển tiền:', error);
      setError(error.message || 'Đã xảy ra lỗi khi chuyển tiền');
      
      // Gọi callback lỗi nếu có
      if (onTransferError) {
        onTransferError(error);
      }
    } finally {
      setIsTransferring(false);
    }
  };
  
  return (
    <div className="transfer-form">
      <h2>Chuyển SOL</h2>
      
      <div className="wallet-info">
        <p>Số dư hiện tại: <strong>{pdaBalance.toFixed(5)} SOL</strong></p>
      </div>
      
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="destination">Địa chỉ đích:</label>
          <input
            type="text"
            id="destination"
            value={destinationAddress}
            onChange={handleDestinationChange}
            placeholder="Nhập địa chỉ Solana"
            disabled={isTransferring}
            required
          />
        </div>
        
        <div className="form-group">
          <label htmlFor="amount">Số lượng SOL:</label>
          <input
            type="text"
            id="amount"
            value={amount}
            onChange={handleAmountChange}
            placeholder="Ví dụ: 0.1"
            disabled={isTransferring}
            required
          />
        </div>
        
        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}
        
        <button 
          type="submit" 
          className="primary-button" 
          disabled={isTransferring}
        >
          {isTransferring ? 'Đang chuyển...' : 'Chuyển SOL'}
        </button>
      </form>
    </div>
  );
}; 