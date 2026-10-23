/* 驗屋報告轉檔：上傳 PDF → 排程的 AI 讀完寫回 → 在這裡預覽、補選、匯入 */
const JOB_ST = { pending: '待轉檔', processing: '轉檔中', done: '已轉好・待確認', error: '轉檔失敗', imported: '已匯入' };
const JOB_PDF_MAX = 50 * 1024 * 1024;

async function renderJobs() {
  const root = $('jobs-root'); root.innerHTML = '';
  root.appendChild(el('div', 'banner', '上傳第三方驗屋報告（PDF），系統會排隊交給 AI 依固定規則判讀、裁照片。轉好後在下方清單按「確認匯入」，跟 Excel 匯入一樣先預覽，黃色列補選後才寫進缺失。'));
  root.appendChild(jobForm());
  const listBox = el('div', 'stack'); listBox.id = 'jobs-list'; root.appendChild(listBox);
  await drawJobs(listBox);
}

function jobForm() {
  const box = el('div', 'card stack');
  box.appendChild(el('b', null, '上傳驗屋報告'));
  const lab = (t, node) => { const d = el('div'); d.append(el('label', 'f', t), node); return d; };
  const bld = el('select'), flr = el('select'), unit = el('select'), typ = el('select');
  const ven = el('input'); ven.type = 'text'; ven.placeholder = '例：鷹眼、家昕（選填）';
  const note = el('textarea'); note.rows = 2; note.placeholder = '給 AI 的提醒（選填），例：第 3 頁起才是本戶';
  const fi = el('input'); fi.type = 'file'; fi.accept = 'application/pdf,.pdf'; fi.id = 'job-file';
  [bld, flr, unit, typ].forEach(s => { s.style.width = '100%'; });
  bld.id = 'job-bld'; flr.id = 'job-floor'; unit.id = 'job-unit'; typ.id = 'job-type'; ven.id = 'job-vendor'; note.id = 'job-note';
  { const bl = M.buildingsOf(S.sel.siteId); fillSelect(bld, bl, S.sel.bldId, '（選棟別）', b => M.bldLabel(b, bl)); }
  fillSelect(typ, M.list('inspect_types'), S.sel.typeId, '（選檢查類型）');
  const refill = () => {
    const b = M.get('buildings', Number(bld.value));
    fillSelect(flr, (b ? b.floors : []).map(f => ({ id: f, name: f })), b && b.id === S.sel.bldId ? S.sel.floor : null, '（選樓層）');
    fillSelect(unit, b ? M.unitsOf(b.id) : [], b && b.id === S.sel.bldId ? S.sel.unitId : null, '（選戶別）', u => u.code);
  };
  bld.onchange = refill; refill();
  const grid = el('div', 'row'); [lab('棟別', bld), lab('樓層', flr), lab('戶別', unit)].forEach(d => { d.style.flex = '1'; d.style.minWidth = '6em'; grid.appendChild(d); });
  box.append(grid, lab('檢查類型', typ), lab('驗屋公司', ven), lab('補充說明', note), lab('報告 PDF', fi));
  const go = el('button', 'btn block', '上傳，排隊轉檔'); go.id = 'job-go';
  go.onclick = () => guard(go, async () => {
    const f = fi.files[0];
    if (!bld.value || !flr.value || !unit.value || !typ.value) throw new Error('棟別、樓層、戶別、檢查類型都要選');
    if (!f) throw new Error('請選報告 PDF');
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') throw new Error('只收 PDF 檔');
    if (f.size > JOB_PDF_MAX) throw new Error('檔案超過 50MB，請分檔上傳');
    const path = `${crypto.randomUUID()}/report.pdf`;
    const up = await sb.storage.from('reports').upload(path, f, { contentType: 'application/pdf' });
    if (up.error) throw (/Bucket not found|bucket/i.test(up.error.message) ? new Error('要先到 Supabase 執行 10_報告轉檔.sql') : up.error);
    const rec = { site_id: S.sel.siteId, file_name: f.name, path, vendor: ven.value.trim() || null, building_id: Number(bld.value), floor: flr.value,
      unit_id: Number(unit.value), inspect_type_id: Number(typ.value), note: note.value.trim() || null, status: 'pending', created_by: S.user.id };
    const { error } = await sb.from('report_jobs').insert(rec);
    if (error) { await sb.storage.from('reports').remove([path]); throw (/report_jobs/.test(error.message) ? new Error('要先到 Supabase 執行 10_報告轉檔.sql') : error); }
    fi.value = ''; note.value = ''; toast('已上傳，等排程轉檔');
    await drawJobs($('jobs-list'));
  });
  box.appendChild(go);
  return box;
}

async function drawJobs(box) {
  box.innerHTML = '';
  const { data, error } = await sb.from('report_jobs').select('*').eq('site_id', S.sel.siteId).order('created_at', { ascending: false }).limit(100);
  if (error) { box.appendChild(el('div', 'banner', /report_jobs/.test(error.message) ? '要先到 Supabase 執行 10_報告轉檔.sql，才能用報告轉檔。' : errMsg(error))); return; }
  const head = el('div', 'row'); head.style.alignItems = 'center';
  const h = el('b', null, `轉檔清單（${data.length}）`); h.style.flex = '1';
  const rf = el('button', 'btn ghost', '重新整理'); rf.onclick = () => guard(rf, () => drawJobs(box));
  head.append(h, rf); box.appendChild(head);
  if (!data.length) box.appendChild(el('p', 'hint', '還沒有上傳過報告。'));
  // 管理員「優先轉檔」先關掉（2026-10-19 LMS：排程沒有 API 觸發，不能馬上跑就意義不大）；開放後把 pick 傳進 jobCard、加回 urgentBar 即可
  data.forEach(j => box.appendChild(jobCard(j, box)));
}

// 管理員：勾選待轉檔的報告 → 標成立即轉檔，並叫排程馬上跑（經 Supabase 的 fire-convert，鑰匙不放在網站）
function urgentBar(pick, listBox) {
  const bar = el('div', 'card stack'); bar.id = 'job-urgent';
  bar.appendChild(el('small', 'hint', '管理員：勾選下面「待轉檔」的報告按「優先轉檔」，下一次排程會先轉這幾份。'));
  const go = el('button', 'btn', '優先轉檔'); go.id = 'job-urgent-go';
  const upd = () => { go.textContent = pick.size ? `優先轉檔（${pick.size} 份）` : '優先轉檔'; go.disabled = !pick.size; };
  bar.update = upd; upd();
  go.onclick = () => guard(go, async () => {
    const ids = [...pick];
    const { error } = await sb.from('report_jobs').update({ urgent: true }).in('id', ids).eq('status', 'pending');
    if (error) throw (/urgent/.test(error.message) ? new Error('要先到 Supabase 執行 11_立即轉檔.sql') : error);
    // 有部署 fire-convert（排程開放 API 觸發後）就馬上叫排程跑；沒有就等下一次整點，照樣先轉這幾份
    const r = await sb.functions.invoke('fire-convert', { body: {} });
    let m = '';
    if (r.error) { try { m = (await r.error.context.json()).error; } catch (e) { /* 沒有部署或沒有回應內容 */ } }
    toast(r.error ? `已排到最前面，下一次整點排程先轉這 ${ids.length} 份` + (m && !/還沒設定/.test(m) ? `（立即觸發失敗：${m}）` : '')
      : `已開始轉檔 ${ids.length} 份，幾分鐘後按「重新整理」`);
    await drawJobs(listBox);
  });
  bar.appendChild(go);
  return bar;
}

function jobCard(j, listBox, pick) {
  const c = el('div', 'card stack'); c.dataset.job = j.id;
  const top = el('div', 'row'); top.style.alignItems = 'center';
  const t = el('b', null, `${M.name('buildings', j.building_id)} ${j.floor || ''} ${(M.get('units', j.unit_id) || {}).code || ''}　${M.name('inspect_types', j.inspect_type_id)}`); t.style.flex = '1';
  const st = el('span', 'status ' + ({ done: 'fixed', imported: 'closed', error: 'todo' }[j.status] || 'signing'), JOB_ST[j.status] || j.status);
  if (pick && isAdmin() && j.status === 'pending') {
    const cb = el('input'); cb.type = 'checkbox'; cb.dataset.urgent = j.id; cb.style.width = cb.style.height = '1.4em';
    cb.onchange = () => { cb.checked ? pick.add(j.id) : pick.delete(j.id); const b = document.getElementById('job-urgent'); if (b) b.update(); };
    top.appendChild(cb);
  }
  top.append(t);
  if (j.urgent && j.status === 'pending') top.appendChild(el('span', 'status todo', '優先'));
  top.append(st); c.appendChild(top);
  const who = (M.get('profiles', j.created_by) || {}).name || '';
  const n = j.result && j.result.rows ? j.result.rows.length : null;
  c.appendChild(el('small', 'hint', [j.file_name, j.vendor, who, fmtTime(j.created_at), n != null ? `讀出 ${n} 筆` : ''].filter(Boolean).join('　')));
  if (j.note) c.appendChild(el('small', 'hint', '說明：' + j.note));
  if (j.message) c.appendChild(el('small', 'hint', (j.status === 'error' ? '⚠ ' : 'AI 提醒：') + j.message));
  const row = el('div', 'row'); const out = el('div', 'stack');
  const btn = (txt, cls, fn) => { const b = el('button', cls, txt); b.onclick = () => guard(b, fn); row.appendChild(b); return b; };
  btn('看原檔', 'btn ghost', async () => { window.open(await signedUrl('reports', j.path), '_blank'); });
  if (j.status === 'done') btn('確認匯入', 'btn', async () => { out.innerHTML = ''; await jobPreview(j, out, listBox); });
  if (j.status === 'error') btn('重新排隊', 'btn ghost', async () => {
    const { error } = await sb.from('report_jobs').update({ status: 'pending', message: null }).eq('id', j.id); if (error) throw error; await drawJobs(listBox);
  });
  if (j.status !== 'processing' && (isAdmin() || j.created_by === S.user.id)) {
    let arm = 0;
    btn('刪除', 'btn ghost', async () => {
      if (!arm) { arm = 1; toast('再按一次「刪除」確定'); setTimeout(() => { arm = 0; }, 3000); return; }
      const names = jobPhotoNames(j).map(p => jobDir(j) + '/photos/' + p);
      const { error } = await sb.from('report_jobs').delete().eq('id', j.id); if (error) throw error;
      await removeFiles('reports', [j.path, ...names]); await drawJobs(listBox);
    });
  }
  c.append(row, out);
  return c;
}
const jobDir = j => j.path.replace(/\/[^/]*$/, '');
const jobPhotoNames = j => [...new Set(((j.result && j.result.rows) || []).flatMap(r => String(r['照片'] || '').split(/[、,，;；\n]+/).map(s => s.trim()).filter(Boolean)))];

// 轉好的結果 → 跟 Excel 匯入同一個預覽表；照片從 reports 儲存空間按需下載
async function jobPreview(j, out, listBox) {
  const rows = ((j.result && j.result.rows) || []).map(r => { const o = {}; Object.keys(r).forEach(k => { o[String(k).trim()] = String(r[k] ?? '').trim(); }); return o; });
  if (!rows.length) throw new Error('這份報告沒有讀出缺失');
  const photos = new Map();
  jobPhotoNames(j).forEach(nm => photos.set(imKey(nm.split('/').pop()), {
    async async() { const { data, error } = await sb.storage.from('reports').download(jobDir(j) + '/photos/' + nm); if (error) throw new Error('照片 ' + nm + ' 下載失敗：' + errMsg(error)); return data; }
  }));
  const skip = (j.result && j.result.skip) || [];
  if (skip.length) {
    const d = el('details'); d.appendChild(el('summary', null, `AI 判定不匯入 ${skip.length} 項（點開看原因）`));
    skip.forEach(s => d.appendChild(el('div', 'hint', Array.isArray(s) ? s.filter(Boolean).join('　') : String(s))));
    out.appendChild(d);
  }
  const box = el('div', 'stack'); out.appendChild(box);
  let viaRpc = true;
  imMountPreview(box, rows.map(r => imResolve(r, photos)), async () => {
    if (!viaRpc) {   // 資料庫還沒執行 22_匯入紀錄與轉檔權限.sql：照舊逐筆匯入後標記
      const { error } = await sb.from('report_jobs').update({ status: 'imported', imported_by: S.user.id, imported_at: new Date().toISOString() }).eq('id', j.id);
      if (error) toast('缺失已匯入，但轉檔狀態沒更新：' + errMsg(error));
    }
    await drawJobs(listBox);
  }, {
    // 22 之後：缺失一次寫入並標記已匯入，失敗就一筆都不寫，也不會被重複匯入
    insertAll: async recs => {
      const { data, error } = await sb.rpc('import_report_job', { p_job: j.id, p_rows: recs });
      if (error && /import_report_job|function/i.test(errMsg(error)) && !/已經匯入|還沒轉檔/.test(errMsg(error))) { viaRpc = false; return null; }
      if (error) throw error;
      return data;
    }
  });
}
