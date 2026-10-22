"""驗屋報告轉檔排程用的小工具：跟系統（Supabase）拿工作、交結果。只用標準函式庫；有 Pillow 就順便把照片縮到 1280px。

環境變數：QC_BOT_EMAIL、QC_BOT_PASSWORD（系統裡的「AI轉檔」帳號，一般權限即可）
         QC_URL、QC_KEY（不給就讀 config.js 裡的公開設定）

用法：
  python3 tools/report_worker.py claim  WORKDIR        領一份待轉檔報告 → WORKDIR/report.pdf、job.json、lists.json；沒有工作時印 NO_JOB
  python3 tools/report_worker.py check  WORKDIR        檢查 WORKDIR/rows.json 與 WORKDIR/photos/（不上傳）
  python3 tools/report_worker.py submit WORKDIR        上傳照片、寫回結果，工作變「已轉好・待確認」
  python3 tools/report_worker.py fail   WORKDIR 原因   工作變「轉檔失敗」，原因會顯示給上傳的人
"""
import json, os, re, sys, io, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
H = ['棟別', '樓層', '戶別', '檢查類型', '空間', '工項', '缺失內容', '修繕方式', '修繕廠商', '責任廠商', '缺失說明', '照片', '報告編號', '對應備註']
STALE = timedelta(hours=2)          # 轉檔中超過 2 小時沒動靜，視為上次排程中斷，可以重領


def cfg():
    url, key = os.environ.get('QC_URL'), os.environ.get('QC_KEY')
    if not (url and key):
        s = open(os.path.join(ROOT, 'config.js'), encoding='utf-8').read()
        url = url or re.search(r'url:\s*"([^"]+)"', s).group(1)
        key = key or re.search(r'key:\s*"([^"]+)"', s).group(1)
    return url.rstrip('/'), key


class Api:
    def __init__(self):
        self.url, self.key = cfg()
        em, pw = os.environ.get('QC_BOT_EMAIL'), os.environ.get('QC_BOT_PASSWORD')
        if not (em and pw): sys.exit('缺 QC_BOT_EMAIL / QC_BOT_PASSWORD 環境變數')
        r = self.call('POST', '/auth/v1/token?grant_type=password', {'email': em, 'password': pw}, auth=False)
        self.token = r['access_token']

    def call(self, method, path, body=None, auth=True, headers=None, raw=False):
        h = {'apikey': self.key}
        if auth: h['Authorization'] = 'Bearer ' + self.token
        data = None
        if isinstance(body, (bytes, bytearray)): data = bytes(body)
        elif body is not None: data = json.dumps(body, ensure_ascii=False).encode(); h['Content-Type'] = 'application/json'
        h.update(headers or {})
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                b = res.read()
        except urllib.error.HTTPError as e:
            sys.exit(f'{method} {path} 失敗：{e.code} {e.read().decode(errors="replace")[:500]}')
        if raw: return b
        return json.loads(b) if b else None

    def rest(self, method, q, body=None, prefer='return=representation'):
        return self.call(method, '/rest/v1/' + q, body, headers={'Prefer': prefer})


def obj_path(p): return urllib.parse.quote(p, safe='/')


def lists_for(api, job):
    g = lambda t, q='select=*': api.rest('GET', f'{t}?{q}')
    act = lambda rows: sorted([r for r in rows if r.get('active', True) is not False], key=lambda r: (r.get('sort') or 0, str(r.get('name') or r.get('code'))))
    blds = act(g('buildings', f'select=*&site_id=eq.{job["site_id"]}'))
    units = act(g('units')); cats = act(g('categories')); items = act(g('items')); vendors = act(g('vendors'))
    cv = sorted(g('category_vendors'), key=lambda r: r.get('sort') or 0)
    vname = {v['id']: v['name'] for v in vendors}
    spaces = act(g('spaces'))
    try: us = g('unit_spaces', f'select=space_id&unit_id=eq.{job["unit_id"]}')
    except SystemExit: us = []
    # 專有戶／公設：只列這一戶所在區的棟別、空間別、檢查類型、工項、缺失內容（缺失內容各區一份）
    try: zones = sorted(g('zones'), key=lambda z: (z.get('sort') or 0, z['id']))
    except SystemExit: zones = []
    z0 = zones[0]['id'] if zones else None
    bz = lambda b: b.get('zone_id') or z0
    jb = next((b for b in blds if b['id'] == job.get('building_id')), None)
    zid = bz(jb) if (jb and zones) else None
    inz = lambda r: zid is None or not r.get('zone_ids') or zid in r['zone_ids']
    blds = [b for b in blds if zid is None or bz(b) == zid]
    spaces = [s for s in spaces if inz(s)]; cats = [c for c in cats if inz(c)]
    items = [i for i in items if zid is None or (i['zone_id'] == zid if i.get('zone_id') is not None else inz(i))]
    sname = {s['id']: s['name'] for s in spaces}
    uniq = lambda xs: list(dict.fromkeys(xs))
    return {
        'buildings': [{'name': b['name'], 'floors': b['floors'], 'units': [u['code'] for u in units if u['building_id'] == b['id']]} for b in blds],
        'spaces': uniq(s['name'] for s in spaces),
        'unit_spaces': uniq(sname[r['space_id']] for r in us if r['space_id'] in sname),   # 這一戶勾選的空間別（有設定時優先用）
        'cats': [{'name': c['name'], 'items': [i['name'] for i in items if i['category_id'] == c['id']],
                  'vendors': [vname[r['vendor_id']] for r in cv if r['category_id'] == c['id'] and r['vendor_id'] in vname] or None} for c in cats],
        'vendors': [v['name'] for v in vendors],
        'methods': [m['name'] for m in act(g('repair_methods'))],
        'types': [t['name'] for t in act(g('inspect_types')) if inz(t)],
    }


def claim(wd):
    api = Api(); os.makedirs(wd, exist_ok=True)
    try: jobs = api.rest('GET', 'report_jobs?select=*&status=eq.pending&order=urgent.desc,created_at.asc&limit=1')   # 管理員要求立即轉檔的先做
    except SystemExit: jobs = api.rest('GET', 'report_jobs?select=*&status=eq.pending&order=created_at.asc&limit=1')   # 還沒執行 11_立即轉檔.sql
    if not jobs:
        old = (datetime.now(timezone.utc) - STALE).isoformat()
        jobs = api.rest('GET', f'report_jobs?select=*&status=eq.processing&updated_at=lt.{urllib.parse.quote(old)}&order=created_at.asc&limit=1')
    if not jobs: print('NO_JOB'); return
    j = jobs[0]
    got = api.rest('PATCH', f'report_jobs?id=eq.{j["id"]}&status=eq.{j["status"]}', {'status': 'processing', 'message': None})
    if not got: print('NO_JOB（被別的排程領走了）'); return
    j = got[0]
    pdf = api.call('GET', '/storage/v1/object/authenticated/reports/' + obj_path(j['path']), raw=True)
    open(os.path.join(wd, 'report.pdf'), 'wb').write(pdf)
    names = lambda t, i, f='name': next((r[f] for r in api.rest('GET', f'{t}?select={f}&id=eq.{i}')), '') if i else ''
    j['_label'] = {'棟別': names('buildings', j['building_id']), '樓層': j['floor'] or '', '戶別': names('units', j['unit_id'], 'code'),
                   '檢查類型': names('inspect_types', j['inspect_type_id'])}
    json.dump(j, open(os.path.join(wd, 'job.json'), 'w'), ensure_ascii=False, indent=1)
    json.dump(lists_for(api, j), open(os.path.join(wd, 'lists.json'), 'w'), ensure_ascii=False)
    os.makedirs(os.path.join(wd, 'photos'), exist_ok=True)
    print(json.dumps({'job': j['id'], 'file': j['file_name'], 'vendor': j['vendor'], 'note': j['note'], **j['_label'], 'pdf_bytes': len(pdf)}, ensure_ascii=False))


def load_rows(wd):
    d = json.load(open(os.path.join(wd, 'rows.json'), encoding='utf-8'))
    rows, skip = (d['rows'], d.get('skip', [])) if isinstance(d, dict) else (d, [])
    rows = [{k: ('' if r.get(k) is None else str(r.get(k)).strip()) for k in H} for r in rows]
    return rows, skip, d.get('message', '') if isinstance(d, dict) else ''


def check(wd, quiet=False):
    rows, skip, _ = load_rows(wd); L = json.load(open(os.path.join(wd, 'lists.json'), encoding='utf-8'))
    job = json.load(open(os.path.join(wd, 'job.json'), encoding='utf-8'))
    cats = {c['name']: c for c in L['cats']}; errs, warns = [], []
    have = set(os.listdir(os.path.join(wd, 'photos')))
    for n, r in enumerate(rows, 1):
        tag = f'第 {n} 列（{r["報告編號"] or "無編號"}）'
        if r['檢查類型'] != job['_label']['檢查類型']: errs.append(f'{tag} 檢查類型「{r["檢查類型"]}」跟上傳時選的「{job["_label"]["檢查類型"]}」不同')
        if any(r[k] != job['_label'][k] for k in ['棟別', '樓層', '戶別']):   # 依報告改正戶別：要存在、要加註
            b = next((b for b in L['buildings'] if b['name'] == r['棟別']), None)
            if not b or r['樓層'] not in b['floors'] or r['戶別'] not in b['units']: errs.append(f'{tag} {r["棟別"]} {r["樓層"]} {r["戶別"]} 不在系統的棟別／樓層／戶別裡')
            elif '戶別依報告改為' not in r['對應備註']: errs.append(f'{tag} 戶別跟上傳時選的不同，「對應備註」要寫「戶別依報告改為…（上傳時選…）」')
            else: warns.append(f'{tag} 戶別依報告改為 {r["棟別"]} {r["樓層"]} {r["戶別"]}')
        if r['空間'] and r['空間'] not in L['spaces']: warns.append(f'{tag} 空間「{r["空間"]}」不在清單（預覽時會變黃色待補選）')
        c = cats.get(r['工項'])
        if r['工項'] and not c: warns.append(f'{tag} 工項「{r["工項"]}」不在清單')
        if c and r['缺失內容'] and r['缺失內容'] not in c['items']: warns.append(f'{tag} 缺失內容「{r["缺失內容"]}」不在「{r["工項"]}」底下')
        for k, lst in [('修繕方式', L['methods']), ('修繕廠商', L['vendors']), ('責任廠商', L['vendors'])]:
            if r[k] and r[k] not in lst: warns.append(f'{tag} {k}「{r[k]}」不在清單')
        if not (r['空間'] and r['工項'] and r['缺失內容']) and not r['對應備註']: warns.append(f'{tag} 有空白欄位，最好在「對應備註」寫原因')
        for p in [s.strip() for s in re.split(r'[、,，;；\n]+', r['照片']) if s.strip()]:
            if p not in have: errs.append(f'{tag} 照片 {p} 不在 photos/ 資料夾')
    if not rows and not skip: errs.append('rows.json 沒有任何資料')
    if not quiet or errs:
        print(f'{len(rows)} 列、略過 {len(skip)} 項、照片 {len(have)} 張')
        for e in errs: print('錯誤：' + e)
        for w in warns: print('提醒：' + w)
    return rows, skip, errs


def shrink(b):
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(b)); im = im.convert('RGB'); im.thumbnail((1280, 1280))
        o = io.BytesIO(); im.save(o, 'JPEG', quality=72); return o.getvalue()
    except Exception:
        return b


def submit(wd):
    rows, skip, errs = check(wd, quiet=True)
    if errs: sys.exit('有錯誤，先修好 rows.json 或照片再送')
    _, _, msg = load_rows(wd)
    api = Api(); job = json.load(open(os.path.join(wd, 'job.json'), encoding='utf-8'))
    d = job['path'].rsplit('/', 1)[0]
    used = {s.strip() for r in rows for s in re.split(r'[、,，;；\n]+', r['照片']) if s.strip()}
    for p in sorted(used):
        b = shrink(open(os.path.join(wd, 'photos', p), 'rb').read())
        api.call('POST', '/storage/v1/object/reports/' + obj_path(f'{d}/photos/{p}'), b, headers={'Content-Type': 'image/jpeg', 'x-upsert': 'true'})
    r = api.rest('PATCH', f'report_jobs?id=eq.{job["id"]}', {'status': 'done', 'result': {'rows': rows, 'skip': skip},
                 'message': msg or None, 'processed_at': datetime.now(timezone.utc).isoformat()})
    if not r: sys.exit('寫回失敗：找不到這份工作（可能被刪了）')
    print(f'完成：工作 {job["id"]}，{len(rows)} 列、照片 {len(used)} 張、略過 {len(skip)} 項')


def fail(wd, why):
    api = Api(); job = json.load(open(os.path.join(wd, 'job.json'), encoding='utf-8'))
    api.rest('PATCH', f'report_jobs?id=eq.{job["id"]}', {'status': 'error', 'message': why[:500], 'processed_at': datetime.now(timezone.utc).isoformat()})
    print(f'已標記失敗：工作 {job["id"]}')


if __name__ == '__main__':
    a = sys.argv[1:]
    if len(a) < 2 or a[0] not in ('claim', 'check', 'submit', 'fail'): sys.exit(__doc__)
    {'claim': lambda: claim(a[1]), 'check': lambda: check(a[1]), 'submit': lambda: submit(a[1]),
     'fail': lambda: fail(a[1], ' '.join(a[2:]) or '轉檔失敗')}[a[0]]()
