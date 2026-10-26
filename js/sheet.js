/* 缺失表單：新增、修改、修繕完成、複驗結案、不修 */
let cur = null, ctx = null;

async function openDefect(row, c) {
  ctx = c || {};
  // 從報表點開別的案場的缺失：清單換成那個案場的（各案場一份）
  if (row && row.site_id && row.site_id !== S.sel.siteId && typeof applySite === 'function') { S.sel.siteId = row.site_id; applySite(); if (typeof saveSel === 'function') saveSel(); }
  const base = row ? { ...row } : {
    ...ctx.create, status: 'todo', space_id: null, category_id: null, item_id: null,
    repair_method_id: null, fix_vendor_id: null, resp_vendor_id: null,
    planned_date: today(10), fixed_date: null, description: '', customer_name: lastCustomer(ctx.create.unit_id)
  };
  cur = base;
  cur.before = []; cur.after = []; cur.sign = []; cur.removed = []; cur.trash = [];
  cur.respTouched = !!row && row.resp_vendor_id !== row.fix_vendor_id;
  $('sheet').hidden = false; $('sheet').querySelector('.panel').scrollTop = 0;
  paintSheet();
  if (row) {
    const { data, error } = await sb.from('defect_photos').select('*').eq('defect_id', row.id).order('id');
    if (error) { toast(errMsg(error)); return; }
    const urls = await signedUrls('photos', data.map(p => p.path));
    cur.trash = [];
    data.forEach((p, i) => (p.deleted_at ? cur.trash : p.kind === 'after' ? cur.after : p.kind === 'sign' ? cur.sign : cur.before)
      .push({ id: p.id, kind: p.kind, path: p.path, url: urls[i], by: p.created_by, deleted_at: p.deleted_at, deleted_by: p.deleted_by }));
    paintPhotos();
    if (cur.sign.length) { paintStatusText(); paintNext(false); }
  }
}
function lastCustomer(unitId) { try { return sessionStorage.getItem('qc-cust-' + unitId) || ''; } catch (e) { return ''; } }
function closeSheet() {
  [...cur.before, ...cur.after].forEach(p => p.blob && URL.revokeObjectURL(p.url));
  $('sheet').hidden = true; cur = null; $('sh-mini').querySelectorAll('.pin').forEach(p => p.remove());
}

function paintSheet() {
  const isNew = !cur.id;
  const bName = M.name('buildings', cur.building_id), uCode = M.unitCode(cur.unit_id);
  $('sh-no').textContent = ctx.no || cur.id || '+';
  $('sh-title').textContent = isNew ? '新增缺失' : '缺失內容';
  $('sh-where').textContent = `${bName} ${cur.floor} ${uCode}　${M.name('inspect_types', cur.inspect_type_id)}` +
    (cur.x != null ? '　已標在平面圖上' : '　未標位置');
  const canPlace = !isNew && ctx.canPlace && !!ctx.onPlace && !isVendor();
  $('sh-placerow').hidden = !canPlace;
  $('sh-place').textContent = cur.x != null ? '📍 重新標位置' : '📍 在平面圖上標位置';
  $('sh-unplace').hidden = cur.x == null;
  const st = $('sh-status'); st.className = 'status ' + cur.status; st.textContent = statusText(cur);
  $('sh-cust-wrap').hidden = M.name('inspect_types', cur.inspect_type_id) !== '交屋檢查';
  $('sh-cust').value = cur.customer_name || '';
  paintChoices();
  $('sh-date').value = cur.planned_date || '';
  $('sh-desc').value = cur.description || '';
  // 修繕與複驗
  const rep = $('sh-repair'); rep.hidden = isNew;
  $('sh-fixdate').value = cur.fixed_date || today();
  $('sh-reason').hidden = true; $('sh-nofix-go').hidden = true; $('sh-reason').value = cur.close_reason || '';
  const st2 = cur.status;
  $('sh-fixed').hidden = st2 !== 'todo';
  $('sh-pass').hidden = st2 !== 'fixed';
  const nf = isNofix(cur);
  $('sh-sign').hidden = st2 !== 'signing';
  $('sh-signname').value = cur.signed_name || ''; $('sh-signdate').value = cur.signed_date || today();
  $('sh-nofix').hidden = st2 !== 'todo';
  $('sh-reopen').hidden = !(st2 === 'fixed' || st2 === 'signing' || (st2 === 'closed' && isSiteAdmin(cur.site_id)));
  $('sh-reopen').textContent = st2 === 'closed' ? '重新開案（要填原因）' : '複驗不合格／客戶不認可，退回待修';
  $('sh-reopen-reason').hidden = true; $('sh-reopen-go').hidden = true; $('sh-reopen-reason').value = '';
  $('sh-fixdate-wrap').hidden = !(st2 === 'todo' || (st2 === 'fixed' && !nf));
  paintStatusText();
  $('sh-del').hidden = isNew || !isSiteAdmin(cur.site_id) || st2 === 'closed'; $('sh-del').textContent = '刪除';
  $('sh-save').hidden = st2 === 'closed';
  $('sh-trail').textContent = isNew ? '' :
    `建立：${M.userName(cur.created_by)} ${fmtTime(cur.created_at)}　最後修改：${M.userName(cur.updated_by) || M.userName(cur.created_by)} ${fmtTime(cur.updated_at)}` +
    (cur.fixed_at ? `　修繕完成登錄：${M.userName(cur.fixed_by)} ${fmtTime(cur.fixed_at)}` : '') +
    (cur.verified_at ? `　複驗：${M.userName(cur.verified_by)} ${fmtTime(cur.verified_at)}` : '') +
    (cur.closed_at ? `　結案：${M.userName(cur.closed_by)} ${fmtTime(cur.closed_at)}` : '');
  $('sh-log').hidden = isNew; $('sh-log').open = false; $('sh-loglist').innerHTML = '';
  paintVendorMode();
  paintLock();
  paintNext(isNew);
  paintPhotos();
  paintMini();
}
// 需簽認類型：客戶簽過名的（重新開案回來的）複驗合格就直接結案，不用再簽
function signLeft() { return needSign(cur.inspect_type_id) && !cur.sign.length; }
function paintStatusText() {
  const st2 = cur.status, nf = isNofix(cur), sign = signLeft();
  const signed = needSign(cur.inspect_type_id) && !sign ? '（客戶已簽過，不用再簽）' : '';
  $('sh-pass').textContent = (nf ? '確認不修' : '複驗合格') + (sign ? '（接著等客戶簽認）' : '，結案');
  $('sh-closeinfo').textContent = st2 === 'closed'
    ? `已結案：${cur.close_type}${cur.close_type === '不修' ? '（原因：' + (cur.close_reason || '') + '）' : ''}${cur.signed_name ? `　簽認：${cur.signed_name} ${cur.signed_date || ''}` : ''}`
    : st2 === 'signing' ? `${cur.close_type === '不修' ? `已確認不修（原因：${cur.close_reason || ''}）` : '複驗合格'}，等客戶簽認。請客戶確認後按「客戶簽名」，在簽名板簽名就結案；客戶不認可按「退回待修」。`
    : nf ? `已提出不修（原因：${cur.close_reason || ''}），等驗收人員確認。同意不修按「確認不修」${sign ? '（之後還要客戶簽認）' : '結案' + signed}；不同意按「退回待修」。`
    : (st2 === 'fixed' ? `廠商已修繕，等複驗。複驗合格就按「複驗合格」${sign ? '（之後還要客戶簽認）' : '結案' + signed}；不合格按「退回待修」。` : '修好後拍「修繕後照片」，再按「修繕完成」；不修的話按「不修」填原因，送驗收人員確認。');
}
// 表單上方的小平面圖：標出這筆缺失的位置（從報表點進來也看得到）
async function paintMini() {
  const box = $('sh-mini'); const me = cur; box.querySelectorAll('.pin').forEach(p => p.remove());
  const plan = cur.plan_id != null && cur.x != null && S.m.plans.find(p => p.id === cur.plan_id);
  box.hidden = !plan; if (!plan) return;
  const url = await signedUrl('plans', plan.path).catch(() => '');
  if (me !== cur) return;
  $('sh-miniimg').src = url; fitMiniPlan();
  const pin = el('div', 'pin ' + cur.status, String(ctx.no || cur.id)); pin.style.left = (cur.x * 100) + '%'; pin.style.top = (cur.y * 100) + '%';
  box.appendChild(pin);
  const canMove = !isVendor() && cur.status !== 'closed';
  box.onclick = () => openPlanView({ src: $('sh-miniimg').src, pins: [{ x: cur.x, y: cur.y, no: ctx.no || cur.id, status: cur.status, hi: true }],
    hint: canMove ? '兩指放大、拖動；要移動編號按「改位置」' : '兩指放大、拖動，點兩下放大',
    onMove: canMove ? async (x, y) => { try { await persist(false); await setStatus({ x, y }); toast('已改位置'); paintMini(); ctx.moved = true; } catch (e) { toast(errMsg(e)); } } : null });
}
// 舊缺失：最上面直接說下一步要做什麼，點了捲到修繕區
function paintNext(isNew) {
  const b = $('sh-next'), st = cur.status, nf = isNofix(cur), sign = signLeft(), v = isVendor();
  const msg = isNew ? '' : st === 'todo' ? '修好後拍「修繕後照片」，按「修繕完成」'
    : st === 'fixed' && !v ? (nf ? '確認是否同意不修' : '到現場複驗，合格按「複驗合格」') + (sign ? '，再請客戶簽認' : '')
    : st === 'signing' && !v ? '請客戶簽名，就結案' : '';
  b.hidden = !msg; b.innerHTML = ''; if (!msg) return;
  b.append(el('b', null, '下一步：'), document.createTextNode(msg + '　↓'));
}
$('sh-next').onclick = () => $('sh-repair').scrollIntoView({ behavior: 'smooth', block: 'start' });
// 已結案：資料鎖定（資料庫也會擋），要改只能由管理者重新開案
function paintLock() {
  if (cur.status !== 'closed') return;   // 沒結案時的可否編輯由 paintVendorMode 決定
  $('sheet').querySelector('.panel').querySelectorAll('.chip, #sh-cust, #sh-date, #sh-desc, #sh-fixvendor-other, #sh-vendor').forEach(x => { x.disabled = true; });
  $('sh-placerow').hidden = true;
  $('sh-closeinfo').textContent = '已結案，資料已鎖定。' + $('sh-closeinfo').textContent.replace(/^已結案：/, '結案方式：') +
    (isSiteAdmin(cur.site_id) ? '　要修改請按「重新開案」並填原因。' : '　要修改請找管理者重新開案。');
}
// 廠商帳號：缺失內容只能看；只能填修繕完成日、拍修繕後照片、按修繕完成
function paintVendorMode() {
  const v = isVendor(); const panel = $('sheet').querySelector('.panel');
  panel.querySelectorAll('.chip, #sh-cust, #sh-date, #sh-desc, #sh-fixvendor-other, #sh-vendor').forEach(x => { x.disabled = v; });
  if (!v) return;
  ['sh-pass', 'sh-sign', 'sh-nofix', 'sh-reopen', 'sh-del', 'sh-save'].forEach(id => { $(id).hidden = true; });
  if (cur.status === 'fixed') $('sh-closeinfo').textContent = '已回報修繕完成，等甲方複驗。';
  if (cur.status === 'todo') $('sh-closeinfo').textContent = '修好後拍「修繕後照片」，再按「修繕完成」回報。';
}

function paintChoices() {
  chips($('sh-space'), M.spacesFor(cur.unit_id, cur.floor, cur.space_id), cur.space_id, r => { cur.space_id = r.id; paintChoices(); }, { empty: '尚無空間別，請管理者新增' });
  const zid = M.unitZone(M.get('units', cur.unit_id));        // 只出現這一區（專有戶／公設）的工項
  chips($('sh-cat'), M.list('categories').filter(c => M.inZone(c, zid) || c.id === cur.category_id), cur.category_id, r => {
    cur.category_id = r.id; cur.item_id = null;
    const vs = M.vendorsOfCat(r.id); cur.fix_vendor_id = vs[0] ? vs[0].id : null;
    if (!cur.respTouched) cur.resp_vendor_id = cur.fix_vendor_id;
    paintChoices();
  });
  const items = cur.category_id ? M.list('items').filter(i => i.category_id === cur.category_id && (M.itemIn(i, zid) || i.id === cur.item_id)) : [];
  chips($('sh-item'), items, cur.item_id, r => {
    const first = !cur.id && !cur.item_id; cur.item_id = r.id; paintChoices();
    if (first) $('sh-step2').scrollIntoView({ behavior: 'smooth', block: 'start' });   // 新增時選好分類就帶到第 ② 步
  },
    { empty: cur.category_id ? '此工項尚無缺失內容，請管理者新增' : '請先選工項' });
  chips($('sh-method'), M.list('repair_methods'), cur.repair_method_id, r => { cur.repair_method_id = cur.repair_method_id === r.id ? null : r.id; paintChoices(); });
  // 修繕廠商：工項預設廠商做成按鈕，其他廠商用下拉
  const vs = cur.category_id ? M.vendorsOfCat(cur.category_id) : [];
  chips($('sh-fixvendor-chips'), vs, cur.fix_vendor_id, r => setFixVendor(r.id),
    { empty: cur.category_id ? '此工項尚未設定廠商，可從下方選其他廠商' : '先選工項' });
  const allV = M.list('vendors');
  fillSelect($('sh-fixvendor-other'), allV, vs.find(v => v.id === cur.fix_vendor_id) ? '' : cur.fix_vendor_id, '其他廠商…');
  const respList = allV.slice(); const cr = M.get('vendors', cur.resp_vendor_id);
  if (cr && !respList.find(v => v.id === cr.id)) respList.push(cr);
  fillSelect($('sh-vendor'), respList, cur.resp_vendor_id, '（未指定）');
}
function setFixVendor(id) {
  cur.fix_vendor_id = id;
  if (!cur.respTouched) cur.resp_vendor_id = id;
  paintChoices();
}
$('sh-fixvendor-other').onchange = e => { if (e.target.value) setFixVendor(Number(e.target.value)); };
$('sh-vendor').onchange = e => { cur.resp_vendor_id = e.target.value ? Number(e.target.value) : null; cur.respTouched = true; };

// ---- 照片 ----
function paintPhotos() {
  photoBox($('sh-photos'), cur.before, 'before');
  photoBox($('sh-afterphotos'), cur.after, 'after');
  paintSigns();
}
// 已刪除的照片：檔案還在，管理者在原本的照片格裡看得到，點一下就還原（已結案要先重新開案）
function trashTile(box, p) {
  const w = el('div', 'ph del gone'); const im = el('img'); im.src = p.url; im.alt = '已刪除的照片'; w.appendChild(im);
  w.title = `${M.userName(p.deleted_by) || ''} ${fmtTime(p.deleted_at)} 刪除`;
  const closed = cur.status === 'closed';
  const u = el('button', 'undo', closed ? '已刪除' : '已刪除\n點此還原'); u.type = 'button';
  if (closed) u.disabled = true;
  else u.onclick = () => guard(u, async () => {
    const { error } = await sb.from('defect_photos').update({ deleted_at: null }).eq('id', p.id); if (error) throw error;
    cur.trash.splice(cur.trash.indexOf(p), 1); delete p.deleted_at;
    (p.kind === 'after' ? cur.after : cur.before).push(p); paintPhotos(); toast('照片已還原');
  });
  w.appendChild(u); box.appendChild(w);
}
function paintSigns() {   // 簽名圖只看不刪（簽認的證據）
  const box = $('sh-signimg'); box.innerHTML = '';
  $('sh-signwrap').hidden = !cur.sign.length;
  cur.sign.forEach(p => { const im = el('img'); im.src = p.url; im.alt = '客戶簽名'; im.onclick = () => showViewer(p.url); box.appendChild(im); });
}
function photoBox(box, arr, kind) {
  box.innerHTML = '';
  arr.forEach(p => {
    const w = el('div', 'ph' + (p.del ? ' del' : '')); const im = el('img'); im.src = p.url; im.alt = '缺失照片'; w.appendChild(im);
    const canDel = cur.status !== 'closed' && (!p.id || isSiteAdmin(cur.site_id) || (p.by === S.user.id && !(isVendor() && kind === 'before')));
    if (p.del) {   // 標記刪除：按「儲存」等動作時才真的刪，之前都能復原
      const u = el('button', 'undo', '待刪除\n點此復原'); u.type = 'button'; u.onclick = () => { p.del = false; paintPhotos(); }; w.appendChild(u);
    } else im.onclick = () => showViewer(p.url, canDel ? () => { p.del = true; paintPhotos(); toast('照片已標記刪除，按「儲存」才會真的刪；按「取消」或點照片可復原'); } : null);
    box.appendChild(w); return;
  });
  if (isSiteAdmin(cur.site_id)) cur.trash.filter(p => (p.kind === 'after') === (kind === 'after')).forEach(p => trashTile(box, p));
  if (cur.status === 'closed') return;   // 已結案不能加照片
  if (isVendor() && (kind === 'before' || cur.status !== 'todo')) return;   // 廠商只能在待修時補修繕後照片
  const lab = el('label'); lab.innerHTML = kind === 'after' ? '＋拍照<br>修繕後' : '＋拍照<br>或選圖';
  const inp = el('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  inp.onchange = async () => {
    let files = [...inp.files]; inp.value = '';
    if (files.length > PHOTO_PICK_MAX) { toast(`一次最多選 ${PHOTO_PICK_MAX} 張，已取前 ${PHOTO_PICK_MAX} 張`); files = files.slice(0, PHOTO_PICK_MAX); }
    const big = files.filter(f => f.size > PHOTO_FILE_MAX || (f.type && !f.type.startsWith('image/')));
    if (big.length) { toast(`${big.length} 個檔案太大或不是照片，已略過`); files = files.filter(f => !big.includes(f)); }
    for (const f of files) {
      try { const blob = await compressImage(f); arr.push({ blob, url: URL.createObjectURL(blob) }); }
      catch (e) { toast(errMsg(e)); }
    }
    paintPhotos();
  };
  lab.appendChild(inp); box.appendChild(lab);
}

// ---- 儲存 ----
function collect() {
  cur.customer_name = $('sh-cust').value.trim() || null;
  cur.planned_date = $('sh-date').value || null;
  cur.description = $('sh-desc').value.trim() || null;
}
async function persist(needFull = true) {
  collect();
  for (const arr of [cur.before, cur.after]) arr.filter(p => p.del).forEach(p => { arr.splice(arr.indexOf(p), 1); if (p.id) cur.removed.push(p); else URL.revokeObjectURL(p.url); });
  if (needFull && (!cur.space_id || !cur.category_id || !cur.item_id)) throw new Error('請選好空間、工項、缺失內容');
  const f = {
    customer_name: cur.customer_name, space_id: cur.space_id, category_id: cur.category_id, item_id: cur.item_id,
    repair_method_id: cur.repair_method_id, fix_vendor_id: cur.fix_vendor_id, resp_vendor_id: cur.resp_vendor_id,
    planned_date: cur.planned_date, description: cur.description
  };
  if (!cur.id) {
    const row = { site_id: cur.site_id, inspect_type_id: cur.inspect_type_id, building_id: cur.building_id, floor: cur.floor,
      unit_id: cur.unit_id, plan_id: cur.plan_id, x: cur.x, y: cur.y, ...f, created_by: S.user.id };
    const { data, error } = await sb.from('defects').insert(row).select().single();
    if (error) throw error;
    Object.assign(cur, data);
    ctx.no = ctx.no || data.id;
  } else {
    const { data, error } = await sb.from('defects').update(f).eq('id', cur.id).eq('updated_at', cur.updated_at).select();
    if (error) throw error;
    if (!data.length) throw new Error('這筆剛剛被別人修改過，請按「取消」關閉後重新打開再改');
    Object.assign(cur, data[0]);
  }
  if (cur.customer_name) { try { sessionStorage.setItem('qc-cust-' + cur.unit_id, cur.customer_name); } catch (e) { /* ignore */ } }
  // 刪除被移除的照片
  // 刪除被移除的照片：只標記已刪除、檔案保留（21_照片保護.sql）；資料庫還沒更新時照舊真的刪
  for (const p of cur.removed.slice()) {
    const { error } = await sb.from('defect_photos').update({ deleted_at: new Date().toISOString() }).eq('id', p.id);
    if (error && /deleted_at/.test(errMsg(error))) {
      const r = await sb.from('defect_photos').delete().eq('id', p.id); if (r.error) throw r.error;
      await removeFiles('photos', [p.path]);
    } else if (error) throw error;
    cur.removed.splice(cur.removed.indexOf(p), 1);
  }
  // 上傳新照片
  for (const [arr, kind] of [[cur.before, 'before'], [cur.after, 'after']]) {
    for (const p of arr) {
      if (!p.blob) continue;
      const row = await uploadPhoto(cur.id, kind, p.blob);
      URL.revokeObjectURL(p.url);
      p.url = await signedUrl('photos', row.path); p.id = row.id; p.path = row.path; p.by = S.user.id; delete p.blob;
    }
  }
}
async function setStatus(patch) {
  const { data, error } = await sb.from('defects').update(patch).eq('id', cur.id).eq('updated_at', cur.updated_at).select();
  if (error) throw error;
  if (!data.length) throw new Error('這筆剛剛被別人修改過，請按「取消」關閉後重新打開');
  Object.assign(cur, data[0]);
}
function done(msg) { toast(msg); const cb = ctx.onDone; closeSheet(); if (cb) cb(); }

$('sh-place').onclick = e => guard(e.currentTarget, async () => {
  await persist(false);
  const id = cur.id, cb = ctx.onPlace; closeSheet(); cb(id);
});
$('sh-unplace').onclick = e => guard(e.currentTarget, async () => {
  await persist(false);
  await setStatus({ plan_id: null, x: null, y: null });
  done('已移除位置');
});
$('sh-save').onclick = e => guard(e.currentTarget, async () => { await persist(); done('已儲存'); });
$('sh-fixed').onclick = e => guard(e.currentTarget, async () => {
  await persist();
  if (!cur.after.filter(p => !p.del).length) throw new Error('請先拍「修繕後照片」，才能標示修繕完成');
  await setStatus({ status: 'fixed', fixed_date: $('sh-fixdate').value || today() });
  done('已標示修繕完成，等複驗');
});
$('sh-pass').onclick = e => guard(e.currentTarget, async () => {
  await persist();
  const nf = isNofix(cur), ct = nf ? '不修' : null, cr = nf ? cur.close_reason : null;
  const toSign = () => setStatus({ status: 'signing', close_type: ct, close_reason: cr }).then(() => done((nf ? '已確認不修' : '複驗合格') + '，等客戶簽認'));
  if (signLeft()) return toSign();
  try { await setStatus({ status: 'closed', close_type: ct || '複驗合格', close_reason: cr }); }
  catch (er) {   // 還沒執行 25_重新開案免重簽.sql：照舊走待簽認
    if (needSign(cur.inspect_type_id) && /不允許的狀態變更/.test(errMsg(er))) return toSign();
    throw er;
  }
  done((nf ? '已確認不修' : '複驗合格') + (needSign(cur.inspect_type_id) ? '，客戶已簽過，直接結案' : '，已結案'));
});
$('sh-signgo').onclick = e => guard(e.currentTarget, async () => {
  const blob = await openSignPad(); if (!blob) return;
  await persist();
  const ph = await uploadPhoto(cur.id, 'sign', blob);
  await setStatus({ status: 'closed', close_type: cur.close_type || '複驗合格', close_reason: cur.close_reason || null, signed_name: $('sh-signname').value.trim() || null, signed_date: $('sh-signdate').value || today() });
  await recordSign([cur], cur.signed_name || null, cur.signed_date || today(), ph.path, { [cur.id]: ctx.no });
  done('客戶已簽認，結案');
});
$('sh-reopen').onclick = e => {
  if (cur.status === 'closed') { $('sh-reopen-reason').hidden = false; $('sh-reopen-go').hidden = false; $('sh-reopen-reason').focus(); return; }
  reopen(e.currentTarget);
};
$('sh-reopen-go').onclick = e => reopen(e.currentTarget, $('sh-reopen-reason').value.trim());
const reopen = (b, why) => guard(b, async () => {
  const wasClosed = cur.status === 'closed';
  if (wasClosed && !why) throw new Error('請填重新開案的原因');
  if (!wasClosed) await persist(false);
  const patch = { status: 'todo', close_type: null, close_reason: null, fixed_date: null };
  if ('signed_name' in cur && !cur.sign.length) Object.assign(patch, { signed_name: null, signed_date: null });   // 客戶簽過的保留簽認人（有執行 7_待簽認.sql 才有這兩欄）
  if (wasClosed) patch.reopen_reason = why;
  try { await setStatus(patch); }
  catch (er) { if (wasClosed && /reopen_reason/.test(errMsg(er))) throw new Error('資料庫還沒更新，請管理者先執行 20_異動紀錄與結案鎖定.sql'); throw er; }
  done(wasClosed ? '已重新開案，退回待修' : '已退回待修');
});
$('sh-nofix').onclick = () => { $('sh-reason').hidden = false; $('sh-nofix-go').hidden = false; $('sh-reason').focus(); };
$('sh-nofix-go').onclick = e => guard(e.currentTarget, async () => {
  const why = $('sh-reason').value.trim();
  if (!why) throw new Error('請填不修的原因');
  await persist();
  try { await setStatus({ status: 'fixed', close_type: '不修', close_reason: why, fixed_date: null }); }
  catch (er) { if (/修繕後照片/.test(errMsg(er))) throw new Error('資料庫還沒更新「不修要複驗」的規則，請管理者先執行 9_不修複驗.sql'); throw er; }
  done('已提出不修，等驗收人員確認');
});
$('sh-del').onclick = e => {
  const b = e.currentTarget;
  if (!b.dataset.arm) { b.dataset.arm = '1'; b.textContent = '再按一次確認刪除'; setTimeout(() => { delete b.dataset.arm; b.textContent = '刪除'; }, 4000); return; }
  guard(b, async () => {
    const paths = [...cur.before, ...cur.after, ...cur.sign].filter(p => p.path).map(p => p.path);
    const { error } = await sb.from('defects').delete().eq('id', cur.id);
    if (error) throw error;
    await removeFiles('photos', paths);
    done('已刪除');
  });
};
const sheetCancel = () => { if (cur) { const cb = ctx.moved ? ctx.onDone || ctx.onClose : ctx.onClose; closeSheet(); if (cb) cb(); } };   // 改過位置：回去要重畫圖
$('sh-cancel').onclick = sheetCancel; $('sh-back').onclick = sheetCancel;

// 修改歷程：每次新增、修改、刪除照片都由資料庫自動記錄（20_異動紀錄與結案鎖定.sql），這裡只讀
const LOG_FIELDS = {
  space_id: ['空間別', 'spaces'], category_id: ['工項', 'categories'], item_id: ['缺失內容', 'items'],
  repair_method_id: ['修繕方式', 'repair_methods'], fix_vendor_id: ['修繕廠商', 'vendors'], resp_vendor_id: ['責任廠商', 'vendors'],
  inspect_type_id: ['檢查類型', 'inspect_types'], unit_id: ['戶別', 'units'], building_id: ['棟別', 'buildings'], floor: ['樓層'],
  status: ['狀態'], description: ['缺失說明'], customer_name: ['客戶名稱'], planned_date: ['預計修繕日'], fixed_date: ['修繕完成日'],
  close_type: ['結案方式'], close_reason: ['不修原因'], reopen_reason: ['重新開案原因'], signed_name: ['簽認人'], signed_date: ['簽認日期'],
  x: ['位置'], y: ['位置'], plan_id: ['平面圖'],
};
const PHOTO_KIND = { before: '修繕前照片', after: '修繕後照片', sign: '簽名' };
function logValue(k, v) {
  if (v == null || v === '') return '（空白）';
  const f = LOG_FIELDS[k];
  if (k === 'status') return STATUS[v] || v;
  if (f && f[1]) { const r = M.get(f[1], v); return r ? (r.name || r.code) : `#${v}`; }
  return String(v);
}
function logLine(g) {
  if (g.action === '新增') return '新增這筆缺失';
  if (g.action === '刪除') return '刪除這筆缺失';
  if (/照片$/.test(g.action)) return `${g.action.slice(0, 2)}${PHOTO_KIND[g.changes.kind] || '照片'}`;
  const parts = []; let moved = false;
  Object.entries(g.changes).forEach(([k, [a, b]]) => {
    const f = LOG_FIELDS[k]; if (!f) return;
    if (k === 'x' || k === 'y' || k === 'plan_id') { if (!moved) parts.push(b == null && k !== 'plan_id' ? '移除圖上位置' : '調整圖上位置'); moved = true; return; }
    parts.push(`${f[0]}：${logValue(k, a)} → ${logValue(k, b)}`);
  });
  return parts.join('；');
}
async function paintLog() {
  const box = $('sh-loglist'), me = cur; box.textContent = '讀取中…';
  const { data, error } = await sb.from('defect_logs').select('*').eq('defect_id', cur.id).order('at', { ascending: false });
  if (me !== cur) return;
  box.innerHTML = '';
  if (error) { box.appendChild(el('p', 'hint', /defect_logs/.test(errMsg(error)) ? '讀不到修改歷程，請確認已執行 20_異動紀錄與結案鎖定.sql。（' + errMsg(error) + '）' : '讀不到修改歷程：' + errMsg(error))); return; }
  const rows = (data || []).map(g => ({ g, t: logLine(g) })).filter(x => x.t);
  if (!rows.length) { box.appendChild(el('p', 'hint', '目前沒有修改紀錄。')); return; }
  rows.forEach(({ g, t }) => {
    const r = el('div', 'logrow');
    r.append(el('small', 'hint', `${fmtTime(g.at)}　${M.userName(g.by_user) || '系統'}`), el('div', null, t));
    box.appendChild(r);
  });
}
$('sh-log').addEventListener('toggle', () => { if ($('sh-log').open && cur && cur.id) paintLog(); });
