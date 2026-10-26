// 平面圖全螢幕：兩指放大、拖動，點一下回傳位置（0~1）；數字固定大小，放大後就分得開
// openPlanView({ src, pins:[{x,y,no,status,hi}], marks:[{x,y,t}], hint, onTap(x,y) })；沒給 onTap＝只看
function openPlanView(o) {
  const ov = el('div', 'pv'); ov.setAttribute('role', 'dialog');
  const bar = el('div', 'pv-bar');
  const hint = el('div', 'pv-hint', o.hint || '兩指放大、拖動');
  const zin = el('button', 'pv-btn', '＋'), zout = el('button', 'pv-btn', '－'), close = el('button', 'pv-btn pv-close', '關閉');
  [zin, zout, close].forEach(b => { b.type = 'button'; });
  bar.append(hint, zout, zin, close);
  const vp = el('div', 'pv-vp'), stage = el('div', 'pv-stage'), img = el('img');
  img.alt = '平面圖'; img.draggable = false; img.src = o.src;
  stage.appendChild(img); vp.appendChild(stage); ov.append(bar, vp); document.body.appendChild(ov);

  let s = 1, tx = 0, ty = 0, base = 1;                 // base＝剛好塞滿畫面的倍率
  const items = [];
  (o.marks || []).forEach(m => { const d = el('div', 'mark', m.t); d.style.left = m.x * 100 + '%'; d.style.top = m.y * 100 + '%'; stage.appendChild(d); items.push(d); });
  (o.pins || []).forEach(p => { const d = el('div', 'pin ' + (p.status || '') + (p.hi ? ' hi' : ''), String(p.no)); d.style.left = p.x * 100 + '%'; d.style.top = p.y * 100 + '%'; stage.appendChild(d); items.push(d); });
  const apply = () => {
    stage.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
    const k = 1 / s; items.forEach(d => { d.style.transform = `translate(-50%,-50%) scale(${k})`; });
  };
  const clamp = () => {                                  // 不讓圖整個拖出畫面
    const w = img.naturalWidth * s, h = img.naturalHeight * s, W = vp.clientWidth, H = vp.clientHeight;
    tx = w <= W ? (W - w) / 2 : Math.min(0, Math.max(W - w, tx));
    ty = h <= H ? (H - h) / 2 : Math.min(0, Math.max(H - h, ty));
  };
  const zoomAt = (ns, cx, cy) => {
    ns = Math.min(base * 8, Math.max(base, ns));
    tx = cx - (cx - tx) * ns / s; ty = cy - (cy - ty) * ns / s; s = ns; clamp(); apply();
  };
  const fit = () => {
    if (!img.naturalWidth) return;
    stage.style.width = img.naturalWidth + 'px'; stage.style.height = img.naturalHeight + 'px';
    base = Math.min(vp.clientWidth / img.naturalWidth, vp.clientHeight / img.naturalHeight); s = base; tx = ty = 0; clamp(); apply();
    const f = (o.pins || []).find(p => p.hi);            // 看單筆缺失：直接放大到那個點
    if (f) zoomAt(base * 2.5, tx + f.x * img.naturalWidth * s, ty + f.y * img.naturalHeight * s);
  };
  img.complete && img.naturalWidth ? fit() : img.addEventListener('load', fit);
  const onResize = () => fit(); window.addEventListener('resize', onResize);

  // 手勢：一指拖動、兩指縮放；沒移動就放開＝點一下
  const pts = new Map(); let moved = false, last = null, startD = 0, startS = 1, lastTap = 0;
  const rel = e => { const r = vp.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  vp.addEventListener('pointerdown', e => {
    vp.setPointerCapture(e.pointerId); pts.set(e.pointerId, rel(e));
    if (pts.size === 1) { moved = false; last = rel(e); }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; startD = Math.hypot(a[0] - b[0], a[1] - b[1]); startS = s; moved = true; }
  });
  vp.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; const p = rel(e); pts.set(e.pointerId, p);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (startD) zoomAt(startS * d / startD, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    } else if (pts.size === 1 && last) {
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 6 || moved) {
        if (!moved) moved = true;
        tx += p[0] - last[0]; ty += p[1] - last[1]; clamp(); apply(); last = p;
      }
    }
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId);
    if (pts.size || moved) { if (!pts.size) last = null; return; }
    const [cx, cy] = rel(e), now = Date.now();
    if (!o.onTap) { if (now - lastTap < 350) zoomAt(s * 2, cx, cy); lastTap = now; return; }   // 只看：點兩下放大
    const x = (cx - tx) / (img.naturalWidth * s), y = (cy - ty) / (img.naturalHeight * s);
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    done(); o.onTap(x, y);
  };
  vp.addEventListener('pointerup', up); vp.addEventListener('pointercancel', e => { pts.delete(e.pointerId); });
  vp.addEventListener('wheel', e => { e.preventDefault(); const [cx, cy] = rel(e); zoomAt(s * (e.deltaY < 0 ? 1.25 : 0.8), cx, cy); }, { passive: false });
  zin.onclick = () => zoomAt(s * 1.6, vp.clientWidth / 2, vp.clientHeight / 2);
  zout.onclick = () => zoomAt(s / 1.6, vp.clientWidth / 2, vp.clientHeight / 2);
  const done = () => { window.removeEventListener('resize', onResize); ov.remove(); };
  close.onclick = done;
  return done;
}
