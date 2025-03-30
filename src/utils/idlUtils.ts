import { Idl } from '@coral-xyz/anchor';
import * as web3 from '@solana/web3.js';
import { AnchorProvider, Program } from '@coral-xyz/anchor';

import { Connection, Transaction, VersionedTransaction } from '@solana/web3.js';

// Tự định nghĩa interface Wallet phù hợp với AnchorProvider
interface WalletInterface {
  publicKey: web3.PublicKey;
  signTransaction(tx: web3.Transaction): Promise<web3.Transaction>;
  signAllTransactions(txs: web3.Transaction[]): Promise<web3.Transaction[]>;
}

/**
 * Chuyển đổi IDL để phù hợp với định dạng Anchor cần
 */
export const convertIdl = (rawIdl: any) => {
  try {
    // Lấy Program ID từ env hoặc IDL
    const programID = process.env.REACT_APP_PROGRAM_ID || rawIdl.address;
    
    const connection = new web3.Connection(
      process.env.REACT_APP_RPC_ENDPOINT || 'https://api.devnet.solana.com',
      'confirmed'
    );
    
    // Tạo provider đơn giản
    const provider = {
      connection,
      publicKey: web3.Keypair.generate().publicKey
    };
    
    // Tạo coder từ IDL trước khi tạo Program
    // Tránh vấn đề với việc phân tích IDL trong constructor của Program
    return {
      programId: new web3.PublicKey(programID),
      provider: provider as any,
      methods: {},
      account: {},
      address: programID,
      idl: rawIdl
    };
  } catch (error) {
    console.error("Lỗi khi tạo Program từ IDL:", error);
    throw error;
  }
};

// Hàm chuyển đổi kiểu dữ liệu
function convertType(type: any): any {
  if (typeof type === 'string') {
    return type;
  }
  
  if (type.array) {
    return { array: [convertType(type.array[0]), type.array[1]] };
  }
  
  if (type.vec) {
    return { vec: convertType(type.vec) };
  }
  
  if (type.option) {
    return { option: convertType(type.option) };
  }
  
  if (type.defined) {
    return { defined: type.defined };
  }
  
  return type;
}