const ROLES = { admin: 'مدير كامل', creator: 'منشئ نماذج', reviewer: 'مراجع طلبات', viewer: 'مشاهد' };
const FIELD_TYPES = {
  text: 'نص قصير', textarea: 'نص طويل', number: 'رقم', email: 'بريد إلكتروني',
  url: 'رابط', tel: 'هاتف / وسيلة تواصل', date: 'تاريخ', select: 'قائمة اختيار', checkbox: 'مربع اختيار'
};
const STATUSES = { pending: 'قيد المراجعة', approved: 'مقبول', rejected: 'مرفوض' };
const MOD_STATUSES = { pending: 'بانتظار التنفيذ', applied: 'تم التنفيذ يدويًا', cancelled: 'ملغي', failed: 'تعذر التنفيذ' };
const DURATIONS = { '10m': '10 دقائق', '1h': 'ساعة', '6h': '6 ساعات', '24h': '24 ساعة', '7d': '7 أيام', '30d': '30 يومًا', permanent: 'دائم' };
const COOKIE_NAME = 'sog_session';
const SESSION_DAYS = 7;
let schemaReady = false;
let adminSeedChecked = false;

const SCHEMA = [
`CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
 display_name TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'viewer', active INTEGER NOT NULL DEFAULT 1,
 can_moderate INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS forms (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
 description TEXT NOT NULL DEFAULT '', is_public INTEGER NOT NULL DEFAULT 0,
 is_active INTEGER NOT NULL DEFAULT 1, owner_id INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS form_fields (
 id INTEGER PRIMARY KEY AUTOINCREMENT, form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
 field_key TEXT NOT NULL, label TEXT NOT NULL, field_type TEXT NOT NULL DEFAULT 'text',
 required INTEGER NOT NULL DEFAULT 0, options TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0,
 is_active INTEGER NOT NULL DEFAULT 1, UNIQUE(form_id, field_key)
)`,
`CREATE TABLE IF NOT EXISTS form_permissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE, can_read INTEGER NOT NULL DEFAULT 0,
 can_results INTEGER NOT NULL DEFAULT 0, can_edit INTEGER NOT NULL DEFAULT 0, can_manage INTEGER NOT NULL DEFAULT 0,
 UNIQUE(user_id, form_id)
)`,
`CREATE TABLE IF NOT EXISTS submissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
 data_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', review_note TEXT NOT NULL DEFAULT '',
 submitted_at TEXT NOT NULL, reviewed_by INTEGER REFERENCES users(id), reviewed_at TEXT
)`,
`CREATE TABLE IF NOT EXISTS audit_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
 entity_type TEXT NOT NULL DEFAULT '', entity_id TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS moderation_actions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, action_type TEXT NOT NULL, player_uid TEXT NOT NULL,
 player_name TEXT NOT NULL DEFAULT '', server TEXT NOT NULL, duration TEXT NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', result_note TEXT NOT NULL DEFAULT '', created_by INTEGER NOT NULL REFERENCES users(id),
 updated_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`,
`CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
 csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
)`,
'CREATE INDEX IF NOT EXISTS ix_forms_public_active ON forms(is_public,is_active)',
'CREATE INDEX IF NOT EXISTS ix_form_fields_position ON form_fields(form_id,position)',
'CREATE INDEX IF NOT EXISTS ix_submissions_form_date ON submissions(form_id,submitted_at)',
'CREATE INDEX IF NOT EXISTS ix_audit_date ON audit_log(created_at)',
'CREATE INDEX IF NOT EXISTS ix_moderation_date ON moderation_actions(created_at)',
'CREATE INDEX IF NOT EXISTS ix_sessions_expiry ON sessions(expires_at)'
];

const CSS = `
:root{font-family:Tahoma,Arial,sans-serif;color:#e8edf3;background:#0c1117;color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at top,#182735 0,#0c1117 48%)}a{color:#8dc9ff;text-decoration:none}a:hover{text-decoration:underline}.wrap{width:min(1180px,calc(100% - 32px));margin:auto}.top{border-bottom:1px solid #263747;background:#0a0f14ef}.nav{min-height:76px;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{font-size:20px;font-weight:800;color:#f4f8fb}.links{display:flex;gap:15px;align-items:center;flex-wrap:wrap}.links a{font-size:14px}.main{padding:30px 0 72px}.hero{padding:46px 0 28px}.eyebrow{color:#8dc9ff;font-size:12px;letter-spacing:1.5px;text-transform:uppercase}.hero h1{font-size:clamp(30px,5vw,46px);margin:10px 0}.hero p,.muted{color:#9daab8;line-height:1.8}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(265px,1fr));gap:16px}.card,.panel{border:1px solid #293744;background:#131b23;border-radius:16px;padding:22px;box-shadow:0 10px 30px #0002}.card h2,.panel h2{margin:0 0 12px;font-size:20px}.card p{color:#9daab8;line-height:1.7}.row{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:17px}.primary,.button,.danger,.secondary{font:inherit;font-size:14px;border:1px solid transparent;border-radius:9px;padding:10px 15px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;text-decoration:none}.primary,.button{background:#8dc9ff;color:#09121a;font-weight:700}.secondary{background:#1e2c38;color:#e6edf4;border-color:#354756}.danger{background:#51252b;color:#ffdce0;border-color:#75363e}.field{display:flex;flex-direction:column;gap:8px;margin:15px 0}.field span{font-size:14px;font-weight:700;color:#d9e2eb}.field input,.field textarea,.field select,.search{width:100%;background:#0c131a;color:#e8edf3;border:1px solid #344657;border-radius:9px;padding:12px;font:inherit;outline:none}.field input:focus,.field textarea:focus,.field select:focus,.search:focus{border-color:#8dc9ff}.field textarea{resize:vertical}.checkbox{display:flex;align-items:center;gap:9px;margin:14px 0;color:#d9e2eb}.checkbox input{width:17px;height:17px}.hint{display:block;color:#8291a0;margin-top:3px}.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:0 16px}.panel{margin:18px 0}.table-wrap{overflow:auto;border:1px solid #293744;border-radius:12px;background:#111820}table{border-collapse:collapse;width:100%;min-width:780px}th,td{text-align:right;vertical-align:top;padding:12px;border-bottom:1px solid #293744;font-size:13px}th{background:#18232d;color:#c9d7e3;white-space:nowrap}td{color:#d8e1e9;line-height:1.6}.pill{display:inline-block;padding:4px 9px;border-radius:20px;font-size:12px;background:#23323f;color:#bddcf1}.alert{border:1px solid #344657;border-radius:10px;padding:13px 15px;margin:12px 0;background:#17212a}.alert.error{border-color:#77434a;background:#301d22}.alert.success{border-color:#315e49;background:#182b22}.alert.warning{border-color:#7d6232;background:#302817}.empty{padding:34px;text-align:center;color:#91a0ae;border:1px dashed #344657;border-radius:14px}.small{font-size:12px;color:#94a4b3}.footer{border-top:1px solid #22313e;padding:22px 0;color:#718291;font-size:12px}.page-title{margin:0 0 7px;font-size:30px}.status-select{min-width:140px;padding:8px;border-radius:8px;background:#0c131a;color:#e8edf3;border:1px solid #344657}.field-row{padding:15px 0;border-bottom:1px solid #293744}.field-row:last-child{border-bottom:0}.inline-form{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.inline-form .search{max-width:220px}@media(max-width:680px){.nav{align-items:flex-start;flex-direction:column;padding:16px 0}.links{gap:10px}.main{padding-top:20px}}
`;

const now = () => new Date().toISOString();
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const escAttr = escapeHtml;
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const randomToken = (length=32) => { const data = new Uint8Array(length); crypto.getRandomValues(data); return b64url(data); };
async function sha256(text) { const data = new TextEncoder().encode(text); return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', data))); }
async function hashPassword(password, salt=randomToken(16), iterations=210000) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', salt:enc.encode(salt), iterations, hash:'SHA-256'}, key, 256);
  return `pbkdf2_sha256$${iterations}$${salt}$${b64url(new Uint8Array(bits))}`;
}
async function verifyPassword(password, stored) {
  try {
    const [scheme, iterText, salt, expected] = stored.split('$');
    if (scheme !== 'pbkdf2_sha256') return false;
    const actual = (await hashPassword(password, salt, Number(iterText))).split('$')[3];
    if (actual.length !== expected.length) return false;
    let diff = 0; for (let i=0;i<actual.length;i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
}
async function all(env, sql, ...params) { let q=env.DB.prepare(sql); if(params.length) q=q.bind(...params); const r=await q.all(); return r.results || []; }
async function one(env, sql, ...params) { let q=env.DB.prepare(sql); if(params.length) q=q.bind(...params); return await q.first(); }
async function run(env, sql, ...params) { let q=env.DB.prepare(sql); if(params.length) q=q.bind(...params); return await q.run(); }
async function ensureSchema(env) { if(schemaReady) return; for(const sql of SCHEMA) await run(env,sql); schemaReady=true; }
async function seedAdmin(env) {
  if(adminSeedChecked) return;
  const first = await one(env,'SELECT id FROM users LIMIT 1');
  if(first) { adminSeedChecked=true; return; }
  const password = String(env.ADMIN_PASSWORD || '');
  if(password.length < 12) return;
  const username = String(env.ADMIN_USERNAME || 'admin').trim() || 'admin';
  const passwordHash = await hashPassword(password);
  await run(env,'INSERT OR IGNORE INTO users(username,display_name,password_hash,role,active,can_moderate,created_at) VALUES(?,?,?,?,?,?,?)',username,'مدير النظام',passwordHash,'admin',1,1,now());
  adminSeedChecked=true;
}
function cookieValue(request, name) {
  const header = request.headers.get('Cookie') || '';
  for(const part of header.split(';')) { const i=part.indexOf('='); if(i>=0 && part.slice(0,i).trim()===name) return decodeURIComponent(part.slice(i+1).trim()); }
  return '';
}
function sessionCookie(token) { return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_DAYS*86400}; HttpOnly; Secure; SameSite=Lax`; }
function clearCookie() { return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`; }
async function createSession(env, userId=null) {
  const token=randomToken(32), tokenHash=await sha256(token), csrf=randomToken(24), created=now();
  const expires=new Date(Date.now()+SESSION_DAYS*86400000).toISOString();
  await run(env,'INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)',tokenHash,userId,csrf,expires,created);
  return {token,tokenHash,csrf,userId,expires,setCookie:true,user:null};
}
async function getSession(request, env) {
  const raw=cookieValue(request,COOKIE_NAME);
  if(raw) {
    const hash=await sha256(raw);
    const stored=await one(env,'SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',hash,now());
    if(stored) {
      let user=null;
      if(stored.user_id) user=await one(env,'SELECT id,username,display_name,role,active,can_moderate,created_at FROM users WHERE id=?',stored.user_id);
      if(user && !user.active) user=null;
      if(!stored.user_id || user) return {token:raw,tokenHash:hash,csrf:stored.csrf_token,userId:stored.user_id,user,setCookie:false};
      await run(env,'DELETE FROM sessions WHERE token_hash=?',hash);
    }
  }
  const s=await createSession(env,null);
  return s;
}
function addCookie(response, session) {
  if(!session?.setCookie) return response;
  const headers=new Headers(response.headers); headers.append('Set-Cookie',sessionCookie(session.token));
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
function hiddenCsrf(s) { return `<input type="hidden" name="_csrf" value="${escAttr(s.csrf)}">`; }
function formOpen(action,s,method='post',cls='') { return `<form method="${method}" action="${escAttr(action)}" class="${escAttr(cls)}">${method.toLowerCase()==='post'?hiddenCsrf(s):''}`; }
function btn(label,cls='primary',type='submit') { return `<button type="${type}" class="${cls}">${escapeHtml(label)}</button>`; }
function field(label,name,value='',type='text',required=false,help='') { return `<label class="field"><span>${escapeHtml(label)}${required?' <b>*</b>':''}</span><input name="${escAttr(name)}" type="${escAttr(type)}" value="${escAttr(value)}"${required?' required':''}>${help?`<small class="hint">${escapeHtml(help)}</small>`:''}</label>`; }
function textarea(label,name,value='',required=false,rows=4) { return `<label class="field"><span>${escapeHtml(label)}${required?' <b>*</b>':''}</span><textarea name="${escAttr(name)}" rows="${rows}"${required?' required':''}>${escapeHtml(value)}</textarea></label>`; }
function checkbox(label,name,checked=false) { return `<label class="checkbox"><input type="checkbox" name="${escAttr(name)}"${checked?' checked':''}><span>${escapeHtml(label)}</span></label>`; }
function select(label,name,options,selected='',required=false) { return `<label class="field"><span>${escapeHtml(label)}${required?' <b>*</b>':''}</span><select name="${escAttr(name)}"${required?' required':''}>${options.map(([v,l])=>`<option value="${escAttr(v)}"${String(v)===String(selected)?' selected':''}>${escapeHtml(l)}</option>`).join('')}</select></label>`; }
function yes(form,key) { return ['on','true','1','yes'].includes(form.get(key)); }
function slugify(value) { return String(value||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90) || `form-${randomToken(4)}`; }
function redirect(path,status=303) { return Response.redirect(new URL(path, 'https://internal.local').href, status); }
function redirectLocal(path,status=303) { return new Response(null,{status,headers:{Location:path,'Cache-Control':'no-store'}}); }
function page(request,title,body,user,session,status=200) {
  const u=new URL(request.url); const msg=u.searchParams.get('msg'); const type=u.searchParams.get('type')||'success';
  const notice=msg?`<div class="alert ${['success','error','warning'].includes(type)?type:''}">${escapeHtml(msg)}</div>`:'';
  const links=['<a href="/">الرئيسية</a>'];
  if(user) {
    links.push('<a href="/dashboard">لوحة التحكم</a>');
    if(user.role==='admin') links.push('<a href="/admin/users">المستخدمون والصلاحيات</a>','<a href="/admin/audit">سجل النشاط</a>');
    if(user.role==='admin'||user.can_moderate) links.push('<a href="/moderation">سجل الحظر</a>');
    links.push(`${formOpen('/logout',session)}<button class="secondary" type="submit">خروج</button></form>`);
  } else links.push('<a href="/login">دخول الإدارة</a>');
  const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(title)} · سيوف المجد</title><style>${CSS}</style></head><body><header class="top"><div class="wrap nav"><a class="brand" href="/">⚔️ بوابة سيوف المجد</a><nav class="links">${links.join('')}</nav></div></header><main class="wrap main">${notice}${body}</main><footer class="footer"><div class="wrap">بوابة النماذج والإدارة المجتمعية · Cloudflare Workers + D1</div></footer></body></html>`;
  return new Response(html,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','x-frame-options':'DENY'}});
}
function redirectMessage(path,msg,type='success') { return redirectLocal(`${path}${path.includes('?')?'&':'?'}msg=${encodeURIComponent(msg)}&type=${encodeURIComponent(type)}`); }
async function audit(env, session, action, entityType='', entityId='', details='') {
  await run(env,'INSERT INTO audit_log(user_id,action,entity_type,entity_id,details,created_at) VALUES(?,?,?,?,?,?)',session.user?.id||null,action,entityType,String(entityId),String(details).slice(0,2000),now());
}
async function permission(env,user,formId) {
  if(!user) return null;
  if(user.role==='admin') return {can_read:1,can_results:1,can_edit:1,can_manage:1};
  return await one(env,'SELECT * FROM form_permissions WHERE user_id=? AND form_id=?',user.id,formId);
}
async function hasPerm(env,user,formId,action) {
  if(!user) return false;
  if(user.role==='admin') return true;
  const p=await permission(env,user,formId); if(!p) return false;
  if(action==='read') return !!(p.can_read||p.can_results||p.can_edit||p.can_manage);
  return !!(p.can_manage||p[`can_${action}`]);
}
async function fieldsFor(env,formId,activeOnly=true) { return await all(env,`SELECT * FROM form_fields WHERE form_id=?${activeOnly?' AND is_active=1':''} ORDER BY position,id`,formId); }
function statusLabel(status) { return STATUSES[status]||status; }
function table(headers,rows,empty='لا توجد بيانات.') { return `<div class="table-wrap"><table><thead><tr>${headers.map(x=>`<th>${escapeHtml(x)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td colspan="${headers.length}">${escapeHtml(empty)}</td></tr>`}</tbody></table></div>`; }

async function dispatch(request,env,session) {
  const user=session.user;
  const url=new URL(request.url), path=url.pathname, method=request.method.toUpperCase();
  const respond=(title,body,status=200)=>page(request,title,body,user,session,status);
  if(method==='POST') {
    const supplied=new URLSearchParams(await request.clone().text()).get('_csrf')||'';
    if(!supplied||supplied!==session.csrf) return respond('طلب غير صالح','<section class="panel"><h1>انتهت صلاحية النموذج</h1><p>حدّث الصفحة ثم حاول مرة أخرى.</p><a class="button" href="/">الرئيسية</a></section>',400);
  }
  if(path==='/healthz'&&method==='GET') {
    const row=await one(env,'SELECT COUNT(*) AS n FROM users');
    return respond('فحص الحالة',`<section class="panel"><h1>التطبيق يعمل</h1><p>قاعدة البيانات: <span class="pill">D1 متصلة</span></p><p class="muted">عدد الحسابات: ${row?.n||0}</p></section>`);
  }
  if(path==='/'&&method==='GET') {
    const forms=await all(env,'SELECT id,name,slug,description FROM forms WHERE is_public=1 AND is_active=1 ORDER BY created_at DESC');
    const cards=forms.map(f=>`<a class="card" href="/apply/${encodeURIComponent(f.slug)}"><h2>${escapeHtml(f.name)}</h2><p>${escapeHtml(f.description)}</p><span>فتح النموذج ←</span></a>`).join('')||'<div class="empty">لا توجد نماذج مفتوحة حاليًا.</div>';
    return respond('النماذج المفتوحة',`<section class="hero"><span class="eyebrow">SWORDS OF GLORY · COMMUNITY</span><h1>بوابة النماذج المجتمعية</h1><p>تقديم الطلبات وإدارة النماذج ومراجعة النتائج في مكان واحد.</p></section><section class="cards">${cards}</section>`);
  }
  if(path==='/login'&&method==='GET') {
    const setup=await one(env,'SELECT id FROM users LIMIT 1');
    const setupNote=setup?'':'<div class="alert warning">لم يتم إنشاء المدير الأول. تأكد من إضافة Secret باسم ADMIN_PASSWORD بطول 12 حرفًا على الأقل، ثم أعد النشر.</div>';
    return respond('دخول الإدارة',`<section class="panel" style="max-width:520px;margin:30px auto"><h1>دخول الإدارة</h1><p class="muted">هذه المنطقة لفريق الإدارة فقط.</p>${setupNote}${formOpen('/login',session)}${field('اسم المستخدم','username','', 'text',true)}${field('كلمة المرور','password','', 'password',true)}${btn('دخول')}</form></section>`);
  }
  if(path==='/login'&&method==='POST') {
    const body=new URLSearchParams(await request.clone().text());
    const username=(body.get('username')||'').trim(), password=body.get('password')||'';
    const target=await one(env,'SELECT * FROM users WHERE username=?',username);
    if(!target||!target.active||!(await verifyPassword(password,target.password_hash))) return redirectMessage('/login','بيانات الدخول غير صحيحة أو الحساب موقوف.','error');
    await run(env,'DELETE FROM sessions WHERE token_hash=?',session.tokenHash);
    const nextSession=await createSession(env,target.id);
    session.token=nextSession.token; session.tokenHash=nextSession.tokenHash; session.csrf=nextSession.csrf; session.userId=target.id; session.user={id:target.id,username:target.username,display_name:target.display_name,role:target.role,active:target.active,can_moderate:target.can_moderate}; session.setCookie=true;
    await audit(env,session,'auth.login','user',target.id,'Successful login');
    let next=url.searchParams.get('next')||'/dashboard'; if(!next.startsWith('/')||next.startsWith('//')) next='/dashboard';
    return redirectMessage(next,'تم تسجيل الدخول.');
  }
  if(path==='/logout'&&method==='POST') {
    await run(env,'DELETE FROM sessions WHERE token_hash=?',session.tokenHash);
    const anon=await createSession(env,null);
    session.token=anon.token;session.tokenHash=anon.tokenHash;session.csrf=anon.csrf;session.userId=null;session.user=null;session.setCookie=true;
    return redirectMessage('/','تم تسجيل الخروج.');
  }
  if(path==='/dashboard'&&method==='GET') {
    if(!user) return redirectLocal('/login?next=%2Fdashboard');
    let forms;
    if(user.role==='admin') forms=await all(env,'SELECT * FROM forms ORDER BY created_at DESC');
    else forms=await all(env,`SELECT DISTINCT f.* FROM forms f LEFT JOIN form_permissions p ON p.form_id=f.id AND p.user_id=? WHERE f.owner_id=? OR p.can_read=1 OR p.can_results=1 OR p.can_edit=1 OR p.can_manage=1 ORDER BY f.created_at DESC`,user.id,user.id);
    const cards=[];
    for(const f of forms){const p=await permission(env,user,f.id)||{};const links=[];
      if(user.role==='admin'||p.can_edit||p.can_manage) links.push(`<a class="button" href="/admin/forms/${f.id}/edit">إعدادات وحقول</a>`);
      if(user.role==='admin'||p.can_results||p.can_manage) links.push(`<a class="secondary" href="/admin/forms/${f.id}/results">النتائج</a>`);
      if(f.is_public&&f.is_active) links.push(`<a class="secondary" target="_blank" rel="noreferrer" href="/apply/${encodeURIComponent(f.slug)}">فتح النموذج</a>`);
      cards.push(`<article class="card"><div class="row"><h2>${escapeHtml(f.name)}</h2><span class="pill">${f.is_active?'نشط':'متوقف'}</span></div><p>${escapeHtml(f.description)}</p><div class="row"><span class="small">/${escapeHtml(f.slug)}</span><span class="pill">${f.is_public?'عام':'غير منشور'}</span></div><div class="actions">${links.join('')}</div></article>`);
    }
    const create=['admin','creator'].includes(user.role)?'<a class="button" href="/admin/forms/new">+ إنشاء نموذج</a>':'';
    return respond('لوحة التحكم',`<section class="row"><div><h1 class="page-title">لوحة التحكم</h1><p class="muted">أهلًا ${escapeHtml(user.display_name||user.username)} — دورك: ${escapeHtml(ROLES[user.role]||user.role)}</p></div>${create}</section><section class="cards">${cards.join('')||'<div class="empty">لا توجد نماذج لديك صلاحية الوصول إليها حاليًا.</div>'}</section>`);
  }
  if(path==='/admin/forms/new'&&method==='GET') {
    if(!user||!['admin','creator'].includes(user.role)) return respond('غير مسموح','<section class="panel"><h1>ليست لديك الصلاحية.</h1></section>',403);
    return respond('إنشاء نموذج',`<section class="panel"><h1>إنشاء نموذج جديد</h1><p class="muted">النموذج سيبدأ فارغًا؛ أضف بنفسك الحقول التي تريدها.</p>${formOpen('/admin/forms/new',session)}${field('اسم النموذج','name','', 'text',true)}${field('الرابط المختصر بالإنجليزية','slug','', 'text',false,'مثال: chat-moderator. اتركه فارغًا لإنشائه من الاسم.')}${textarea('الوصف','description')}${checkbox('نشر النموذج للعامة','is_public',false)}${checkbox('تفعيل النموذج','is_active',true)}${btn('إنشاء النموذج')}</form></section>`);
  }
  if(path==='/admin/forms/new'&&method==='POST') {
    if(!user||!['admin','creator'].includes(user.role)) return respond('غير مسموح','<section class="panel"><h1>ليست لديك الصلاحية.</h1></section>',403);
    const body=new URLSearchParams(await request.clone().text());
    const name=(body.get('name')||'').trim().slice(0,180), slug=slugify(body.get('slug')||body.get('name')), desc=(body.get('description')||'').trim().slice(0,3000);
    if(!name) return redirectMessage('/admin/forms/new','اسم النموذج مطلوب.','error');
    if(await one(env,'SELECT id FROM forms WHERE slug=?',slug)) return redirectMessage('/admin/forms/new','الرابط المختصر مستخدم بالفعل.','error');
    const stamp=now();
    await run(env,'INSERT INTO forms(name,slug,description,is_public,is_active,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',name,slug,desc,body.has('is_public')?1:0,body.has('is_active')?1:0,user.id,stamp,stamp);
    const form=await one(env,'SELECT id FROM forms WHERE slug=?',slug);
    if(user.role!=='admin') await run(env,'INSERT OR IGNORE INTO form_permissions(user_id,form_id,can_read,can_results,can_edit,can_manage) VALUES(?,?,?,?,?,?)',user.id,form.id,1,1,1,1);
    await audit(env,session,'form.created','form',form.id,`Created ${slug}`);
    return redirectMessage(`/admin/forms/${form.id}/edit`,'تم إنشاء النموذج الفارغ. أضف الحقول التي تريدها.');
  }
  let m=path.match(/^\/admin\/forms\/(\d+)\/edit$/);
  if(m&&method==='GET') {
    if(!user) return redirectLocal('/login'); const id=Number(m[1]); if(!(await hasPerm(env,user,id,'edit'))) return respond('غير مسموح','<section class="panel"><h1>ليست لديك الصلاحية.</h1></section>',403);
    const f=await one(env,'SELECT * FROM forms WHERE id=?',id); if(!f) return respond('غير موجود','<section class="panel"><h1>النموذج غير موجود.</h1></section>',404);
    const fields=await fieldsFor(env,id,false); const fieldCards=fields.map(x=>`<div class="field-row"><div class="row"><strong>${escapeHtml(x.label)}</strong><span class="pill">${escapeHtml(FIELD_TYPES[x.field_type]||x.field_type)}</span></div>${formOpen(`/admin/forms/${id}/field/${x.id}/save`,session,'post','form-grid')}${field('عنوان الحقل','label',x.label,'text',true)}${field('المعرّف الداخلي','field_key',x.field_key,'text',true)}${select('نوع الحقل','field_type',Object.entries(FIELD_TYPES),x.field_type)}${field('الترتيب','position',x.position,'number',true)}${textarea('خيارات القائمة (كل خيار في سطر)','options',x.options||'',false,2)}${checkbox('حقل إجباري','required',!!x.required)}${checkbox('حقل نشط','is_active',!!x.is_active)}<div class="actions">${btn('حفظ الحقل')}</div></form>${formOpen(`/admin/forms/${id}/field/${x.id}/delete`,session)}${btn('حذف الحقل','danger')}</form></div>`).join('')||'<div class="empty">هذا النموذج فارغ. أضف أول حقل من النموذج التالي.</div>';
    return respond('إعداد النموذج',`<section class="panel"><div class="row"><div><h1 class="page-title">إعداد النموذج</h1><p class="muted">أضف الخانات التي تحتاجها فقط؛ لا توجد حقول مفروضة.</p></div><a class="secondary" href="/dashboard">العودة للوحة</a></div>${formOpen(`/admin/forms/${id}/edit`,session)}${field('اسم النموذج','name',f.name,'text',true)}${field('الرابط المختصر','slug',f.slug,'text',true)}${textarea('الوصف','description',f.description)}${checkbox('نشر للعامة','is_public',!!f.is_public)}${checkbox('النموذج نشط','is_active',!!f.is_active)}${btn('حفظ الإعدادات')}</form></section><section class="panel"><h2>الحقول الحالية (${fields.length})</h2>${fieldCards}</section><section class="panel"><h2>إضافة حقل جديد</h2>${formOpen(`/admin/forms/${id}/field/add`,session)}${field('عنوان الحقل','label','','text',true)}${field('المعرّف الداخلي بالإنجليزية','field_key','','text',true,'مثال: player_uid — حروف وأرقام وشرطة سفلية فقط.')}${select('نوع الحقل','field_type',Object.entries(FIELD_TYPES),'text')}${textarea('خيارات القائمة (كل خيار في سطر)','options','',false,3)}${checkbox('حقل إجباري','required',false)}${btn('إضافة الحقل')}</form></section><section class="panel"><h2>رابط النموذج</h2><p><code>/apply/${escapeHtml(f.slug)}</code></p><p class="muted">الرابط العام يعمل فقط إذا كان النموذج نشطًا ومنشورًا للعامة.</p></section>`);
  }
  if(m&&method==='POST') {
    if(!user) return redirectLocal('/login'); const id=Number(m[1]); if(!(await hasPerm(env,user,id,'edit'))) return respond('غير مسموح','<section class="panel"><h1>ليست لديك الصلاحية.</h1></section>',403);
    const body=new URLSearchParams(await request.clone().text()), name=(body.get('name')||'').trim().slice(0,180), slug=slugify(body.get('slug')||body.get('name')), desc=(body.get('description')||'').trim().slice(0,3000);
    if(!name||await one(env,'SELECT id FROM forms WHERE slug=? AND id<>?',slug,id)) return redirectMessage(`/admin/forms/${id}/edit`,'تأكد من الاسم والرابط المختصر غير المكرر.','error');
    await run(env,'UPDATE forms SET name=?,slug=?,description=?,is_public=?,is_active=?,updated_at=? WHERE id=?',name,slug,desc,body.has('is_public')?1:0,body.has('is_active')?1:0,now(),id);
    await audit(env,session,'form.updated','form',id,`Updated ${slug}`); return redirectMessage(`/admin/forms/${id}/edit`,'تم حفظ إعدادات النموذج.');
  }
  m=path.match(/^\/admin\/forms\/(\d+)\/field\/add$/);
  if(m&&method==='POST') {
    const id=Number(m[1]); if(!user||!(await hasPerm(env,user,id,'edit'))) return respond('غير مسموح','<section class="panel"><h1>ليست لديك الصلاحية.</h1></section>',403);
    const body=new URLSearchParams(await request.clone().text()), label=(body.get('label')||'').trim().slice(0,180), key=(body.get('field_key')||'').trim().toLowerCase(), typ=body.get('field_type')||'text';
    if(!label||!/^[a-z][a-z0-9_]{1,79}$/.test(key)||!FIELD_TYPES[typ]) return redirectMessage(`/admin/forms/${id}/edit`,'عنوان الحقل مطلوب والمُعرّف يجب أن يكون إنجليزيًا صالحًا.','error');
    if(await one(env,'SELECT id FROM form_fields WHERE form_id=? AND field_key=?',id,key)) return redirectMessage(`/admin/forms/${id}/edit`,'المُعرّف مستخدم بالفعل في هذا النموذج.','error');
    const p=await one(env,'SELECT COALESCE(MAX(position),-1)+1 AS n FROM form_fields WHERE form_id=?',id);
    await run(env,'INSERT INTO form_fields(form_id,field_key,label,field_type,required,options,position,is_active) VALUES(?,?,?,?,?,?,?,1)',id,key,label,typ,body.has('required')?1:0,(body.get('options')||'').slice(0,3000),p.n);
    await audit(env,session,'field.created','form',id,`Created field ${key}`); return redirectMessage(`/admin/forms/${id}/edit`,'تمت إضافة الحقل.');
  }
  m=path.match(/^\/admin\/forms\/(\d+)\/field\/(\d+)\/(save|delete)$/);
  if(m&&method==='POST') {
    const id=Number(m[1]), fid=Number(m[2]), action=m[3]; if(!user||!(await hasPerm(env,user,id,'edit'))) return respond('غير مسموح','<section class="panel"><h1>ليست لديك الصلاحية.</h1></section>',403);
    const fieldRow=await one(env,'SELECT * FROM form_fields WHERE id=? AND form_id=?',fid,id); if(!fieldRow) return respond('غير موجود','<section class="panel"><h1>الحقل غير موجود.</h1></section>',404);
    if(action==='delete') { await run(env,'DELETE FROM form_fields WHERE id=? AND form_id=?',fid,id); await audit(env,session,'field.deleted','form',id,`Deleted field ${fid}`); return redirectMessage(`/admin/forms/${id}/edit`,'تم حذف الحقل؛ الطلبات السابقة تحتفظ بالقيم المحفوظة.'); }
    const body=new URLSearchParams(await request.clone().text()), label=(body.get('label')||'').trim().slice(0,180), key=(body.get('field_key')||'').trim().toLowerCase(), typ=body.get('field_type')||'text', pos=Math.max(0,Math.min(10000,Number(body.get('position')||0)));
    if(!label||!/^[a-z][a-z0-9_]{1,79}$/.test(key)||!FIELD_TYPES[typ]||await one(env,'SELECT id FROM form_fields WHERE form_id=? AND field_key=? AND id<>?',id,key,fid)) return redirectMessage(`/admin/forms/${id}/edit`,'راجع عنوان الحقل والمُعرّف والنوع.','error');
    await run(env,'UPDATE form_fields SET label=?,field_key=?,field_type=?,required=?,options=?,position=?,is_active=? WHERE id=? AND form_id=?',label,key,typ,body.has('required')?1:0,(body.get('options')||'').slice(0,3000),Number.isFinite(pos)?pos:0,body.has('is_active')?1:0,fid,id);
    await audit(env,session,'field.updated','form',id,`Updated field ${key}`); return redirectMessage(`/admin/forms/${id}/edit`,'تم حفظ الحقل.');
  }
  m=path.match(/^\/apply\/([^/]+)$/);
  if(m&&(method==='GET'||method==='POST')) {
    let slug; try{slug=decodeURIComponent(m[1]);}catch{slug=m[1];}
    const f=await one(env,'SELECT * FROM forms WHERE slug=? AND is_public=1 AND is_active=1',slug); if(!f) return respond('غير موجود','<section class="panel"><h1>النموذج غير موجود أو غير منشور.</h1></section>',404);
    const fields=await fieldsFor(env,f.id,true);
    if(method==='POST') {
      const body=new URLSearchParams(await request.clone().text()), data={}, errors=[];
      for(const x of fields) {
        let val=body.get(x.field_key)||''; if(x.field_type==='checkbox') val=body.has(x.field_key)?'yes':''; val=val.trim();
        if(x.required&&!val) errors.push(`الحقل «${x.label}» مطلوب.`);
        if(x.field_type==='select'&&val&&!x.options.split(/\r?\n/).map(o=>o.trim()).includes(val)) errors.push(`اختيار غير صالح في «${x.label}».`);
        if(val.length>4000) errors.push(`قيمة الحقل «${x.label}» أطول من المسموح.`);
        data[x.field_key]={label:x.label,value:val};
      }
      if(!fields.length) errors.push('النموذج لم يتم إعداده بعد.');
      if(errors.length) return respond(f.name,`<section class="panel"><div class="alert error">${errors.map(escapeHtml).join('<br>')}</div><a class="button" href="/apply/${encodeURIComponent(slug)}">الرجوع للنموذج</a></section>`);
      await run(env,'INSERT INTO submissions(form_id,data_json,status,review_note,submitted_at) VALUES(?,?,?,?,?)',f.id,JSON.stringify(data),'pending','',now());
      return respond('تم الاستلام',`<section class="panel"><h1>تم استلام طلبك بنجاح ✓</h1><p class="muted">شكرًا لتقديمك على «${escapeHtml(f.name)}». ستتم مراجعة الطلب من فريق الإدارة.</p><a class="button" href="/">العودة للرئيسية</a></section>`);
    }
    const controls=fields.map(x=>{const label=escapeHtml(x.label), key=escAttr(x.field_key), req=x.required?' required':'', star=x.required?' <b>*</b>':'';
      if(x.field_type==='textarea') return `<label class="field"><span>${label}${star}</span><textarea name="${key}" rows="4"${req}></textarea></label>`;
      if(x.field_type==='select') return `<label class="field"><span>${label}${star}</span><select name="${key}"${req}><option value="">اختر...</option>${x.options.split(/\r?\n/).map(o=>o.trim()).filter(Boolean).map(o=>`<option value="${escAttr(o)}">${escapeHtml(o)}</option>`).join('')}</select></label>`;
      if(x.field_type==='checkbox') return `<label class="checkbox"><input type="checkbox" name="${key}"${req}><span>${label}${star}</span></label>`;
      const typ=['text','number','email','url','tel','date'].includes(x.field_type)?x.field_type:'text';
      return `<label class="field"><span>${label}${star}</span><input type="${typ}" name="${key}"${req}></label>`;
    }).join('');
    return respond(f.name,`<section class="panel"><span class="eyebrow">نموذج عام</span><h1 class="page-title">${escapeHtml(f.name)}</h1><p class="muted">${escapeHtml(f.description)}</p>${formOpen(`/apply/${encodeURIComponent(slug)}`,session)}${controls||'<div class="empty">النموذج منشور لكنه فارغ؛ أضف حقوله من لوحة التحكم أولًا.</div>'}${controls?btn('إرسال الطلب'):''}</form></section>`);
  }
  m=path.match(/^\/admin\/forms\/(\d+)\/results$/);
  if(m&&method==='GET') {
    const id=Number(m[1]); if(!user||!(await hasPerm(env,user,id,'results'))) return respond('غير مسموح','<section class="panel"><h1>ليست لديك صلاحية مشاهدة النتائج.</h1></section>',403);
    const f=await one(env,'SELECT * FROM forms WHERE id=?',id); if(!f) return respond('غير موجود','<section class="panel"><h1>النموذج غير موجود.</h1></section>',404);
    let subs=await all(env,'SELECT * FROM submissions WHERE form_id=? ORDER BY id DESC LIMIT 500',id); const fields=await fieldsFor(env,id,false); const columns=[],seen=new Set();
    for(const x of fields){columns.push([x.field_key,x.label]);seen.add(x.field_key);}
    for(const sub of subs){let d={};try{d=JSON.parse(sub.data_json)}catch{}; for(const [k,v] of Object.entries(d)){if(!seen.has(k)){columns.push([k,v?.label||k]);seen.add(k);}}}
    const q=(url.searchParams.get('q')||'').trim().toLowerCase(); if(q) subs=subs.filter(s=>{let d={};try{d=JSON.parse(s.data_json)}catch{};return (String(s.id)+' '+Object.values(d).map(v=>v?.value||'').join(' ')).toLowerCase().includes(q);});
    const rows=subs.map(s=>{let d={};try{d=JSON.parse(s.data_json)}catch{};const cells=columns.map(([k])=>`<td>${escapeHtml(d[k]?.value||'')}</td>`).join('');const statusOpts=Object.entries(STATUSES).map(([k,l])=>`<option value="${k}"${k===s.status?' selected':''}>${escapeHtml(l)}</option>`).join('');return `<tr><td>${s.id}</td>${cells}<td>${formOpen(`/admin/submissions/${s.id}/status`,session,'post','inline-form')}<select class="status-select" name="status">${statusOpts}</select><input class="search" name="review_note" value="${escAttr(s.review_note||'')}" placeholder="ملاحظة المراجعة"><button class="secondary">حفظ</button></form></td><td>${escapeHtml(s.submitted_at)}</td></tr>`;});
    return respond('نتائج النموذج',`<section class="row"><div><h1 class="page-title">نتائج: ${escapeHtml(f.name)}</h1><p class="muted">آخر 500 طلب.</p></div><div class="actions"><a class="secondary" href="/dashboard">العودة للوحة</a><a class="button" href="/admin/forms/${id}/export.csv">تصدير CSV</a></div></section><section class="panel">${formOpen(`/admin/forms/${id}/results`,session,'get','inline-form')}<input class="search" name="q" value="${escAttr(q)}" placeholder="بحث داخل الطلبات..." style="max-width:430px"><button class="secondary">بحث</button></form><p class="small">النتائج الظاهرة: ${subs.length}</p></section>${table(['#',...columns.map(x=>x[1]),'الحالة','وقت التقديم'],rows,'لا توجد نتائج مطابقة.')}`);
  }
  m=path.match(/^\/admin\/submissions\/(\d+)\/status$/);
  if(m&&method==='POST') {
    if(!user) return redirectLocal('/login'); const id=Number(m[1]); const sub=await one(env,'SELECT * FROM submissions WHERE id=?',id); if(!sub) return respond('غير موجود','<section class="panel"><h1>الطلب غير موجود.</h1></section>',404);
    if(!(await hasPerm(env,user,sub.form_id,'results'))) return respond('غير مسموح','<section class="panel"><h1>ليست لديك صلاحية تعديل الحالة.</h1></section>',403);
    const body=new URLSearchParams(await request.clone().text()), status=body.get('status')||'pending'; if(!STATUSES[status]) return respond('طلب غير صالح','<section class="panel"><h1>الحالة غير صالحة.</h1></section>',400);
    await run(env,'UPDATE submissions SET status=?,review_note=?,reviewed_by=?,reviewed_at=? WHERE id=?',status,(body.get('review_note')||'').trim().slice(0,3000),user.id,now(),id);
    await audit(env,session,'submission.reviewed','submission',id,`Status set to ${status}`); return redirectMessage(`/admin/forms/${sub.form_id}/results`,'تم تحديث الطلب.');
  }
  m=path.match(/^\/admin\/forms\/(\d+)\/export\.csv$/);
  if(m&&method==='GET') {
    const id=Number(m[1]); if(!user||!(await hasPerm(env,user,id,'results'))) return respond('غير مسموح','<section class="panel"><h1>ليست لديك صلاحية التصدير.</h1></section>',403);
    const f=await one(env,'SELECT * FROM forms WHERE id=?',id); if(!f) return respond('غير موجود','<section class="panel"><h1>النموذج غير موجود.</h1></section>',404);
    const subs=await all(env,'SELECT * FROM submissions WHERE form_id=? ORDER BY id DESC LIMIT 5000',id), fields=await fieldsFor(env,id,false), cols=[],seen=new Set();
    for(const x of fields){cols.push([x.field_key,x.label]);seen.add(x.field_key);} for(const s of subs){let d={};try{d=JSON.parse(s.data_json)}catch{};for(const[k,v]of Object.entries(d)){if(!seen.has(k)){cols.push([k,v?.label||k]);seen.add(k);}}}
    const csvCell=v=>`"${String(v??'').replace(/"/g,'""')}"`;
    const lines=[["ID",...cols.map(x=>x[1]),"الحالة","وقت التقديم","ملاحظة المراجعة"],...subs.map(s=>{let d={};try{d=JSON.parse(s.data_json)}catch{};return [s.id,...cols.map(([k])=>d[k]?.value||''),STATUSES[s.status]||s.status,s.submitted_at,s.review_note||''];})].map(row=>row.map(csvCell).join(',')).join('\r\n');
    return new Response('\ufeff'+lines,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="form-${id}-results.csv"`,'cache-control':'no-store'}});
  }
  if(path==='/admin/users'&&method==='GET') {
    if(!user||user.role!=='admin') return respond('غير مسموح','<section class="panel"><h1>هذه الصفحة للمدير فقط.</h1></section>',403);
    const users=await all(env,'SELECT id,username,display_name,role,active,can_moderate,created_at FROM users ORDER BY id');
    const cards=users.map(u=>`<article class="panel"><div class="row"><div><h2>${escapeHtml(u.username)}</h2><p class="small">رقم المستخدم ${u.id} · ${escapeHtml(u.created_at)}</p></div><a class="secondary" href="/admin/users/${u.id}/permissions">صلاحيات النماذج</a></div>${formOpen(`/admin/users/${u.id}/save`,session,'post','form-grid')}${field('الاسم الظاهر','display_name',u.display_name)}${select('الدور العام','role',Object.entries(ROLES),u.role)}${field('كلمة مرور جديدة (اختياري)','password','','password',false,'12 حرفًا على الأقل عند التغيير.')}${checkbox('الحساب نشط','active',!!u.active)}${checkbox('السماح بسجل الحظر','can_moderate',!!u.can_moderate)}<div class="actions">${btn('حفظ المستخدم')}</div></form></article>`).join('');
    return respond('المستخدمون',`<section class="row"><div><h1 class="page-title">المستخدمون والصلاحيات</h1><p class="muted">إنشاء الحسابات وتحديد مستوى الصلاحية العام.</p></div><a class="secondary" href="/dashboard">العودة للوحة</a></section><section class="panel"><h2>إنشاء مستخدم</h2>${formOpen('/admin/users/new',session,'post','form-grid')}${field('اسم المستخدم','username','','text',true)}${field('الاسم الظاهر','display_name')}${field('كلمة المرور','password','','password',true,'12 حرفًا على الأقل.')}${select('الدور', 'role',Object.entries(ROLES),'viewer')}${checkbox('السماح بسجل الحظر','can_moderate',false)}<div class="actions">${btn('إنشاء المستخدم')}</div></form></section>${cards}`);
  }
  if(path==='/admin/users/new'&&method==='POST') {
    if(!user||user.role!=='admin') return respond('غير مسموح','<section class="panel"><h1>هذه الصفحة للمدير فقط.</h1></section>',403);
    const body=new URLSearchParams(await request.clone().text()), username=(body.get('username')||'').trim(), display=(body.get('display_name')||'').trim().slice(0,120), password=body.get('password')||'', role=body.get('role')||'viewer';
    if(!/^[A-Za-z0-9_.-]{3,80}$/.test(username)||!ROLES[role]||password.length<12) return redirectMessage('/admin/users','راجع اسم المستخدم والدور وكلمة المرور (12 حرفًا على الأقل).','error');
    if(await one(env,'SELECT id FROM users WHERE username=?',username)) return redirectMessage('/admin/users','اسم المستخدم مستخدم بالفعل.','error');
    const hash=await hashPassword(password); await run(env,'INSERT INTO users(username,display_name,password_hash,role,active,can_moderate,created_at) VALUES(?,?,?,?,?,?,?)',username,display,hash,role,1,body.has('can_moderate')?1:0,now());
    const newUser=await one(env,'SELECT id FROM users WHERE username=?',username); await audit(env,session,'user.created','user',newUser.id,`Created ${username} (${role})`);
    return redirectMessage(`/admin/users/${newUser.id}/permissions`,'تم إنشاء المستخدم. عيّن صلاحيات النماذج.');
  }
  m=path.match(/^\/admin\/users\/(\d+)\/save$/);
  if(m&&method==='POST') {
    if(!user||user.role!=='admin') return respond('غير مسموح','<section class="panel"><h1>هذه الصفحة للمدير فقط.</h1></section>',403);
    const id=Number(m[1]), target=await one(env,'SELECT * FROM users WHERE id=?',id); if(!target) return respond('غير موجود','<section class="panel"><h1>المستخدم غير موجود.</h1></section>',404);
    const body=new URLSearchParams(await request.clone().text()), role=body.get('role')||'viewer',active=body.has('active')?1:0,password=body.get('password')||'';
    if(!ROLES[role]||(password&&password.length<12)) return redirectMessage('/admin/users','الدور غير صالح أو كلمة المرور الجديدة أقصر من 12 حرفًا.','error');
    const admins=await one(env,"SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1"); if(target.role==='admin'&&target.active&&(role!=='admin'||!active)&&Number(admins.n)<=1) return redirectMessage('/admin/users','لا يمكن تعطيل أو خفض صلاحية آخر مدير نشط.','error');
    const values=[(body.get('display_name')||'').trim().slice(0,120),role,active,body.has('can_moderate')?1:0];
    if(password){values.push(await hashPassword(password));await run(env,'UPDATE users SET display_name=?,role=?,active=?,can_moderate=?,password_hash=? WHERE id=?',...values,id);}else await run(env,'UPDATE users SET display_name=?,role=?,active=?,can_moderate=? WHERE id=?',...values,id);
    await audit(env,session,'user.updated','user',id,'Updated user settings'); return redirectMessage('/admin/users','تم حفظ المستخدم.');
  }
  m=path.match(/^\/admin\/users\/(\d+)\/permissions$/);
  if(m&&(method==='GET'||method==='POST')) {
    if(!user||user.role!=='admin') return respond('غير مسموح','<section class="panel"><h1>هذه الصفحة للمدير فقط.</h1></section>',403);
    const id=Number(m[1]), target=await one(env,'SELECT id,username,display_name,role FROM users WHERE id=?',id); if(!target) return respond('غير موجود','<section class="panel"><h1>المستخدم غير موجود.</h1></section>',404);
    const forms=await all(env,'SELECT id,name,slug FROM forms ORDER BY created_at DESC');
    if(method==='POST') { const body=new URLSearchParams(await request.clone().text()); for(const f of forms){ await run(env,'INSERT INTO form_permissions(user_id,form_id,can_read,can_results,can_edit,can_manage) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,form_id) DO UPDATE SET can_read=excluded.can_read,can_results=excluded.can_results,can_edit=excluded.can_edit,can_manage=excluded.can_manage',id,f.id,body.has(`read_${f.id}`)?1:0,body.has(`results_${f.id}`)?1:0,body.has(`edit_${f.id}`)?1:0,body.has(`manage_${f.id}`)?1:0); } await audit(env,session,'permissions.updated','user',id,`Updated permissions for ${target.username}`); return redirectMessage(`/admin/users/${id}/permissions`,'تم حفظ الصلاحيات.'); }
    const ps=await all(env,'SELECT * FROM form_permissions WHERE user_id=?',id), pm=new Map(ps.map(p=>[p.form_id,p]));
    const lines=forms.map(f=>{const p=pm.get(f.id)||{};return `<div class="panel"><strong>${escapeHtml(f.name)}</strong><p class="small">/${escapeHtml(f.slug)}</p><div class="form-grid">${checkbox('قراءة النموذج',`read_${f.id}`,!!p.can_read)}${checkbox('رؤية النتائج',`results_${f.id}`,!!p.can_results)}${checkbox('تعديل النموذج',`edit_${f.id}`,!!p.can_edit)}${checkbox('إدارة كاملة لهذا النموذج',`manage_${f.id}`,!!p.can_manage)}</div></div>`;}).join('')||'<div class="empty">أنشئ نموذجًا أولًا لتحديد الصلاحيات.</div>';
    return respond('صلاحيات المستخدم',`<section class="row"><div><h1 class="page-title">صلاحيات ${escapeHtml(target.username)}</h1><p class="muted">حدد ما يمكن لهذا المستخدم مشاهدته أو تعديله لكل نموذج.</p></div><a class="secondary" href="/admin/users">العودة للمستخدمين</a></section>${formOpen(`/admin/users/${id}/permissions`,session)}${lines}<div class="actions">${btn('حفظ جميع الصلاحيات')}</div></form>`);
  }
  if(path==='/moderation'&&method==='GET') {
    if(!user||!(user.role==='admin'||user.can_moderate)) return respond('غير مسموح','<section class="panel"><h1>لا تملك صلاحية سجل الحظر.</h1></section>',403);
    const actions=await all(env,'SELECT m.*,u.username AS created_username FROM moderation_actions m LEFT JOIN users u ON u.id=m.created_by ORDER BY m.id DESC LIMIT 500');
    const rows=actions.map(a=>`<tr><td>${a.id}</td><td>${a.action_type==='chat'?'حظر الشات':'حظر البريد'}</td><td>${escapeHtml(a.player_name)}<br><span class="small">UID: ${escapeHtml(a.player_uid)}</span></td><td>${escapeHtml(a.server)}</td><td>${escapeHtml(DURATIONS[a.duration]||a.duration)}</td><td>${escapeHtml(a.reason)}</td><td>${formOpen(`/moderation/${a.id}/status`,session,'post','inline-form')}${select('','status',Object.entries(MOD_STATUSES),a.status)}<input class="search" name="result_note" value="${escAttr(a.result_note||'')}" placeholder="ملاحظة التنفيذ"><button class="secondary">حفظ</button></form><span class="small">بواسطة ${escapeHtml(a.created_username||'—')}</span></td><td>${escapeHtml(a.created_at)}</td></tr>`);
    return respond('سجل الحظر',`<section class="row"><div><h1 class="page-title">سجل إجراءات الحظر</h1><p class="muted">السجل يتابع الحظر ولا يرسله إلى خادم اللعبة تلقائيًا.</p></div><a class="button" href="/moderation/new">+ تسجيل إجراء</a></section><div class="alert warning">تنبيه: هذه اللوحة لا تنفذ حظرًا داخل اللعبة. يلزم API رسمي موثق من خادم اللعبة.</div>${table(['#','النوع','اللاعب','السيرفر','المدة','السبب','الحالة','التاريخ'],rows,'لا توجد إجراءات مسجلة.')}`);
  }
  if(path==='/moderation/new'&&(method==='GET'||method==='POST')) {
    if(!user||!(user.role==='admin'||user.can_moderate)) return respond('غير مسموح','<section class="panel"><h1>لا تملك صلاحية سجل الحظر.</h1></section>',403);
    if(method==='POST') {
      const body=new URLSearchParams(await request.clone().text()), type=body.get('action_type')||'',uid=(body.get('player_uid')||'').trim(),name=(body.get('player_name')||'').trim().slice(0,120),server=(body.get('server')||'').trim(),duration=body.get('duration')||'',reason=(body.get('reason')||'').trim();
      if(!['chat','mail'].includes(type)||!uid||!server||!DURATIONS[duration]||!reason||uid.length>100||server.length>100||reason.length>3000) return redirectMessage('/moderation/new','راجع البيانات المطلوبة وحدود طول الحقول.','error');
      await run(env,'INSERT INTO moderation_actions(action_type,player_uid,player_name,server,duration,reason,status,result_note,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',type,uid,name,server,duration,reason,'pending','',user.id,now(),now());
      const a=await one(env,'SELECT id FROM moderation_actions WHERE created_by=? ORDER BY id DESC LIMIT 1',user.id); await audit(env,session,'moderation.recorded','moderation_action',a?.id||'',`Recorded ${type} action for ${uid}; not sent to game server`);
      return redirectMessage('/moderation','تم تسجيل الإجراء. نفّذه في أدوات اللعبة الرسمية ثم حدّث الحالة.','warning');
    }
    return respond('تسجيل حظر',`<section class="panel"><h1>تسجيل إجراء حظر</h1><div class="alert warning">هذه الشاشة للتوثيق والمتابعة فقط ولا تتصل بسيرفر اللعبة تلقائيًا.</div>${formOpen('/moderation/new',session)}${select('نوع الإجراء','action_type',[['chat','حظر الشات'],['mail','حظر البريد']],'chat',true)}${field('رقم هوية اللاعب (UID)','player_uid','', 'text',true)}${field('اسم اللاعب','player_name')}${field('السيرفر','server','', 'text',true)}${select('المدة','duration',Object.entries(DURATIONS),'1h',true)}${textarea('سبب الحظر','reason','',true)}${btn('تسجيل الإجراء')}</form></section>`);
  }
  m=path.match(/^\/moderation\/(\d+)\/status$/);
  if(m&&method==='POST') {
    if(!user||!(user.role==='admin'||user.can_moderate)) return respond('غير مسموح','<section class="panel"><h1>ليست لديك الصلاحية.</h1></section>',403);
    const id=Number(m[1]), a=await one(env,'SELECT * FROM moderation_actions WHERE id=?',id); if(!a) return respond('غير موجود','<section class="panel"><h1>السجل غير موجود.</h1></section>',404);
    if(user.role!=='admin'&&a.created_by!==user.id) return respond('غير مسموح','<section class="panel"><h1>يمكنك تعديل السجلات التي أنشأتها فقط.</h1></section>',403);
    const body=new URLSearchParams(await request.clone().text()), status=body.get('status')||'pending'; if(!MOD_STATUSES[status]) return respond('طلب غير صالح','<section class="panel"><h1>الحالة غير صالحة.</h1></section>',400);
    await run(env,'UPDATE moderation_actions SET status=?,result_note=?,updated_by=?,updated_at=? WHERE id=?',status,(body.get('result_note')||'').trim().slice(0,3000),user.id,now(),id);
    await audit(env,session,'moderation.status_updated','moderation_action',id,`Status changed to ${status}`); return redirectMessage('/moderation','تم تحديث السجل.');
  }
  if(path==='/admin/audit'&&method==='GET') {
    if(!user||user.role!=='admin') return respond('غير مسموح','<section class="panel"><h1>هذه الصفحة للمدير فقط.</h1></section>',403);
    const logs=await all(env,'SELECT a.*,u.username FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 300');
    const rows=logs.map(x=>`<tr><td>${x.id}</td><td>${escapeHtml(x.username||'system')}</td><td>${escapeHtml(x.action)}</td><td>${escapeHtml(x.entity_type)} #${escapeHtml(x.entity_id)}</td><td>${escapeHtml(x.details)}</td><td>${escapeHtml(x.created_at)}</td></tr>`);
    return respond('سجل النشاط',`<section class="row"><div><h1 class="page-title">سجل النشاط الإداري</h1><p class="muted">آخر 300 إجراء.</p></div><a class="secondary" href="/dashboard">العودة للوحة</a></section>${table(['#','المستخدم','الحدث','العنصر','التفاصيل','التاريخ'],rows,'لا توجد سجلات.')}`);
  }
  return respond('الصفحة غير موجودة','<section class="panel"><h1>الصفحة غير موجودة</h1><p class="muted">الرابط غير صحيح أو الصفحة غير متاحة.</p><a class="button" href="/">الرئيسية</a></section>',404);
}

async function handle(request, env) {
  await ensureSchema(env);
  await seedAdmin(env);
  const session = await getSession(request, env);
  const response = await dispatch(request, env, session);
  if (!session.setCookie) return response;
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', sessionCookie(session.token));
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      console.error('SOG portal error:', err?.stack || err);
      return new Response('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>خطأ</title><body style="font-family:Tahoma;background:#0c1117;color:#eee;padding:30px"><h1>حدث خطأ في التطبيق</h1><p>افتح Logs في Cloudflare لمعرفة التفاصيل.</p><a href="/">الرئيسية</a></body></html>', {status:500, headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
    }
  }
};
