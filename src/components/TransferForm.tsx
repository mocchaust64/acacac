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

// Enum cho các trạng thái giao dịch
enum TransactionStatus {
  IDLE = 'idle',
  PREPARING = 'preparing',
  SIGNING = 'signing',
  BUILDING_TX = 'building_tx',
  SUBMITTING = 'submitting',
  CONFIRMING = 'confirming',
  SUCCESS = 'success',
  ERROR = 'error'
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
  const [txStatus, setTxStatus] = useState<TransactionStatus>(TransactionStatus.IDLE);
  const [txId, setTxId] = useState<string>('');
  
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
    setTxStatus(TransactionStatus.IDLE);
    setTxId('');
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
      setTxStatus(TransactionStatus.IDLE);
      setTxId('');
    }
  };
  
  // Xử lý khi submit form - cập nhật phần check balance để sử dụng pdaBalance từ props
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    setIsTransferring(true);
    setError('');
    setSuccess('');
    setTxStatus(TransactionStatus.PREPARING);
    setTxId('');
    
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
      
      // Ký message bằng WebAuthn
      setTxStatus(TransactionStatus.SIGNING);
      
      // Hiển thị thông báo để người dùng biết cần xác thực
      console.log('Đang yêu cầu xác thực WebAuthn...');
      setError(''); // Xóa thông báo lỗi trước đó
      setSuccess('Đang hiển thị danh sách khóa WebAuthn, vui lòng chọn khóa để xác thực giao dịch...');
      
      // Thực hiện xác thực WebAuthn - truyền null cho credentialId để hiển thị danh sách tất cả credentials
      const assertion = await getWebAuthnAssertion(null as any, messageString, true);
      
      if (!assertion) {
        throw new Error('Lỗi khi ký message bằng WebAuthn hoặc người dùng đã hủy xác thực');
      }
      
      console.log('Đã ký thành công bằng WebAuthn');
      setSuccess(''); // Xóa thông báo thành công tạm thời
      
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
      setTxStatus(TransactionStatus.BUILDING_TX);
      
      const secp256r1Ix = createSecp256r1Instruction(
        publicKey,
        signature,
        Buffer.from(messageHashBytes)
      );
      
      // Fee payer (tạm thời là keypair ngẫu nhiên)
      const feePayer = web3.Keypair.generate();
      
      // Xin SOL airdrop để trả phí
      const airdropSignature = await connection.requestAirdrop(
        feePayer.publicKey,
        web3.LAMPORTS_PER_SOL / 100 // 0.01 SOL để trả phí
      );
      await connection.confirmTransaction(airdropSignature);
      
      // Tạo instruction verify_and_execute
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
      setTxStatus(TransactionStatus.SUBMITTING);
      
      const transactionId = await connection.sendRawTransaction(transferTx.serialize());
      setTxId(transactionId);
      console.log('Transaction ID:', transactionId);
      
      // Chờ xác nhận
      setTxStatus(TransactionStatus.CONFIRMING);
      
      const confirmation = await connection.confirmTransaction(transactionId);
      
      if (confirmation.value.err) {
        throw new Error(`Lỗi khi xác nhận giao dịch: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      // Hiển thị thông báo thành công
      setTxStatus(TransactionStatus.SUCCESS);
      setSuccess(`Đã chuyển ${amount} SOL đến ${destinationAddress} thành công! ID giao dịch: ${transactionId}`);
      setAmount('');
      setDestinationAddress('');
      
      // Gọi callback nếu có
      if (onTransferSuccess) {
        onTransferSuccess();
      }
    } catch (error: any) {
      console.error('Lỗi khi chuyển tiền:', error);
      setError(error.message || 'Đã xảy ra lỗi khi chuyển tiền');
      setTxStatus(TransactionStatus.ERROR);
      
      // Gọi callback lỗi nếu có
      if (onTransferError) {
        onTransferError(error);
      }
    } finally {
      setIsTransferring(false);
    }
  };
  
  // Render status message dựa trên txStatus
  const renderStatusMessage = () => {
    switch (txStatus) {
      case TransactionStatus.PREPARING:
        return 'Đang chuẩn bị giao dịch...';
      case TransactionStatus.SIGNING:
        return 'Vui lòng xác thực bằng WebAuthn (vân tay hoặc Face ID) khi được yêu cầu...';
      case TransactionStatus.BUILDING_TX:
        return 'Đang xây dựng giao dịch...';
      case TransactionStatus.SUBMITTING:
        return 'Đang gửi giao dịch lên blockchain...';
      case TransactionStatus.CONFIRMING:
        return 'Đang chờ xác nhận giao dịch...';
      case TransactionStatus.SUCCESS:
        return 'Giao dịch thành công!';
      case TransactionStatus.ERROR:
        return 'Giao dịch thất bại!';
      default:
        return '';
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
        
        {success && <div className="success-message">{success}</div>}
        {error && <div className="error-message">{error}</div>}
        
        {txStatus !== TransactionStatus.IDLE && (
          <div className="status-message">
            <p>{renderStatusMessage()}</p>
            {txStatus === TransactionStatus.CONFIRMING && (
              <div className="loading-indicator">Đang xác nhận...</div>
            )}
            {txId && (
              <p className="transaction-id">
                ID Giao dịch: <a href={`https://explorer.solana.com/tx/${txId}`} target="_blank" rel="noopener noreferrer">{txId.slice(0, 8)}...{txId.slice(-8)}</a>
              </p>
            )}
          </div>
        )}
        
        <button 
          type="submit" 
          className="primary-button" 
          disabled={isTransferring}
        >
          {isTransferring ? 'Đang xử lý...' : 'Chuyển SOL'}
        </button>
      </form>
      
      <style>
        {`
          .success-message, .error-message {
            margin: 12px 0;
            padding: 10px;
            border-radius: 4px;
            font-weight: 500;
          }
          
          .success-message {
            background-color: rgba(0, 200, 83, 0.1);
            color: #00C853;
            border: 1px solid #00C853;
          }
          
          .error-message {
            background-color: rgba(255, 87, 34, 0.1);
            color: #FF5722;
            border: 1px solid #FF5722;
          }
          
          .status-message {
            margin: 12px 0;
            padding: 10px;
            background-color: rgba(33, 150, 243, 0.1);
            border: 1px solid #2196F3;
            border-radius: 4px;
            color: #2196F3;
          }
          
          .loading-indicator {
            margin-top: 8px;
            font-style: italic;
          }
          
          .transaction-id {
            margin-top: 8px;
            word-break: break-all;
            font-size: 14px;
          }
          
          .transaction-id a {
            color: #2196F3;
            text-decoration: none;
          }
          
          .transaction-id a:hover {
            text-decoration: underline;
          }
        `}
      </style>
    </div>
  );
}; 