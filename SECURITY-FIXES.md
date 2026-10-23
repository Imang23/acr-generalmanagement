# บันทึกการแก้ไขช่องโหว่ (ตุลาคม 2569)

ผลทดสอบ: โค้ดเดิมผ่าน 14/40, โค้ดที่แก้แล้วผ่าน 40/40 (`npm run test:security`)

| รหัส | ปัญหา | สิ่งที่แก้ | ไฟล์ |
|---|---|---|---|
| C1 | เปลี่ยนตัวพิมพ์ URL (`/api/Repairs`) แล้วข้ามการตรวจสิทธิ์ | `case sensitive routing` + ตัวควบคุมกลางปฏิเสธชื่อที่ตัวพิมพ์ต่าง + ลบ `requireAdmin` ปลอม | index.js, access.js |
| C2 | รหัสลับจริงอยู่ใน `.env.example` | แทนด้วยค่าตัวอย่าง (**ยังต้องเปลี่ยนรหัสจริงทุกตัว**) | .env.example |
| H1 | ค่าเริ่มต้น `dev` / `admin` | ไม่ตั้ง `JWT_SECRET` (>=32) / `ADMIN_PASS` (>=12) = ไม่ยอมเริ่มระบบ | index.js, access.js, personPhotos.js, dailyTasks.js |
| H2 | โทเคนไม่ถูกเพิกถอน | `auth` ตรวจ active + `token_version` (เปลี่ยน/รีเซ็ตรหัสผ่าน, ปิดบัญชี = โทเคนเก่าใช้ไม่ได้) | index.js, access.js, schema.sql |
| H3 | SSE ส่งข้อมูลนักเรียน/การเงินให้ทุกคน | กรองตามสิทธิ์และผู้ตรวจรายคน | index.js |
| H4 | LINE สั่งงานได้จากทุกกลุ่ม/ทุกคน | รับเฉพาะกลุ่ม `LINE_TARGET_ID` หรือผู้ใช้ที่ผูกบัญชี | index.js |
| H5 | โทเคนใน URL, ไม่มี security headers, CORS เปิดทุกโดเมน | รับโทเคนทาง header เท่านั้น (SSE/รูปโปรไฟล์ปรับฝั่งหน้าเว็บแล้ว), helmet + CSP, CORS ปิดเป็นค่าเริ่มต้น | index.js, access.js, client/src |
| M1 | ดูรูป/ไฟล์ด้วยเลข ID โดยไม่มีสิทธิ์ | ตรวจสิทธิ์เมนู/ผู้ตรวจ, photo token เหลือ 2 ชั่วโมง | index.js, personPhotos.js, dailyTasks.js |
| M2 | `/stats` `/kpi` ไม่ตรวจเมนู | ส่ง 0/ค่าว่างสำหรับเมนูที่ไม่มีสิทธิ์ | index.js |
| M3 | ผู้ใช้เมนูแม่บ้าน/สวนเห็นเบอร์/อีเมล/หมายเหตุ | ตัดฟิลด์ส่วนตัวออก เว้นแต่มีสิทธิ์เมนูบริหารทั่วไป | personPhotos.js |
| M4 | ล็อกอินผิดของคนหนึ่งล็อกทั้งโรงเรียน (หลัง proxy) | `trust proxy` + จำกัดตามคู่ IP+ชื่อผู้ใช้ | index.js |
| M5 | อัปโหลดไฟล์ปลอม/ไม่จำกัดอัตรา | ตรวจ magic bytes, mime จากนามสกุล, 20 ครั้ง/ชม., พร้อมกันไม่เกิน 6 | adminSubmissions.js |
| M6 | ไม่ตรวจใบรับรอง TLS ของฐานข้อมูล | `rejectUnauthorized: true` (ปิดได้ด้วย `DB_SSL_INSECURE=1`) | db.js |
| L1–L6 | `constructor` ในคำขอลบ, ชื่อผู้ตรวจปลอมได้, เดารหัสผูก LINE, รหัสผ่านสั้น (ขั้นต่ำ 10), เทียบรหัส admin ไม่ constant-time, ไม่มี audit log | แก้ครบ + ตาราง `audit_log` | หลายไฟล์ |
| L7 | vite/esbuild มีช่องโหว่ (dev server) | อัปเกรดเป็น vite 7 — `npm audit` = 0 | client/package.json |

## ขั้นตอนอัปเดต (ต้องทำตามลำดับ)

1. เปลี่ยนรหัสลับทุกตัว (Neon, LINE secret/token, JWT_SECRET, ADMIN_PASS) แล้วตั้งใน Environment ของโฮสต์
2. ตั้ง `LINE_TARGET_ID` ให้ถูกต้อง (ถ้าไม่ตั้ง บอทจะไม่รับคำสั่ง)
3. `npm install` แล้ว `npm run db:init` (เพิ่มคอลัมน์ `token_version` และตาราง `audit_log`)
4. `npm run build` แล้วรีสตาร์ต
5. ทุกคนต้องล็อกอินใหม่ 1 ครั้ง (โทเคนเดิมไม่มี version)
6. ผู้ใช้ที่ตั้งรหัสผ่านสั้นกว่า 10 ตัวยังล็อกอินได้ แต่เมื่อเปลี่ยนรหัสต้องยาว 10 ตัวขึ้นไป
