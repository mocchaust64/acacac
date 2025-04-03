# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.\
You will also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

## Thông tin về chương trình Secp256r1 trên Solana

Chương trình Secp256r1SigVerify trên Solana là một chương trình native (built-in) có địa chỉ cố định: `Secp256r1SigVerify1111111111111111111111111`.

### Validator Chính Thức

Trên các validator chính thức của Solana (mainnet, devnet, testnet), chương trình Secp256r1SigVerify đã được cài đặt sẵn và hoạt động bình thường, không cần thêm bất kỳ cấu hình nào.

### Validator Cục Bộ

Khi sử dụng validator cục bộ (localhost), chỉ cần chạy validator với tham số để cài đặt chương trình MoonWallet:

```bash
solana-test-validator --bpf-program DeN1rBfabZezHPvrq9q7BbzUbZkrjnHE1kQDrPK8kWQ3 path/to/moon_wallet.so
```

### Lưu ý về kiểm tra sự tồn tại của chương trình

Cần lưu ý rằng không thể kiểm tra sự tồn tại của chương trình Secp256r1SigVerify bằng cách sử dụng RPC `getAccountInfo`, vì:
1. Chương trình Secp256r1SigVerify là một chương trình native của Solana
2. Chương trình native không được lưu trữ như tài khoản bình thường
3. Chỉ có thể truy cập chương trình này thông qua instruction trong giao dịch

Để kiểm tra xem chương trình có hoạt động hay không, bạn có thể thử:
- Mô phỏng giao dịch với một instruction secp256r1
- Hoặc chạy script test để xác minh chữ ký

## Kiểm tra xác thực Secp256r1

Để kiểm tra xem chương trình Secp256r1SigVerify hoạt động đúng, bạn có thể chạy script `test_verify.js` trong thư mục `test_secp256r1`:

```bash
cd test_secp256r1
npm install
node test_verify.js
```

Script này sẽ tạo cặp khóa secp256r1, ký một message, và xác minh chữ ký trên Solana blockchain.
