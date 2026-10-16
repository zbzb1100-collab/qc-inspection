/* 缺失表單：新增、修改、修繕完成、複驗結案、不修 */
let cur = null, ctx = null;

async function openDefect(row, c) {
  ctx = c || {};
  const base = row ? { ...row } : {
    ...ctx.create, status: 'todo', space_id: null, category_id: null, item_id: null,
    repair_method_id: null, fix_vendor_id: null, resp_vendor_id: null,
    planned_date: today(10), fixed_date: null, description: '', customer_name: lastCustomer(ctx.create.unit_id)
  };
  cur = base;
  cur.before = []; cur.after = []; cur.removed = [];
  cur.respTouched = !!row && row.resp_vendor_id !== row.fix_vendor_id;
  $('sheet').hidden = false; $('sheet').querySelector('.panel').scrollTop = 0;
  paintSheet();
  if (row) {
    const { data, error } = await sb.from('defect_photos').select('*').eq('defect_id', row.id).order('id');
    if (error) { toast(errMsg(error)); return; }
    const urls = await signedUrls('photos', data.map(p => p.path));
    data.forEach((p, i) => (p.kind === 'after' ? cur.after : cur.before).push({ id: p.id, path: p.path, url: urls[i], by: p.created_by }));
    paintPhotos();
  }
}
function lastCustomer(unitId) { try { return sessionStorage.getItem('qc-cust-' + unitId) || ''; } catch (e) { return ''; } }
function closeSheet() {
  [...cur.before, ...cur.after].forEach(p => p.blob && URL.revokeObjectURL(p.url));
  $('sheet').hidden = true; cur = null;
}

function paintSheet() {
  const isNew = !cur.id;
  const bName = M.name('buildings', cur.building_id), uCode = M.unitCode(cur.unit_id);
  $('sh-no').textContent = ctx.no || cur.id || '+';
  $('sh-title').textContent = isNew ? '新增缺失' : '缺失內容';
  $('sh-where').textContent = `${bName} ${cur.floor} ${uCode}　${M.name('inspect_types', cur.inspect_type_id)}` +
    (cur.x != null ? '　已標在平面圖上' : '　未標位置');
  const st = $('sh-status'); st.className = 'status ' + cur.status; st.textContent = STATUS[cur.status];
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
  $('sh-nofix').hidden = st2 === 'closed';
  $('sh-reopen').hidden = !(st2 === 'fixed' || (st2 === 'closed' && isAdmin()));
  $('sh-fixdate-wrap').hidden = st2 === 'closed';
  $('sh-closeinfo').textContent = st2 === 'closed'
    ? `已結案：${cur.close_type}${cur.close_type === '不修' ? '（原因：' + (cur.close_reason || '') + '）' : ''}`
    : (st2 === 'fixed' ? '廠商已修繕，等複驗。複驗合格就按②結案；不合格按「退回待修」。' : '修好後拍「修繕後照片」，再按①。');
  $('sh-del').hidden = isNew || !isAdmin(); $('sh-del').textContent = '刪除';
  $('sh-trail').textContent = isNew ? '' :
    `建立：${M.userName(cur.created_by)} ${fmtTime(cur.created_at)}　最後修改：${M.userName(cur.updated_by) || M.userName(cur.created_by)} ${fmtTime(cur.updated_at)}` +
    (cur.fixed_at ? `　修繕完成登錄：${M.userName(cur.fixed_by)} ${fmtTime(cur.fixed_at)}` : '') +
    (cur.closed_at ? `　結案：${M.userName(cur.closed_by)} ${fmtTime(cur.closed_at)}` : '');
  paintPhotos();
}

function paintChoices() {
  chips($('sh-space'), M.spacesFor(cur.unit_id, cur.floor, cur.space_id), cur.space_id, r => { cur.space_id = r.id; paintChoices(); }, { empty: '尚無空間別，請管理者新增' });
  chips($('sh-cat'), M.list('categories'), cur.category_id, r => {
    cur.category_id = r.id; cur.item_id = null;
    const vs = M.vendorsOfCat(r.id); cur.fix_vendor_id = vs[0] ? vs[0].id : null;
    if (!cur.respTouched) cur.resp_vendor_id = cur.fix_vendor_id;
    paintChoices();
  });
  const items = cur.category_id ? M.itemsOf(cur.category_id) : [];
  chips($('sh-item'), items, cur.item_id, r => { cur.item_id = r.id; paintChoices(); },
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
}
function photoBox(box, arr, kind) {
  box.innerHTML = '';
  arr.forEach(p => {
    const w = el('div', 'ph'); const im = el('img'); im.src = p.url; im.alt = '缺失照片'; im.onclick = () => showViewer(p.url); w.appendChild(im);
    if (!p.id || isAdmin() || p.by === S.user.id) {
      const x = el('button', null, '×'); x.type = 'button'; x.title = '刪除這張';
      x.onclick = () => { arr.splice(arr.indexOf(p), 1); if (p.id) cur.removed.push(p); else URL.revokeObjectURL(p.url); paintPhotos(); };
      w.appendChild(x);
    }
    box.appendChild(w);
  });
  const lab = el('label'); lab.innerHTML = kind === 'after' ? '＋拍照<br>修繕後' : '＋拍照<br>或選圖';
  const inp = el('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  inp.onchange = async () => {
    const files = [...inp.files]; inp.value = '';
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
    const { error } = await sb.from('defects').update(f).eq('id', cur.id);
    if (error) throw error;
  }
  if (cur.customer_name) { try { sessionStorage.setItem('qc-cust-' + cur.unit_id, cur.customer_name); } catch (e) { /* ignore */ } }
  // 刪除被移除的照片
  for (const p of cur.removed.slice()) {
    const { error } = await sb.from('defect_photos').delete().eq('id', p.id); if (error) throw error;
    await sb.storage.from('photos').remove([p.path]);
    cur.removed.splice(cur.removed.indexOf(p), 1);
  }
  // 上傳新照片
  for (const [arr, kind] of [[cur.before, 'before'], [cur.after, 'after']]) {
    for (const p of arr) {
      if (!p.blob) continue;
      const path = `${cur.id}/${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
      const up = await sb.storage.from('photos').upload(path, p.blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const ins = await sb.from('defect_photos').insert({ defect_id: cur.id, kind, path, created_by: S.user.id }).select().single();
      if (ins.error) throw ins.error;
      URL.revokeObjectURL(p.url);
      p.url = await signedUrl('photos', path); p.id = ins.data.id; p.path = path; p.by = S.user.id; delete p.blob;
    }
  }
}
async function setStatus(patch) {
  const { data, error } = await sb.from('defects').update(patch).eq('id', cur.id).select().single();
  if (error) throw error;
  Object.assign(cur, data);
}
function done(msg) { toast(msg); const cb = ctx.onDone; closeSheet(); if (cb) cb(); }

$('sh-save').onclick = e => guard(e.currentTarget, async () => { await persist(); done('已儲存'); });
$('sh-fixed').onclick = e => guard(e.currentTarget, async () => {
  await persist();
  if (!cur.after.length) throw new Error('請先拍「修繕後照片」，才能標示修繕完成');
  await setStatus({ status: 'fixed', fixed_date: $('sh-fixdate').value || today() });
  done('已標示修繕完成，等複驗');
});
$('sh-pass').onclick = e => guard(e.currentTarget, async () => {
  await persist();
  await setStatus({ status: 'closed', close_type: '複驗合格', close_reason: null });
  done('複驗合格，已結案');
});
$('sh-reopen').onclick = e => guard(e.currentTarget, async () => {
  await persist(false);
  await setStatus({ status: 'todo', close_type: null, close_reason: null, fixed_date: null });
  done('已退回待修');
});
$('sh-nofix').onclick = () => { $('sh-reason').hidden = false; $('sh-nofix-go').hidden = false; $('sh-reason').focus(); };
$('sh-nofix-go').onclick = e => guard(e.currentTarget, async () => {
  const why = $('sh-reason').value.trim();
  if (!why) throw new Error('請填不修的原因');
  await persist();
  await setStatus({ status: 'closed', close_type: '不修', close_reason: why });
  done('已標示不修並結案');
});
$('sh-del').onclick = e => {
  const b = e.currentTarget;
  if (!b.dataset.arm) { b.dataset.arm = '1'; b.textContent = '再按一次確認刪除'; setTimeout(() => { delete b.dataset.arm; b.textContent = '刪除'; }, 4000); return; }
  guard(b, async () => {
    const paths = [...cur.before, ...cur.after].filter(p => p.path).map(p => p.path);
    const { error } = await sb.from('defects').delete().eq('id', cur.id);
    if (error) throw error;
    if (paths.length) await sb.storage.from('photos').remove(paths);
    done('已刪除');
  });
};
const sheetCancel = () => { if (cur) { const cb = ctx.onClose; closeSheet(); if (cb) cb(); } };
$('sh-cancel').onclick = sheetCancel; $('sh-back').onclick = sheetCancel;
