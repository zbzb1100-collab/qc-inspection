// 照片標註：拍完照先在照片上圈、畫、標箭頭，再存進缺失（照片還沒上傳，存檔時才上傳）
// openAnnotate(blob, sub) → Promise<Blob>：按「完成」回傳畫好的照片，按「不標註」回傳原照片
function openAnnotate(blob, sub) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); resolve(blob); };
    img.onload = () => build();
    img.src = url;

    function build() {
      const W = img.naturalWidth, H = img.naturalHeight, lw = Math.max(4, Math.round(Math.max(W, H) * 0.008));
      const ov = el('div', 'an'); ov.setAttribute('role', 'dialog');
      const top = el('div', 'an-bar');
      const ttl = el('div', 'an-title', '標註缺失位置' + (sub ? `（${sub}）` : ''));
      const skip = el('button', 'pv-btn an-skip', '不標註'), ok = el('button', 'pv-btn pv-close', '完成');
      top.append(ttl, skip, ok);
      const area = el('div', 'an-area'), cv = el('canvas'); cv.width = W; cv.height = H; area.appendChild(cv);
      const tools = el('div', 'an-tools');
      const TOOLS = [['circle', '⭕ 圈'], ['arrow', '➜ 箭頭'], ['pen', '✏️ 畫筆']];
      const COLORS = [['#ef2b2b', '紅'], ['#ffd400', '黃']];
      let tool = 'circle', color = COLORS[0][0];
      const tb = TOOLS.map(([k, n]) => { const b = el('button', 'an-tool', n); b.type = 'button'; b.onclick = () => { tool = k; paintTools(); }; return [k, b]; });
      const cb = COLORS.map(([c, n]) => { const b = el('button', 'an-color'); b.type = 'button'; b.title = n; b.setAttribute('aria-label', n); b.style.background = c; b.onclick = () => { color = c; paintTools(); }; return [c, b]; });
      const undo = el('button', 'an-tool', '↶ 復原'), clr = el('button', 'an-tool', '清除');
      tools.append(...tb.map(x => x[1]), ...cb.map(x => x[1]), undo, clr);
      const tip = el('div', 'an-tip', '在缺失周圍拖一下就圈起來；點一下也會畫一個圈');
      ov.append(top, area, tools, tip); document.body.appendChild(ov);
      [skip, ok, undo, clr].forEach(b => { b.type = 'button'; });
      const paintTools = () => {
        tb.forEach(([k, b]) => b.classList.toggle('on', k === tool)); cb.forEach(([c, b]) => b.classList.toggle('on', c === color));
        tip.textContent = tool === 'circle' ? '在缺失周圍拖一下就圈起來；點一下也會畫一個圈' : tool === 'arrow' ? '從旁邊拖向缺失，箭頭會指著放手的位置' : '用手指直接畫';
      };
      paintTools();

      const g = cv.getContext('2d'), shapes = []; let curShape = null;
      const draw = sh => {
        g.strokeStyle = g.fillStyle = sh.c; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
        // 黑色外框讓紅/黃線在任何背景都看得到
        const stroke = path => { g.save(); g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = lw + 4; path(); g.stroke(); g.restore(); path(); g.stroke(); };
        if (sh.t === 'circle') {
          const [a, b] = sh.p, rx = Math.max(Math.abs(b[0] - a[0]) / 2, lw * 3), ry = Math.max(Math.abs(b[1] - a[1]) / 2, lw * 3);
          stroke(() => { g.beginPath(); g.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, rx, ry, 0, 0, Math.PI * 2); });
        } else if (sh.t === 'arrow') {
          const [a, b] = sh.p, ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hl = lw * 5;
          stroke(() => {
            g.beginPath(); g.moveTo(...a); g.lineTo(...b);
            g.moveTo(b[0] - hl * Math.cos(ang - 0.45), b[1] - hl * Math.sin(ang - 0.45)); g.lineTo(...b);
            g.lineTo(b[0] - hl * Math.cos(ang + 0.45), b[1] - hl * Math.sin(ang + 0.45));
          });
        } else {
          stroke(() => { g.beginPath(); sh.p.forEach((q, i) => i ? g.lineTo(...q) : g.moveTo(...q)); if (sh.p.length === 1) g.lineTo(sh.p[0][0] + 0.1, sh.p[0][1]); });
        }
      };
      const redraw = () => { g.drawImage(img, 0, 0, W, H); shapes.forEach(draw); if (curShape) draw(curShape); };
      redraw();

      const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
      cv.addEventListener('pointerdown', e => {
        e.preventDefault(); if (curShape) return; cv.setPointerCapture(e.pointerId);
        const p = pt(e); curShape = { t: tool, c: color, p: tool === 'pen' ? [p] : [p, p], id: e.pointerId }; redraw();
      });
      cv.addEventListener('pointermove', e => {
        if (!curShape || e.pointerId !== curShape.id) return; const p = pt(e);
        if (curShape.t === 'pen') curShape.p.push(p); else curShape.p[1] = p; redraw();
      });
      const end = e => {
        if (!curShape || e.pointerId !== curShape.id) return;
        const sh = curShape; curShape = null;
        const small = sh.t !== 'pen' && Math.hypot(sh.p[1][0] - sh.p[0][0], sh.p[1][1] - sh.p[0][1]) < lw * 3;
        if (small) {                                        // 只點一下：在那裡畫一個固定大小的圈（箭頭也改成圈，比較直覺）
          const r = Math.max(W, H) * 0.06, [x, y] = sh.p[0]; sh.t = 'circle'; sh.p = [[x - r, y - r], [x + r, y + r]];
        }
        shapes.push(sh); redraw();
      };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', e => { if (curShape && e.pointerId === curShape.id) { curShape = null; redraw(); } });
      undo.onclick = () => { shapes.pop(); redraw(); };
      clr.onclick = () => { shapes.length = 0; redraw(); };

      const finish = out => { ov.remove(); URL.revokeObjectURL(url); resolve(out); };
      skip.onclick = () => finish(blob);
      ok.onclick = () => {
        if (!shapes.length) { finish(blob); return; }
        cv.toBlob(b => finish(b || blob), 'image/jpeg', 0.8);
      };
    }
  });
}
