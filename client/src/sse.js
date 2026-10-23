// รับเหตุการณ์สด (Server-Sent Events) ผ่าน fetch + header Authorization
// แทน EventSource เดิมที่ต้องแนบโทเคนใน URL (?token=) ซึ่งรั่วไปกับ log/ประวัติเบราว์เซอร์/Referer
export function connectEvents({ getToken, onEvent, onUnauthorized, onError }) {
  let stopped = false;
  let ctl = null;

  const run = async () => {
    let delay = 1000;
    while (!stopped) {
      ctl = new AbortController();
      try {
        const r = await fetch('/api/events', {
          headers: { Authorization: `Bearer ${getToken()}`, Accept: 'text/event-stream' },
          signal: ctl.signal,
        });
        if (r.status === 401) { onUnauthorized?.(); return; }
        if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
        delay = 1000;
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i = buf.indexOf('\n\n');
          while (i >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
            if (data) onEvent(data);
            i = buf.indexOf('\n\n');
          }
        }
      } catch (err) {
        if (stopped) return;
        onError?.(err);
      }
      if (stopped) return;
      await new Promise((resolve) => { setTimeout(resolve, delay); });
      delay = Math.min(delay * 2, 30000); // ต่อใหม่อัตโนมัติ (รอนานขึ้นเรื่อย ๆ สูงสุด 30 วินาที)
    }
  };
  run();

  return () => { stopped = true; ctl?.abort(); };
}
