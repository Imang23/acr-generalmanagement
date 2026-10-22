# ACR-Management: กล่องรับเอกสาร Admin

## ไฟล์ที่ให้
- `server/adminSubmissions.js` — API อัปโหลด, รายการ Admin, ดาวน์โหลด, รับทราบ และสร้างตาราง PostgreSQL อัตโนมัติ
- `client/src/pages/Admin/AdminSubmissions.jsx` — หน้ากล่องรับเอกสาร Admin

## ติดตั้ง
1. คัดลอก `server/adminSubmissions.js` ไปไว้ที่ `server/adminSubmissions.js` (ถ้ามีไฟล์นี้อยู่แล้ว ให้สำรองไฟล์เดิมก่อนแทนที่)
2. คัดลอก `AdminSubmissions.jsx` ไปไว้ที่ `client/src/pages/Admin/AdminSubmissions.jsx`
3. ที่โฟลเดอร์โปรเจกต์ รัน `npm install multer` เพื่อเพิ่มตัวรับ multipart upload
4. `server/index.js` ในไฟล์ที่ส่งมาก่อนหน้านี้มี import และเรียก `registerAdminSubmissions(app, { pool, auth, broadcast, notify, getAccess })` อยู่แล้ว จึงไม่ต้องเพิ่มการเรียกซ้ำ

## เชื่อมเมนูใน client/src/App.jsx
เพิ่ม import:
```jsx
import AdminSubmissions from './pages/Admin/AdminSubmissions.jsx';
```
เพิ่มใน object `pages`:
```jsx
'admin-submissions': <AdminSubmissions />,
```
เพิ่มรายการใน `menuItems`:
```jsx
{ key: 'admin-submissions', label: 'กล่องรับเอกสาร Admin', icon: <InboxOutlined /> },
```
และ import icon `InboxOutlined` จาก `@ant-design/icons` หากยังไม่มี

จำกัดสิทธิ์ใน `visibleItems` ให้เฉพาะ Admin โดยเพิ่มเงื่อนไข:
```jsx
if (item.key === 'admin-submissions') return access.is_admin ? true : false;
```
เพิ่มเงื่อนไขเดียวกันในตัวแปร/ฟังก์ชัน `allowed` ของหน้า:
```jsx
if (page === 'admin-submissions') return !!access.is_admin;
```

ถ้า `menuItems` ใช้โครงสร้างแบบ nested ให้ใส่รายการกล่องรับเอกสารในระดับบนสุดตามรูปแบบเดิมของไฟล์ และเพิ่มเงื่อนไขตรวจสิทธิ์ทั้งที่เมนูและหน้าเนื้อหา

## หมายเหตุ
- API ฝั่งเซิร์ฟเวอร์ตรวจ Admin ด้วย `ADMIN_USER` จาก `.env` หรือ `getAccess()` ที่ส่งเข้ามา
- ไฟล์ถูกเก็บใน PostgreSQL `BYTEA` เพื่อให้ดาวน์โหลดได้หลังรีสตาร์ตหรือ deploy โดยไม่พึ่ง localStorage
- จำกัด 5 ไฟล์ต่อรายการ ไฟล์ละ 10 MB และตรวจนามสกุลที่อนุญาต
- ตาราง `admin_submissions` และ `admin_submission_files` ถูกสร้างเมื่อ API ถูกเรียกครั้งแรก ไม่ต้องรัน SQL แยก
- `Administration.jsx` ที่ส่งมาใช้ direct `fetch(FormData)` ถูกต้องแล้ว ไม่ต้องตั้ง `Content-Type` เอง
