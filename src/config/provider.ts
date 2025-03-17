import { AnchorProvider } from '@coral-xyz/anchor';
import { connection } from './solana';
import { PublicKey } from '@solana/web3.js';

// Provider cho Anchor
export const getProvider = () => {
  // Tạo provider đơn giản
  const defaultWallet = {
    // Sử dụng PublicKey thực tế thay vì null
    publicKey: new PublicKey('11111111111111111111111111111111'),
    signTransaction: async (tx: any) => { throw new Error('Not implemented'); },
    signAllTransactions: async (txs: any[]) => { throw new Error('Not implemented'); },
  };
  
  // @ts-ignore - Bỏ qua lỗi type
  const provider = new AnchorProvider(
    connection, 
    defaultWallet,
    { commitment: 'confirmed' }
  );
  
  return provider;
}; 