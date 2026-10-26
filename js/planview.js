// 平面圖全螢幕：兩指放大、拖動，點一下回傳位置（0~1）；數字固定大小，放大後就分得開
// openPlanView({ src, pins:[{x,y,no,status,hi}], marks:[{x,y,t}], hint, onTap(x,y), onMove(x,y) })
// 沒給 onTap＝只看；給 onMove＝多一個「改位置」按鈕，按了再點一下就把亮起來的那個編號移過去
function openPlanView(o) {
  const ov = el('div', 'pv'); ov.setAttribute('role', 'dialog');
  const bar = el('div', 'pv-bar');
  const hint = el('div', 'pv-hint', o.hint || '兩指放大、拖動');
  const zin = el('button', 'pv-btn', '＋'), zout = el('button', 'pv-btn', '－'), close = el('button', 'pv-btn pv-close', '關閉');
  [zin, zout, close].forEach(b => { b.type = 'button'; });
  bar.append(hint);
  let moving = false;
  if (o.onMove) {
    const mv = el('button', 'pv-btn pv-move', '📍 改位置'); mv.type = 'button'; bar.appendChild(mv);
    mv.onclick = () => { moving = !moving; mv.classList.toggle('on', moving); mv.textContent = moving ? '取消' : '📍 改位置';
      hint.textContent = moving ? '在新的位置點一下' : (o.hint || '兩指放大、拖動'); };
  }
  bar.append(zout, zin, close);
  const vp = el('div', 'pv-vp'), stage = el('div', 'pv-stage'), img = el('img');
  img.alt = '平面圖'; img.draggable = false; img.src = o.src;
  stage.appendChild(img); vp.appendChild(stage); ov.append(bar, vp); document.body.appendChild(ov);

  let s = 1, tx = 0, ty = 0, base = 1;                 // base＝剛好塞滿畫面的倍率
  const items = [];
  (o.marks || []).forEach(m => { const d = el('div', 'mark', m.t); d.style.left = m.x * 100 + '%'; d.style.top = m.y * 100 + '%'; stage.appendChild(d); items.push(d); });
  (o.pins || []).forEach(p => { const d = el('div', 'pin ' + (p.status || '') + (p.hi ? ' hi' : ''), String(p.no)); d.style.left = p.x * 100 + '%'; d.style.top = p.y * 100 + '%'; stage.appendChild(d); items.push(d); });
  // 手勢期間只動整張圖（一個 transform，交給 GPU），數字的大小等放開手指才調整，所以順
  let raf = 0, busy = false;
  const paint = () => {
    raf = 0; stage.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${s})`;
    if (!busy) { const k = 1 / s; items.forEach(d => { d.style.transform = `translate(-50%,-50%) scale(${k})`; }); }
  };
  const apply = () => { if (!raf) raf = requestAnimationFrame(paint); };
  const clamp = () => {                                  // 不讓圖整個拖出畫面
    const w = img.naturalWidth * s, h = img.naturalHeight * s, W = vp.clientWidth, H = vp.clientHeight;
    tx = w <= W ? (W - w) / 2 : Math.min(0, Math.max(W - w, tx));
    ty = h <= H ? (H - h) / 2 : Math.min(0, Math.max(H - h, ty));
  };
  const lim = v => Math.min(base * 10, Math.max(base, v));
  const zoomAt = (ns, cx, cy) => { ns = lim(ns); tx = cx - (cx - tx) * ns / s; ty = cy - (cy - ty) * ns / s; s = ns; clamp(); apply(); };
  const fit = () => {
    if (!img.naturalWidth) return;
    stage.style.width = img.naturalWidth + 'px'; stage.style.height = img.naturalHeight + 'px';
    base = Math.min(vp.clientWidth / img.naturalWidth, vp.clientHeight / img.naturalHeight); s = base; tx = ty = 0; clamp(); apply();
    const f = (o.pins || []).find(p => p.hi);            // 看單筆缺失：直接放大到那個點
    if (f) zoomAt(base * 2.5, tx + f.x * img.naturalWidth * s, ty + f.y * img.naturalHeight * s);
  };
  img.complete && img.naturalWidth ? fit() : img.addEventListener('load', fit);
  const onResize = () => fit(); window.addEventListener('resize', onResize);

  // 手勢：一指拖動、兩指縮放（同時可以拖）；沒移動就放開＝點一下
  const pts = new Map(); let moved = false, last = null, pinch = null, lastTap = 0;
  const rel = e => { const r = vp.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const startPinch = () => {
    const [a, b] = [...pts.values()];
    pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, s, tx, ty };
  };
  const settle = () => { busy = false; stage.classList.remove('moving'); apply(); };
  vp.addEventListener('pointerdown', e => {
    vp.setPointerCapture(e.pointerId); pts.set(e.pointerId, rel(e));
    if (pts.size === 1) { moved = false; last = rel(e); }
    if (pts.size === 2) { startPinch(); moved = true; busy = true; stage.classList.add('moving'); }
  });
  vp.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return; const p = rel(e); pts.set(e.pointerId, p);
    if (pts.size >= 2 && pinch) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const ns = lim(pinch.s * d / pinch.d), k = ns / pinch.s;
      tx = mx - (pinch.mx - pinch.tx) * k; ty = my - (pinch.my - pinch.ty) * k; s = ns; clamp(); apply();
    } else if (pts.size === 1 && last) {
      if (!moved && Math.hypot(p[0] - last[0], p[1] - last[1]) < 8) return;
      if (!moved) { moved = true; busy = true; stage.classList.add('moving'); }
      tx += p[0] - last[0]; ty += p[1] - last[1]; last = p; clamp(); apply();
    }
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId);
    if (pts.size === 1) { pinch = null; last = [...pts.values()][0]; return; }   // 放開一指：從剩下那指接著拖，不會跳
    if (pts.size) return;
    pinch = null; last = null;
    if (moved) { settle(); return; }
    const [cx, cy] = rel(e), now = Date.now();
    const x = (cx - tx) / (img.naturalWidth * s), y = (cy - ty) / (img.naturalHeight * s), inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
    if (moving) { if (inside) { done(); o.onMove(x, y); } return; }
    if (!o.onTap) { if (now - lastTap < 350) zoomAt(s * 2, cx, cy); lastTap = now; return; }   // 只看：點兩下放大
    if (!inside) return;
    done(); o.onTap(x, y);
  };
  vp.addEventListener('pointerup', up); vp.addEventListener('pointercancel', e => { pts.delete(e.pointerId); if (!pts.size) { pinch = null; last = null; settle(); } });
  vp.addEventListener('wheel', e => { e.preventDefault(); const [cx, cy] = rel(e); zoomAt(s * (e.deltaY < 0 ? 1.25 : 0.8), cx, cy); }, { passive: false });
  // iPhone Safari：兩指會把整個網頁一起放大，按鈕被擠出畫面就回不去 → 放大畫面開著時一律擋掉網頁縮放
  const stop = e => { if (e.cancelable) e.preventDefault(); };
  const gs = ['gesturestart', 'gesturechange', 'gestureend'];
  gs.forEach(t => document.addEventListener(t, stop, { passive: false }));
  vp.addEventListener('touchstart', e => { if (e.touches.length > 1) stop(e); }, { passive: false });
  vp.addEventListener('touchmove', stop, { passive: false });
  const vm = document.querySelector('meta[name=viewport]'), vmOld = vm && vm.content;
  if (vm) vm.content = vmOld.replace(/,?\s*(maximum-scale|user-scalable)=[^,]*/g, '') + ', maximum-scale=1, user-scalable=no';
  zin.onclick = () => zoomAt(s * 1.6, vp.clientWidth / 2, vp.clientHeight / 2);
  zout.onclick = () => zoomAt(s / 1.6, vp.clientWidth / 2, vp.clientHeight / 2);
  // 手機的「返回」也能關掉放大畫面（不會整個離開網站）
  let closed = false;
  try { history.pushState({ pv: 1 }, ''); } catch (e) {}
  const onPop = () => { if (!closed) { closed = true; finish(); } };
  window.addEventListener('popstate', onPop);
  const done = () => { if (closed) return; closed = true; finish(); try { if (history.state && history.state.pv) history.back(); } catch (e) {} };
  const finish = () => { window.removeEventListener('popstate', onPop); window.removeEventListener('resize', onResize); cancelAnimationFrame(raf); gs.forEach(t => document.removeEventListener(t, stop)); if (vm) vm.content = vmOld; ov.remove(); };
  close.onclick = done;
  return done;
}
