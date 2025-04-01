# Hướng dẫn thiết lập Cloud Function để tự động dọn dẹp dữ liệu guardian cũ

Cloud Function này sẽ tự động xóa các dữ liệu guardian và invitation nếu người dùng không hoàn tất trong vòng 30 phút.

## Bước 1: Cài đặt Firebase CLI

```bash
npm install -g firebase-tools
```

## Bước 2: Đăng nhập và khởi tạo Firebase Functions

```bash
firebase login
firebase init functions
```

Chọn JavaScript hoặc TypeScript tùy theo sở thích của bạn.

## Bước 3: Tạo Cloud Function

Tạo file `functions/index.js` hoặc `functions/src/index.ts` với nội dung sau:

### Đối với JavaScript:

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// Cloud Function chạy theo lịch trình (mỗi 10 phút) để dọn dẹp dữ liệu cũ
exports.cleanupOldGuardianData = functions.pubsub
  .schedule('every 10 minutes')
  .onRun(async (context) => {
    const db = admin.firestore();
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    // Tìm các invitation cũ có trạng thái là pending hoặc ready
    const oldInvitesQuery = await db.collection('invitations')
      .where('createdAt', '<', thirtyMinutesAgo)
      .where('status', 'in', ['pending', 'ready'])
      .get();
    
    console.log(`Tìm thấy ${oldInvitesQuery.size} invitation cần dọn dẹp.`);
    
    // Xóa từng invitation cũ
    const batch = oldInvitesQuery.docs.map(async (docSnapshot) => {
      const inviteCode = docSnapshot.data().inviteCode;
      console.log(`Đang xóa dữ liệu cho invitation: ${inviteCode}`);
      
      // Xóa lookup
      await db.doc(`invitations_lookup/${inviteCode}`).delete();
      
      // Xóa guardian data nếu có
      const guardianRef = db.doc(`guardians/${inviteCode}`);
      const guardianSnap = await guardianRef.get();
      if (guardianSnap.exists) {
        await guardianRef.delete();
      }
      
      // Xóa invitation
      await docSnapshot.ref.delete();
    });
    
    await Promise.all(batch);
    console.log('Đã hoàn tất dọn dẹp dữ liệu cũ.');
    
    return null;
  });

// Cloud Function trigger khi thêm guardian thành công (tùy chọn)
exports.cleanupAfterSuccess = functions.firestore
  .document('guardians/{inviteCode}')
  .onUpdate(async (change, context) => {
    const inviteCode = context.params.inviteCode;
    const newValue = change.after.data();
    const previousValue = change.before.data();
    
    // Chỉ xử lý khi status chuyển từ 'ready' sang 'completed'
    if (previousValue.status === 'ready' && newValue.status === 'completed') {
      console.log(`Guardian ${inviteCode} đã hoàn tất, lưu lại signature và xóa dữ liệu.`);
      
      // Lưu transaction signature nếu cần cho mục đích lưu trữ
      const txSignature = newValue.txSignature;
      
      try {
        // Xóa dữ liệu guardian
        await change.after.ref.delete();
        
        // Xóa lookup và invitation
        const lookupRef = admin.firestore().doc(`invitations_lookup/${inviteCode}`);
        const lookupSnap = await lookupRef.get();
        
        if (lookupSnap.exists) {
          const inviteId = lookupSnap.data().inviteId;
          
          // Xóa invitation
          await admin.firestore().doc(`invitations/${inviteId}`).delete();
          
          // Xóa lookup
          await lookupRef.delete();
        }
        
        console.log(`Đã xóa thành công dữ liệu guardian và invitation với mã mời ${inviteCode}`);
      } catch (error) {
        console.error(`Lỗi khi xóa dữ liệu: ${error}`);
      }
    }
    
    return null;
  });
```

### Đối với TypeScript:

```typescript
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
admin.initializeApp();

// Cloud Function chạy theo lịch trình (mỗi 10 phút) để dọn dẹp dữ liệu cũ
export const cleanupOldGuardianData = functions.pubsub
  .schedule('every 10 minutes')
  .onRun(async (context) => {
    const db = admin.firestore();
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    // Tìm các invitation cũ có trạng thái là pending hoặc ready
    const oldInvitesQuery = await db.collection('invitations')
      .where('createdAt', '<', thirtyMinutesAgo)
      .where('status', 'in', ['pending', 'ready'])
      .get();
    
    console.log(`Tìm thấy ${oldInvitesQuery.size} invitation cần dọn dẹp.`);
    
    // Xóa từng invitation cũ
    const batch = oldInvitesQuery.docs.map(async (docSnapshot) => {
      const inviteCode = docSnapshot.data().inviteCode;
      console.log(`Đang xóa dữ liệu cho invitation: ${inviteCode}`);
      
      // Xóa lookup
      await db.doc(`invitations_lookup/${inviteCode}`).delete();
      
      // Xóa guardian data nếu có
      const guardianRef = db.doc(`guardians/${inviteCode}`);
      const guardianSnap = await guardianRef.get();
      if (guardianSnap.exists) {
        await guardianRef.delete();
      }
      
      // Xóa invitation
      await docSnapshot.ref.delete();
    });
    
    await Promise.all(batch);
    console.log('Đã hoàn tất dọn dẹp dữ liệu cũ.');
    
    return null;
  });

// Cloud Function trigger khi thêm guardian thành công (tùy chọn)
export const cleanupAfterSuccess = functions.firestore
  .document('guardians/{inviteCode}')
  .onUpdate(async (change, context) => {
    const inviteCode = context.params.inviteCode;
    const newValue = change.after.data();
    const previousValue = change.before.data();
    
    // Chỉ xử lý khi status chuyển từ 'ready' sang 'completed'
    if (previousValue.status === 'ready' && newValue.status === 'completed') {
      console.log(`Guardian ${inviteCode} đã hoàn tất, lưu lại signature và xóa dữ liệu.`);
      
      // Lưu transaction signature nếu cần cho mục đích lưu trữ
      const txSignature = newValue.txSignature;
      
      try {
        // Xóa dữ liệu guardian
        await change.after.ref.delete();
        
        // Xóa lookup và invitation
        const lookupRef = admin.firestore().doc(`invitations_lookup/${inviteCode}`);
        const lookupSnap = await lookupRef.get();
        
        if (lookupSnap.exists) {
          const inviteId = lookupSnap.data()?.inviteId;
          
          // Xóa invitation
          await admin.firestore().doc(`invitations/${inviteId}`).delete();
          
          // Xóa lookup
          await lookupRef.delete();
        }
        
        console.log(`Đã xóa thành công dữ liệu guardian và invitation với mã mời ${inviteCode}`);
      } catch (error) {
        console.error(`Lỗi khi xóa dữ liệu: ${error}`);
      }
    }
    
    return null;
  });
```

## Bước 4: Deploy Cloud Functions

```bash
firebase deploy --only functions
```

## Chức năng của Cloud Functions

1. **cleanupOldGuardianData**: Chạy mỗi 10 phút để kiểm tra và xóa dữ liệu guardian cũ (tạo hơn 30 phút và chưa được hoàn tất).

2. **cleanupAfterSuccess**: Tự động xóa dữ liệu khi một guardian được cập nhật từ trạng thái 'ready' sang 'completed' (sao lưu transaction signature trước).

## Lưu ý

- Đảm bảo bạn đã bật Blaze plan (pay-as-you-go) cho Firebase vì scheduled functions chỉ hoạt động với plan này.
- Điều chỉnh thời gian chạy ('every 10 minutes') theo nhu cầu của bạn.
- Có thể thêm logic lưu trữ transaction signatures vào một collection riêng nếu muốn giữ lại thông tin này. 