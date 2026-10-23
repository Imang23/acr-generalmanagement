import { useRef, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, Typography, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { api, setToken } from './api.js';
import { BLUE, LOGO_SRC } from './Layout.jsx';

const REMEMBER_KEY = 'login_remember_username';

const css = `
.lg-wrap { --mx: 0; --my: 0; min-height: 100vh; display: grid; grid-template-columns: 1fr 1fr; background: #fff; overflow: hidden; }

/* ---------- ฝั่งซ้าย ---------- */
.lg-left { position: relative; overflow: hidden; color: #fff; display: flex; flex-direction: column; justify-content: center; padding: 0 12%;
  background: radial-gradient(circle at 20% 15%, #3b8ff0 0%, #1259c7 45%, #082f78 100%); perspective: 1000px; }
.lg-left::after { content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(rgba(255,255,255,.14) 1.2px, transparent 1.2px); background-size: 26px 26px;
  mask-image: linear-gradient(135deg, #000 0%, transparent 60%); -webkit-mask-image: linear-gradient(135deg, #000 0%, transparent 60%); }

.lg-par { position: absolute; transform: translate3d(calc(var(--mx) * var(--d) * 1px), calc(var(--my) * var(--d) * 1px), 0); transition: transform .25s ease-out; }
.lg-sphere { border-radius: 50%; animation: lgFloat 9s ease-in-out infinite; }
.lg-sphere.blue {
  background:
    radial-gradient(circle at 30% 22%, rgba(255,255,255,.75) 0, rgba(255,255,255,0) 22%),
    radial-gradient(circle at 35% 30%, #63b0ff 0%, #1d6fe0 48%, #0a3a94 82%, #06266b 100%);
  box-shadow: inset -22px -34px 60px rgba(0,15,70,.55), inset 14px 14px 40px rgba(180,220,255,.35), 0 40px 70px rgba(4,30,100,.45); }
.lg-sphere.glass {
  background:
    radial-gradient(circle at 30% 22%, rgba(255,255,255,.9) 0, rgba(255,255,255,0) 24%),
    radial-gradient(circle at 40% 35%, rgba(255,255,255,.28), rgba(255,255,255,.06) 70%);
  border: 1px solid rgba(255,255,255,.35);
  box-shadow: inset -12px -18px 30px rgba(255,255,255,.12), 0 20px 40px rgba(0,20,80,.3); }
.lg-ring { border-radius: 50%; border: 10px solid rgba(255,255,255,.14); animation: lgSpin 22s linear infinite;
  box-shadow: inset 0 0 20px rgba(255,255,255,.12), 0 0 30px rgba(0,30,120,.25); }

@keyframes lgFloat { 0%,100% { transform: translate3d(0,0,0) rotate(0deg); } 50% { transform: translate3d(0,-22px,0) rotate(3deg); } }
@keyframes lgSpin { to { transform: rotate(360deg); } }

.lg-text { position: relative; z-index: 2; transform: translate3d(calc(var(--mx) * -8px), calc(var(--my) * -6px), 0); transition: transform .25s ease-out; }
.lg-left h1 { color: #fff; font-size: 48px; letter-spacing: 2px; margin: 0; font-weight: 800;
  text-shadow: 0 1px 0 #cfe3ff, 0 2px 0 #a9ccf8, 0 3px 0 #82b1ef, 0 4px 0 #5f95e0, 0 5px 0 #3c78cc, 0 12px 18px rgba(2,20,80,.55); }
.lg-left h2 { color: #fff; font-size: 20px; letter-spacing: 1px; margin: 12px 0 14px; font-weight: 600; text-shadow: 0 3px 8px rgba(2,20,80,.5); }
.lg-left p { color: rgba(255,255,255,.85); max-width: 340px; margin: 0; font-size: 13px; line-height: 1.7; }

/* ---------- ฝั่งขวา ---------- */
.lg-right { position: relative; display: flex; align-items: center; justify-content: center; padding: 32px; perspective: 1100px;
  background:
    radial-gradient(circle at 85% 10%, #e3efff 0, transparent 40%),
    radial-gradient(circle at 10% 90%, #eaf3ff 0, transparent 45%),
    #fff; }
.lg-right::before { content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(#c9dcf7 1.3px, transparent 1.3px); background-size: 24px 24px; opacity: .55;
  mask-image: radial-gradient(circle at 50% 50%, transparent 25%, #000 85%); -webkit-mask-image: radial-gradient(circle at 50% 50%, transparent 25%, #000 85%); }
.lg-blob { position: absolute; border-radius: 50%; filter: blur(40px); opacity: .55; animation: lgDrift 14s ease-in-out infinite; }
@keyframes lgDrift { 0%,100% { transform: translate3d(0,0,0) scale(1); } 50% { transform: translate3d(30px,-24px,0) scale(1.12); } }
.lg-bubble { border-radius: 50%; animation: lgFloat 8s ease-in-out infinite;
  background:
    radial-gradient(circle at 30% 24%, #fff 0, rgba(255,255,255,0) 28%),
    radial-gradient(circle at 40% 35%, #cfe3ff, #8fbaf5 70%, #6ea3ee 100%);
  box-shadow: inset -8px -12px 22px rgba(30,90,190,.35), 0 18px 30px rgba(40,100,200,.25); }
.lg-star { position: absolute; width: 14px; height: 14px; background: #7fb0f5; opacity: .6; clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
  animation: lgTwinkle 3.5s ease-in-out infinite; }
@keyframes lgTwinkle { 0%,100% { transform: scale(.6) rotate(0); opacity: .25; } 50% { transform: scale(1.2) rotate(45deg); opacity: .8; } }

.lg-card { position: relative; width: 100%; max-width: 380px; padding: 28px 32px 32px; border-radius: 22px; transform-style: preserve-3d;
  background: rgba(255,255,255,.78); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255,255,255,.9);
  box-shadow: 0 1px 0 rgba(255,255,255,1) inset, 0 30px 60px -15px rgba(18,89,199,.35), 0 12px 24px rgba(18,89,199,.12), 0 0 0 1px rgba(18,89,199,.05);
  transform: rotateY(calc(var(--mx) * 7deg)) rotateX(calc(var(--my) * -7deg));
  transition: transform .2s ease-out; animation: lgRise .7s cubic-bezier(.2,.8,.2,1) both; }
@keyframes lgRise { from { opacity: 0; transform: translate3d(0,30px,0) rotateX(12deg); } }
.lg-card .lg-z1 { transform: translateZ(40px); }
.lg-card .lg-z2 { transform: translateZ(22px); }
.lg-logo { filter: drop-shadow(0 12px 14px rgba(18,89,199,.3)); }

.lg-input.ant-input-affix-wrapper { background: #f1f5fb; border: 1px solid transparent; border-radius: 12px; padding: 11px 14px;
  box-shadow: inset 3px 3px 7px rgba(150,175,215,.35), inset -3px -3px 7px rgba(255,255,255,.95); transition: all .2s; }
.lg-input.ant-input-affix-wrapper input { background: transparent; }
.lg-input.ant-input-affix-wrapper .anticon { color: #7d96bd; }
.lg-input.ant-input-affix-wrapper:hover, .lg-input.ant-input-affix-wrapper-focused { background: #fff; border-color: ${BLUE.navy};
  box-shadow: 0 0 0 4px rgba(18,89,199,.12), 0 8px 18px rgba(18,89,199,.15); transform: translateY(-2px); }

.lg-btn.ant-btn { height: 48px; border-radius: 12px; font-weight: 600; border: none; color: #fff;
  background: linear-gradient(180deg, #2f78e0 0%, ${BLUE.navy} 100%) !important;
  box-shadow: 0 6px 0 #0a2c63, 0 14px 22px rgba(10,44,99,.4), inset 0 1px 0 rgba(255,255,255,.35);
  transition: transform .12s, box-shadow .12s, filter .2s; }
.lg-btn.ant-btn:hover { filter: brightness(1.08); transform: translateY(-2px); box-shadow: 0 8px 0 #0a2c63, 0 18px 26px rgba(10,44,99,.4), inset 0 1px 0 rgba(255,255,255,.35); }
.lg-btn.ant-btn:active { transform: translateY(5px); box-shadow: 0 1px 0 #0a2c63, 0 4px 8px rgba(10,44,99,.4), inset 0 1px 0 rgba(255,255,255,.25); }

@media (max-width: 768px) {
  .lg-wrap { grid-template-columns: 1fr; }
  .lg-left { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .lg-wrap *, .lg-wrap *::before { animation: none !important; transition: none !important; }
  .lg-card { transform: none; }
}
`;

const Par = ({ d, style, children }) => (
  <div className="lg-par" style={{ '--d': d, ...style }}>{children}</div>
);

export default function Login() {
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  let saved = '';
  try { saved = localStorage.getItem(REMEMBER_KEY) || ''; } catch { /* ignore */ }

  const onMove = (e) => {
    const el = wrapRef.current;
    if (!el) return;
    const mx = (e.clientX / window.innerWidth) * 2 - 1;
    const my = (e.clientY / window.innerHeight) * 2 - 1;
    el.style.setProperty('--mx', mx.toFixed(3));
    el.style.setProperty('--my', my.toFixed(3));
  };
  const onLeave = () => {
    const el = wrapRef.current;
    if (!el) return;
    el.style.setProperty('--mx', 0);
    el.style.setProperty('--my', 0);
  };

  const go = async (v) => {
    setLoading(true);
    setErr('');
    try {
      const { remember, ...creds } = v;
      setToken((await api('/login', 'POST', creds)).token);
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, creds.username);
        else localStorage.removeItem(REMEMBER_KEY);
      } catch { /* ignore */ }
      location.reload();
    } catch (x) {
      setErr(x.message);
      setLoading(false);
    }
  };

  return (
    <div className="lg-wrap" ref={wrapRef} onMouseMove={onMove} onMouseLeave={onLeave}>
      <style>{css}</style>

      {/* ฝั่งซ้าย: ทรงกลม 3 มิติ + parallax ตามเมาส์ */}
      <div className="lg-left">
        <Par d={55} style={{ left: -150, top: -130 }}>
          <div className="lg-sphere blue" style={{ width: 520, height: 520 }} />
        </Par>
        <Par d={-40} style={{ right: -100, bottom: -110 }}>
          <div className="lg-sphere blue" style={{ width: 380, height: 380, animationDelay: '-3s' }} />
        </Par>
        <Par d={-70} style={{ right: '16%', top: '12%' }}>
          <div className="lg-sphere glass" style={{ width: 110, height: 110, animationDelay: '-5s' }} />
        </Par>
        <Par d={30} style={{ left: '8%', bottom: '10%' }}>
          <div className="lg-sphere glass" style={{ width: 64, height: 64, animationDelay: '-2s' }} />
        </Par>
        <Par d={45} style={{ right: '8%', top: '42%' }}>
          <div className="lg-ring" style={{ width: 150, height: 150 }} />
        </Par>

        <div className="lg-text">
          <h1>ยินดีต้อนรับ</h1>
          <h2>ฝ่ายบริหารทั่วไป</h2>
          <p>ระบบบริหารงานฝ่ายบริหารทั่วไป โรงเรียนอัสสัมชัญระยอง</p>
        </div>
      </div>

      {/* ฝั่งขวา: พื้นขาวมีลูกเล่น + การ์ดเอียงตามเมาส์ */}
      <div className="lg-right">
        <div className="lg-blob" style={{ width: 280, height: 280, right: -60, top: -60, background: '#9ec6ff' }} />
        <div className="lg-blob" style={{ width: 240, height: 240, left: -60, bottom: -40, background: '#bcd8ff', animationDelay: '-6s' }} />

        <Par d={26} style={{ left: '9%', top: '14%' }}>
          <div className="lg-bubble" style={{ width: 54, height: 54 }} />
        </Par>
        <Par d={-34} style={{ right: '10%', top: '22%' }}>
          <div className="lg-bubble" style={{ width: 28, height: 28, animationDelay: '-2s' }} />
        </Par>
        <Par d={40} style={{ right: '14%', bottom: '12%' }}>
          <div className="lg-bubble" style={{ width: 76, height: 76, animationDelay: '-4s' }} />
        </Par>
        <Par d={-22} style={{ left: '12%', bottom: '18%' }}>
          <div className="lg-bubble" style={{ width: 36, height: 36, animationDelay: '-1s' }} />
        </Par>
        <div className="lg-star" style={{ left: '28%', top: '9%' }} />
        <div className="lg-star" style={{ right: '26%', bottom: '8%', animationDelay: '-1.5s' }} />
        <div className="lg-star" style={{ left: '7%', top: '55%', animationDelay: '-2.5s', width: 10, height: 10 }} />

        <div className="lg-card">
          <div className="lg-z1" style={{ textAlign: 'center', marginBottom: 12 }}>
            <img
              className="lg-logo"
              src={LOGO_SRC}
              alt="Assumption College Rayong"
              width={150}
              height={100}
              style={{ objectFit: 'contain' }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          </div>

          <div className="lg-z2">
            <Typography.Title level={2} style={{ margin: '0 0 4px', color: BLUE.navy }}>
              เข้าสู่ระบบ
            </Typography.Title>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
              กรุณากรอกชื่อผู้ใช้และรหัสผ่านเพื่อเข้าใช้งาน
            </Typography.Text>
          </div>

          <Form layout="vertical" onFinish={go} initialValues={{ username: saved, remember: !!saved }}>
            <Form.Item name="username" rules={[{ required: true, message: 'กรุณากรอกชื่อผู้ใช้' }]}>
              <Input className="lg-input" prefix={<UserOutlined />} placeholder="ชื่อผู้ใช้" autoFocus={!saved} />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: 'กรุณากรอกรหัสผ่าน' }]} style={{ marginBottom: 12 }}>
              <Input.Password className="lg-input" prefix={<LockOutlined />} placeholder="รหัสผ่าน" autoFocus={!!saved} />
            </Form.Item>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <Form.Item name="remember" valuePropName="checked" noStyle>
                <Checkbox>จดจำชื่อผู้ใช้</Checkbox>
              </Form.Item>
              <a
                style={{ color: BLUE.navy, fontSize: 13 }}
                onClick={() => message.info('กรุณาติดต่อผู้ดูแลระบบเพื่อรีเซ็ตรหัสผ่าน')}
              >
                ลืมรหัสผ่าน?
              </a>
            </div>

            {err && <Alert type="error" message={err} showIcon style={{ marginBottom: 14 }} />}

            <div className="lg-z2">
              <Button className="lg-btn" type="primary" htmlType="submit" block loading={loading}>
                เข้าสู่ระบบ
              </Button>
            </div>
          </Form>
        </div>
      </div>
    </div>
  );
}
