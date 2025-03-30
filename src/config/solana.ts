import { Connection, PublicKey } from '@solana/web3.js';

// Khai báo các biến môi trường
export const NETWORK = process.env.REACT_APP_SOLANA_NETWORK || 'devnet';
export const RPC_ENDPOINT = process.env.REACT_APP_SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// Khởi tạo Connection
export const connection = new Connection(RPC_ENDPOINT); 