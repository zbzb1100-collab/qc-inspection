/* 測試用：在瀏覽器裡模擬 Supabase（資料放記憶體）。不會部署使用，只給 dev/smoke.mjs 跑流程測試 */
(function () {
  const T = {}; const seq = {};
  const ins = (t, row) => { seq[t] = (seq[t] || 0) + 1; const r = { id: seq[t], ...row }; (T[t] = T[t] || []).push(r); return r; };
  const seed = (t, rows) => rows.forEach(r => ins(t, r));
  T.sites = []; seed('sites', [{ name: '武東二段', sort: 1, active: true }]);
  seed('inspect_types', [{ name: '交屋檢查', sort: 1, active: true }]);
  seed('buildings', [{ site_id: 1, name: 'A棟', floors: ['2F', '3F', '8F'], sort: 1, active: true }, { site_id: 1, name: 'S店舖', floors: ['1F'], sort: 2, active: true }]);
  seed('units', [{ building_id: 1, code: 'A1', sort: 1, active: true }, { building_id: 1, code: 'A2', sort: 2, active: true }, { building_id: 2, code: 'S1', sort: 1, active: true }]);
  seed('spaces', [{ inspect_type_id: 1, code: '0', name: '全室', sort: 0, active: true }, { inspect_type_id: 1, code: 'A', name: '客餐廳', sort: 1, active: true }, { inspect_type_id: 1, code: 'B', name: '前陽台', sort: 2, active: true }]);
  seed('categories', [{ name: '01防水', sort: 1, active: true }, { name: '10油漆', sort: 2, active: true }]);
  seed('items', [{ category_id: 1, name: '有漏水或滲水情況', sort: 1, active: true }, { category_id: 2, name: '牆面油漆不勻', sort: 1, active: true }]);
  seed('vendors', [{ name: '太隆興業', active: true }, { name: '健暉工程行', active: true }, { name: '捷挺裝潢', active: true }]);
  T.category_vendors = [{ category_id: 1, vendor_id: 1, sort: 1 }, { category_id: 1, vendor_id: 2, sort: 2 }, { category_id: 2, vendor_id: 3, sort: 1 }];
  seed('repair_methods', [{ name: '修補', sort: 1, active: true }, { name: '更換', sort: 2, active: true }]);
  T.plans = []; T.plan_spaces = []; T.unit_spaces = []; T.defects = []; T.defect_photos = []; T.report_jobs = [];
  T.profiles = [{ id: 'u-admin', name: '管理員', email: 'boss@x.com', role: 'admin', active: true, created_at: '2026-01-01' },
    { id: 'u-staff', name: '王小明', email: 'staff@x.com', role: 'user', active: true, created_at: '2026-01-02' }];
  const files = {};            // storage: bucket/path -> Blob
  let session = null; let me = null;
  const png = () => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 300, 200); g.strokeRect(10, 10, 280, 180); return c.toDataURL('image/png'); };

  function builder(table) {
    const st = { op: 'select', filters: [], order: null, range: null, limit: null, single: false, payload: null, ret: false };
    const b = {
      select() { if (st.op !== 'select') st.ret = true; return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      delete() { st.op = 'delete'; return b; },
      eq(c, v) { st.filters.push(r => r[c] === v); return b; },
      neq(c, v) { st.filters.push(r => r[c] !== v); return b; },
      in(c, vs) { st.filters.push(r => vs.includes(r[c])); return b; },
      order(c, o) { st.order = [c, !(o && o.ascending === false)]; return b; },
      range(a, z) { st.range = [a, z]; return b; },
      limit(n) { st.limit = n; return b; },
      single() { st.single = true; return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    function run() {
      if (!me && table !== '__none') return { data: null, error: { message: 'JWT expired' } };
      const rows = (T[table] = T[table] || []);
      const match = r => st.filters.every(f => f(r));
      let out;
      if (st.op === 'insert') {
        const list = Array.isArray(st.payload) ? st.payload : [st.payload];
        for (const p of list) {  // 唯一性
          if (table === 'vendors' && rows.some(r => r.name === p.name)) return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
        }
        out = list.map(p => { const defaults = table === 'defects' ? { status: 'todo', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), updated_by: null } : {}; const defA = ['sites', 'inspect_types', 'buildings', 'units', 'spaces', 'categories', 'items', 'vendors', 'repair_methods'].includes(table) ? { active: true } : {}; return ins(table, { ...defA, ...defaults, ...p }); });
      } else if (st.op === 'update') {
        out = rows.filter(match); out.forEach(r => {
          Object.assign(r, st.payload);
          if (table === 'defects') { r.updated_at = new Date().toISOString(); r.updated_by = me;
            if (st.payload.status === 'fixed') { r.fixed_by = me; r.fixed_at = r.updated_at; }
            if (st.payload.status === 'closed') { r.closed_by = me; r.closed_at = r.updated_at; } }
        });
      } else if (st.op === 'delete') {
        out = rows.filter(match);
        const refs = { units: [['defects', 'unit_id']], buildings: [['defects', 'building_id'], ['units', 'building_id']], spaces: [['defects', 'space_id']], categories: [['defects', 'category_id'], ['items', 'category_id']], items: [['defects', 'item_id']], vendors: [['defects', 'fix_vendor_id'], ['defects', 'resp_vendor_id']], repair_methods: [['defects', 'repair_method_id']], inspect_types: [['defects', 'inspect_type_id'], ['spaces', 'inspect_type_id']] }[table] || [];
        if (out.some(r => refs.some(([t, c]) => (T[t] || []).some(x => x[c] === r.id)))) return { data: null, error: { code: '23503', message: 'violates foreign key constraint' } }; T[table] = rows.filter(r => !match(r));
        if (table === 'defects') T.defect_photos = T.defect_photos.filter(p => !out.some(d => d.id === p.defect_id));
      } else {
        out = rows.filter(match).slice();
        if (st.order) { const [c, asc] = st.order; out.sort((a, z) => (a[c] > z[c] ? 1 : a[c] < z[c] ? -1 : 0) * (asc ? 1 : -1)); }
        if (st.range) out = out.slice(st.range[0], st.range[1] + 1);
        if (st.limit != null) out = out.slice(0, st.limit);
      }
      if (st.op !== 'select' && !st.ret) return { data: null, error: null };
      out = JSON.parse(JSON.stringify(out));
      if (st.single) return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'single row expected' } };
      return { data: out, error: null };
    }
    return b;
  }
  const storage = { from: bucket => ({
    async upload(path, blob) { files[bucket + '/' + path] = blob; return { data: { path }, error: null }; },
    async download(path) { const f = files[bucket + '/' + path]; return f ? { data: f, error: null } : { data: null, error: { message: 'Object not found' } }; },
    async remove(paths) { paths.forEach(p => delete files[bucket + '/' + p]); return { data: [], error: null }; },
    async createSignedUrls(paths) { return { data: paths.map(p => ({ path: p, signedUrl: files[bucket + '/' + p] || bucket === 'plans' ? png() : png() })), error: null }; }
  }) };
  const auth = {
    async getSession() { return { data: { session }, error: null }; },
    async signInWithPassword({ email, password }) {
      const p = T.profiles.find(x => x.email === email);
      if (!p || password !== 'pw') return { data: null, error: { message: 'Invalid login credentials' } };
      me = p.id; session = { user: { id: p.id, email } }; return { data: { user: session.user, session }, error: null };
    },
    async signUp({ email, password, options }) {   // 申請帳號：照 19_申請帳號.sql，先停用、待開通
      if (T.profiles.some(x => x.email === email)) return { data: null, error: { message: 'User already registered' } };
      const id = 'u-' + Math.random().toString(36).slice(2); window.__signups = (window.__signups || 0) + 1;
      T.profiles.push({ id, name: (options && options.data && options.data.name) || email.split('@')[0], email, role: 'user', active: false, pending: true, created_at: new Date().toISOString() });
      return { data: { user: { id, email }, session: null }, error: null };
    },
    async signOut() { session = null; me = null; return { error: null }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
  };
  const fnCalls = [];   // functions.invoke 紀錄；__fnFail 設成訊息就模擬失敗
  const functions = { async invoke(name, opt) { fnCalls.push({ name, body: opt && opt.body, by: me });
    if (window.__fnFail) return { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: window.__fnFail }) } } };
    return { data: { fired: 1 }, error: null }; } };
  window.__mockSb = { from: builder, storage, auth, functions };
  window.__db = { T, files, fnCalls };
  window.supabase = { createClient: () => window.__mockSb };
})();
