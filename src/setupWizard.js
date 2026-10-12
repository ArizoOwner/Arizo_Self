/**
 * 🧙 Arizo Self — ویزارد نصب خودکار (Cloudflare + GitHub)
 *
 * دو توکن می‌گیرد و همه‌چیز را خودش انجام می‌دهد:
 *   Cloudflare: KV + D1 + آپلود Worker + کران + دامنهٔ workers.dev
 *   GitHub:     فورک + سکرت‌ها + فعال‌سازی و اجرای رانر
 * توکن‌ها فقط در حافظهٔ مرورگر می‌مانند و هیچ‌جا ذخیره نمی‌شوند.
 */
export const WIZARD_VERSION = 'WIZARD v4.0 AUTO';

const CF_PERMS = [
  { key: 'workers_scripts', type: 'edit' },
  { key: 'workers_kv_storage', type: 'edit' },
  { key: 'd1', type: 'edit' },
  { key: 'account_settings', type: 'read' }
];

export function setupWizardHTML(env, url) {
  const origin = url ? url.origin : '';
  const cfLink = 'https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys='
    + encodeURIComponent(JSON.stringify(CF_PERMS)) + '&accountId=*&zoneId=all&name=' + encodeURIComponent('Arizo Self Wizard');
  const ghLink = 'https://github.com/settings/tokens/new?scopes=repo,workflow&description=' + encodeURIComponent('Arizo Self Wizard');

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Arizo Self — ${WIZARD_VERSION}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%236366f1'/%3E%3Cpath d='M36 8 18 36h12l-4 20 20-30H34z' fill='white'/%3E%3C/svg%3E">
<script>
(function(){try{var t=localStorage.getItem('arizo_wizard_theme')||'dark';document.documentElement.setAttribute('data-theme',t);var l=localStorage.getItem('arizo_lang')||'fa';document.documentElement.setAttribute('lang',l);document.documentElement.setAttribute('dir',l==='en'?'ltr':'rtl');}catch(e){}})();
</script>
<style>
:root{--bg:#09090b;--bg2:radial-gradient(circle at 15% 15%,rgba(67,56,202,.35),transparent 45%),radial-gradient(circle at 85% 80%,rgba(14,165,233,.22),transparent 45%);--card:rgba(20,20,30,.78);--card2:rgba(30,30,44,.6);--line:rgba(255,255,255,.09);--text:#f8fafc;--muted:#94a3b8;--dim:#64748b;--ind:#818cf8;--blue:#38bdf8;--green:#34d399;--amber:#fbbf24;--rose:#f87171;--r:16px;--font:'Vazirmatn',system-ui,-apple-system,Segoe UI,sans-serif;--mono:'JetBrains Mono',Consolas,monospace}
[data-theme="light"]{--bg:#f4f6fb;--bg2:radial-gradient(circle at 15% 15%,rgba(99,102,241,.16),transparent 45%),radial-gradient(circle at 85% 80%,rgba(14,165,233,.14),transparent 45%);--card:rgba(255,255,255,.88);--card2:rgba(241,245,249,.9);--line:rgba(15,23,42,.1);--text:#0f172a;--muted:#475569;--dim:#64748b}
*{box-sizing:border-box;margin:0;padding:0}
html,body{min-height:100%}
body{font-family:var(--font);background:var(--bg);background-image:var(--bg2);background-attachment:fixed;color:var(--text);line-height:1.7;padding:24px 16px 56px}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:760px;margin:0 auto}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:12px}
.logo{width:46px;height:46px;border-radius:14px;background:linear-gradient(135deg,#6366f1,#38bdf8);display:grid;place-items:center;font-size:24px;box-shadow:0 8px 24px rgba(99,102,241,.4)}
.brand h1{font-size:1.15rem;font-weight:800}.brand small{color:var(--muted);font-size:.78rem;display:block}
.tools{display:flex;gap:8px}
.chip{background:var(--card2);border:1px solid var(--line);color:var(--text);border-radius:999px;padding:7px 14px;font:inherit;font-size:.8rem;cursor:pointer}
.chip:hover{border-color:var(--ind)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:22px;margin-bottom:16px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 10px 40px rgba(0,0,0,.18)}
.card h2{font-size:1.02rem;font-weight:800;margin-bottom:6px;display:flex;align-items:center;gap:8px}
.card p.lead{color:var(--muted);font-size:.86rem;margin-bottom:14px}
.num{width:26px;height:26px;border-radius:50%;background:var(--ind);color:#fff;display:inline-grid;place-items:center;font-size:.8rem;font-weight:800;flex:none}
.steps{list-style:none;display:grid;gap:8px;margin:0 0 14px}
.steps li{display:flex;gap:10px;align-items:flex-start;font-size:.86rem;color:var(--muted)}
.steps li b{color:var(--text)}
label{display:block;font-size:.8rem;font-weight:600;margin:12px 0 6px}
.field{position:relative}
input[type=text],input[type=password],select{width:100%;background:var(--card2);border:1px solid var(--line);color:var(--text);border-radius:12px;padding:12px 14px;font-family:var(--mono);font-size:.86rem;outline:none;direction:ltr;text-align:left}
input:focus,select:focus{border-color:var(--ind);box-shadow:0 0 0 3px rgba(129,140,248,.2)}
.field input{padding-right:44px}
.eye{position:absolute;top:50%;right:10px;left:auto;transform:translateY(-50%);background:none;border:0;color:var(--muted);cursor:pointer;font-size:1rem}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;align-items:center}
.status:empty{display:none}
button.btn,a.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;border:0;border-radius:12px;padding:12px 22px;font:inherit;font-weight:700;font-size:.9rem;cursor:pointer;text-decoration:none;box-shadow:0 8px 22px rgba(79,70,229,.35);transition:.15s}
button.btn:hover:not(:disabled),a.btn:hover{transform:translateY(-1px);text-decoration:none}
button.btn:disabled{opacity:.5;cursor:not-allowed}
.btn.ghost{background:var(--card2);color:var(--text);box-shadow:none;border:1px solid var(--line)}
.btn.big{padding:15px 30px;font-size:1rem;width:100%}
.hint{font-size:.78rem;color:var(--dim);margin-top:8px}
.ok{color:var(--green)}.bad{color:var(--rose)}.warn{color:var(--amber)}
.status{font-size:.84rem;margin-top:10px;min-height:1.2em}
.badge{display:inline-flex;align-items:center;gap:6px;background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.3);color:var(--green);border-radius:999px;padding:3px 12px;font-size:.78rem;font-weight:600}
details{margin-top:12px;font-size:.82rem;color:var(--muted)}details summary{cursor:pointer;color:var(--blue)}
.progress{height:8px;background:var(--card2);border-radius:99px;overflow:hidden;margin:6px 0 18px}
.progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,#6366f1,#38bdf8,#34d399);transition:width .4s}
.log{list-style:none;display:grid;gap:8px}
.log li{display:flex;gap:10px;align-items:center;background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:10px 14px;font-size:.86rem}
.log .ic{width:22px;text-align:center;flex:none}
.log .sub{margin-inline-start:auto;color:var(--dim);font-size:.74rem;font-family:var(--mono)}
.log li.run .ic::before{content:'⏳'}.log li.done .ic::before{content:'✅'}.log li.fail .ic::before{content:'❌'}.log li.wait .ic::before{content:'○';color:var(--dim)}.log li.skip .ic::before{content:'↷';color:var(--dim)}
.log li.fail{border-color:rgba(248,113,113,.4)}
.result{border-color:rgba(52,211,153,.35)}
.kv{display:grid;gap:10px;margin:14px 0}
.kv div{display:flex;align-items:center;gap:10px;background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:10px 14px}
.kv span{font-size:.78rem;color:var(--muted);min-width:96px}.kv code{font-family:var(--mono);font-size:.84rem;direction:ltr;overflow-wrap:anywhere;flex:1;text-align:left}
.kv button{background:none;border:0;color:var(--blue);cursor:pointer;font:inherit;font-size:.78rem}
.hidden{display:none!important}
.warnbox{background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.35);color:var(--amber);border-radius:12px;padding:12px 14px;font-size:.82rem;margin-top:12px}
.errbox{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.4);color:var(--rose);border-radius:12px;padding:12px 14px;font-size:.84rem;margin-top:12px}
footer{text-align:center;color:var(--dim);font-size:.76rem;margin-top:24px}
@media(max-width:560px){.kv div{flex-wrap:wrap}.kv span{min-width:100%}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="brand"><div class="logo">⚡</div><div><h1>Arizo Self</h1><small>${WIZARD_VERSION}</small></div></div>
  <div class="tools">
    <button class="chip" id="langBtn" type="button">English</button>
    <button class="chip" id="themeBtn" type="button">☀️</button>
    <a class="chip" href="/" data-t="studio">🚪 استودیو</a>
  </div>
</header>

<div class="progress"><i id="bar"></i></div>

<!-- مرحله ۱: Cloudflare -->
<section class="card" id="s1">
  <h2><span class="num">1</span><span data-t="s1title">اتصال به Cloudflare</span></h2>
  <p class="lead" data-t="s1lead">برای ساخت دیتابیس و استقرار پنل، یک توکن Cloudflare لازم است.</p>
  <ol class="steps">
    <li>🔹 <span data-t="s1a">با دکمهٔ زیر صفحهٔ ساخت توکن را باز کنید (دسترسی‌ها از قبل انتخاب شده‌اند).</span></li>
    <li>🔹 <span data-t="s1b">گزینهٔ <b>Continue to summary</b> و بعد <b>Create Token</b> را بزنید.</span></li>
    <li>🔹 <span data-t="s1c">توکن را کپی کنید و پایین بچسبانید.</span></li>
  </ol>
  <a class="btn ghost" href="${cfLink}" target="_blank" rel="noopener" data-t="s1open">🔑 ساخت توکن Cloudflare</a>
  <label for="cfToken" data-t="s1label">توکن Cloudflare</label>
  <div class="field"><input type="password" id="cfToken" autocomplete="off" spellcheck="false" placeholder="Cloudflare API Token"><button class="eye" type="button" data-eye="cfToken" aria-label="show">👁</button></div>
  <div class="row"><button class="btn" id="cfVerify" type="button" data-t="s1btn">بررسی توکن</button></div>
  <div class="status" id="cfStatus"></div>
  <div id="subBox" class="hidden">
    <label for="subName" data-t="subLabel">اکانت جدید است؛ یک نام برای آدرس workers.dev انتخاب کنید</label>
    <div class="row" style="margin-top:0"><input type="text" id="subName" placeholder="my-name" style="flex:1"><button class="btn ghost" id="subBtn" type="button" data-t="subBtn">ثبت نام</button></div>
  </div>
  <div id="acctBox" class="hidden"><label for="acctSel" data-t="acctLabel">اکانت Cloudflare</label><select id="acctSel"></select></div>
</section>

<!-- مرحله ۲: GitHub -->
<section class="card" id="s2">
  <h2><span class="num">2</span><span data-t="s2title">اتصال به GitHub (برای رانر ۲۴ ساعته)</span></h2>
  <p class="lead" data-t="s2lead">رانر ساعت و ربات را روی GitHub Actions اجرا می‌کند. ویزارد پروژه را برایتان فورک می‌کند و همه‌چیز را تنظیم می‌کند.</p>
  <ol class="steps">
    <li>🔹 <span data-t="s2a">با دکمهٔ زیر توکن بسازید (دسترسی‌های repo و workflow انتخاب شده‌اند).</span></li>
    <li>🔹 <span data-t="s2b">پایین صفحه <b>Generate token</b> را بزنید و توکن را کپی کنید.</span></li>
  </ol>
  <a class="btn ghost" href="${ghLink}" target="_blank" rel="noopener" data-t="s2open">🔑 ساخت توکن GitHub</a>
  <label for="ghToken" data-t="s2label">توکن GitHub</label>
  <div class="field"><input type="password" id="ghToken" autocomplete="off" spellcheck="false" placeholder="ghp_… / github_pat_…"><button class="eye" type="button" data-eye="ghToken" aria-label="show">👁</button></div>
  <div class="row"><button class="btn" id="ghVerify" type="button" data-t="s2btn">بررسی توکن</button></div>
  <div class="status" id="ghStatus"></div>
  <label style="display:flex;gap:8px;align-items:center;font-weight:500;margin-top:14px"><input type="checkbox" id="skipGh"> <span data-t="skipGh">رانر گیت‌هاب را فعلاً نمی‌خواهم (فقط پنل وب)</span></label>
</section>

<!-- مرحله ۳: نام و نصب -->
<section class="card" id="s3">
  <h2><span class="num">3</span><span data-t="s3title">نصب</span></h2>
  <label for="workerName" data-t="s3label">نام Worker</label>
  <input type="text" id="workerName" value="arizo-self" maxlength="54">
  <div class="warnbox hidden" id="existsBox" data-t="exists">یک Worker با این نام از قبل در اکانت شما هست؛ نصب آن را به‌روزرسانی می‌کند و دیتابیس فعلی دست‌نخورده می‌ماند.</div>
  <div class="row"><button class="btn big" id="install" type="button" disabled data-t="install">☁️ نصب</button></div>
  <div class="hint" data-t="hint">توکن‌ها فقط در همین صفحه استفاده می‌شوند و جایی ذخیره نمی‌شوند.</div>
</section>

<!-- پیشرفت -->
<section class="card hidden" id="progressCard">
  <h2>⚙️ <span data-t="progress">در حال نصب…</span></h2>
  <ul class="log" id="log"></ul>
  <div class="errbox hidden" id="errBox"></div>
  <div class="row hidden" id="retryRow"><button class="btn" id="retry" type="button" data-t="retry">🔁 تلاش دوباره</button></div>
</section>

<!-- نتیجه -->
<section class="card result hidden" id="resultCard">
  <h2>🎉 <span data-t="done">نصب کامل شد</span></h2>
  <p class="lead" data-t="doneLead">این اطلاعات را همین الان ذخیره کنید؛ رمز بعداً قابل مشاهده نیست.</p>
  <div class="kv">
    <div><span data-t="kvUrl">آدرس پنل</span><code id="rUrl"></code><button type="button" data-copy="rUrl" data-t="copy">کپی</button></div>
    <div><span data-t="kvAdmin">ورود مدیر</span><code id="rAdmin"></code><button type="button" data-copy="rAdmin" data-t="copy">کپی</button></div>
    <div><span data-t="kvPass">رمز مدیر</span><code id="rPass"></code><button type="button" data-copy="rPass" data-t="copy">کپی</button></div>
    <div id="rRepoRow"><span data-t="kvRepo">ریپوی شما</span><code id="rRepo"></code><button type="button" data-copy="rRepo" data-t="copy">کپی</button></div>
  </div>
  <div class="warnbox hidden" id="rWarn"></div>
  <div class="row"><a class="btn" id="rOpen" href="#" target="_blank" rel="noopener" data-t="openPanel">🚀 ورود به پنل</a><a class="btn ghost hidden" id="rActions" href="#" target="_blank" rel="noopener" data-t="openActions">⚙️ مشاهدهٔ رانر</a><button class="btn ghost" id="dlCreds" type="button" data-t="download">⬇️ دانلود اطلاعات ورود</button></div>
</section>

<footer>Arizo Self · ${WIZARD_VERSION}</footer>
</div>

<script>
(function(){
'use strict';
var ORIGIN=${JSON.stringify(origin)};
var T={
fa:{studio:'🚪 استودیو',s1title:'اتصال به Cloudflare',s1lead:'برای ساخت دیتابیس و استقرار پنل، یک توکن Cloudflare لازم است.',s1a:'با دکمهٔ زیر صفحهٔ ساخت توکن را باز کنید (دسترسی‌ها از قبل انتخاب شده‌اند).',s1b:'گزینهٔ Continue to summary و بعد Create Token را بزنید.',s1c:'توکن را کپی کنید و پایین بچسبانید.',s1open:'🔑 ساخت توکن Cloudflare',s1label:'توکن Cloudflare',s1btn:'بررسی توکن',subLabel:'اکانت جدید است؛ یک نام برای آدرس workers.dev انتخاب کنید',subBtn:'ثبت نام',acctLabel:'اکانت Cloudflare',s2title:'اتصال به GitHub (برای رانر ۲۴ ساعته)',s2lead:'رانر ساعت و ربات را روی GitHub Actions اجرا می‌کند. ویزارد پروژه را برایتان فورک می‌کند و همه‌چیز را تنظیم می‌کند.',s2a:'با دکمهٔ زیر توکن بسازید (دسترسی‌های repo و workflow انتخاب شده‌اند).',s2b:'پایین صفحه Generate token را بزنید و توکن را کپی کنید.',s2open:'🔑 ساخت توکن GitHub',s2label:'توکن GitHub',s2btn:'بررسی توکن',skipGh:'رانر گیت‌هاب را فعلاً نمی‌خواهم (فقط پنل وب)',s3title:'نصب',s3label:'نام Worker',exists:'یک Worker با این نام از قبل در اکانت شما هست؛ نصب آن را به‌روزرسانی می‌کند و دیتابیس فعلی دست‌نخورده می‌ماند.',install:'☁️ نصب',hint:'توکن‌ها فقط در همین صفحه استفاده می‌شوند و جایی ذخیره نمی‌شوند.',progress:'در حال نصب…',retry:'🔁 تلاش دوباره',done:'نصب کامل شد',doneLead:'این اطلاعات را همین الان ذخیره کنید؛ رمز بعداً قابل مشاهده نیست.',kvUrl:'آدرس پنل',kvAdmin:'ورود مدیر',kvPass:'رمز مدیر',kvRepo:'ریپوی شما',copy:'کپی',openPanel:'🚀 ورود به پنل',openActions:'⚙️ مشاهدهٔ رانر',download:'⬇️ دانلود اطلاعات ورود'},
en:{studio:'🚪 Studio',s1title:'Connect Cloudflare',s1lead:'A Cloudflare token is needed to create the database and deploy the panel.',s1a:'Open the token page with the button below (permissions are pre-selected).',s1b:'Click Continue to summary, then Create Token.',s1c:'Copy the token and paste it below.',s1open:'🔑 Create Cloudflare token',s1label:'Cloudflare token',s1btn:'Verify token',subLabel:'New account — pick a name for your workers.dev address',subBtn:'Save name',acctLabel:'Cloudflare account',s2title:'Connect GitHub (for the 24/7 runner)',s2lead:'The runner executes the clock and bot on GitHub Actions. The wizard forks the project and configures everything.',s2a:'Create a token with the button below (repo and workflow scopes are pre-selected).',s2b:'Click Generate token at the bottom and copy it.',s2open:'🔑 Create GitHub token',s2label:'GitHub token',s2btn:'Verify token',skipGh:'Skip the GitHub runner for now (web panel only)',s3title:'Install',s3label:'Worker name',exists:'A Worker with this name already exists in your account; installing will update it and keep the current database untouched.',install:'☁️ Install',hint:'Tokens are only used on this page and are never stored.',progress:'Installing…',retry:'🔁 Retry',done:'Installation complete',doneLead:'Save this now — the password cannot be shown again.',kvUrl:'Panel URL',kvAdmin:'Admin login',kvPass:'Admin password',kvRepo:'Your repository',copy:'Copy',openPanel:'🚀 Open panel',openActions:'⚙️ View runner',download:'⬇️ Download credentials'}
};
var lang=document.documentElement.getAttribute('lang')==='en'?'en':'fa';
function $(id){return document.getElementById(id)}
function applyLang(){
  document.documentElement.setAttribute('lang',lang);document.documentElement.setAttribute('dir',lang==='en'?'ltr':'rtl');
  var nodes=document.querySelectorAll('[data-t]');
  for(var i=0;i<nodes.length;i++){var k=nodes[i].getAttribute('data-t');if(T[lang][k]!==undefined){
    var txt=T[lang][k];
    if(/^(s1b|s2b)$/.test(k)){nodes[i].innerHTML=txt.replace(/(Continue to summary|Create Token|Generate token)/g,'<b>$1</b>');}else{nodes[i].textContent=txt;}
  }}
  $('langBtn').textContent=lang==='en'?'فارسی':'English';
  try{localStorage.setItem('arizo_lang',lang)}catch(e){}
}
$('langBtn').onclick=function(){lang=lang==='en'?'fa':'en';applyLang();};
function applyTheme(t){document.documentElement.setAttribute('data-theme',t);$('themeBtn').textContent=t==='light'?'🌙':'☀️';try{localStorage.setItem('arizo_wizard_theme',t)}catch(e){}}
$('themeBtn').onclick=function(){applyTheme(document.documentElement.getAttribute('data-theme')==='light'?'dark':'light');};
applyTheme(document.documentElement.getAttribute('data-theme')||'dark');applyLang();

var eyes=document.querySelectorAll('[data-eye]');
for(var e=0;e<eyes.length;e++){eyes[e].onclick=function(){var i=$(this.getAttribute('data-eye'));i.type=i.type==='password'?'text':'password';};}

var S={cf:{ok:false,accountId:'',subdomain:''},gh:{ok:false,login:''},installing:false,res:null};

function setStatus(id,cls,msg){var el=$(id);el.className='status '+cls;el.textContent=msg;}
function msgOf(d){return (lang==='en'?d.en:d.fa)||d.en||'Error';}
function api(step,body){
  return fetch(ORIGIN+'/api/setup/'+step,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})})
    .then(function(r){return r.json().catch(function(){return {ok:false,fa:'پاسخ نامعتبر از سرور',en:'Invalid server response'}})})
    .catch(function(){return {ok:false,fa:'ارتباط با سرور برقرار نشد',en:'Could not reach the server'}});
}
function refresh(){
  var ready=S.cf.ok&&(S.gh.ok||$('skipGh').checked)&&/^[a-z0-9][a-z0-9-]{0,53}$/.test($('workerName').value)&&!S.installing;
  $('install').disabled=!ready;
  var n=(S.cf.ok?1:0)+((S.gh.ok||$('skipGh').checked)?1:0);
  $('bar').style.width=(n===0?4:n===1?36:68)+'%';
}
$('skipGh').onchange=refresh;$('workerName').oninput=function(){this.value=this.value.toLowerCase();refresh();};

function fillAccounts(list,selected){
  var sel=$('acctSel');sel.innerHTML='';
  for(var i=0;i<list.length;i++){var o=document.createElement('option');o.value=list[i].id;o.textContent=list[i].name;sel.appendChild(o);}
  sel.value=selected;$('acctBox').classList.toggle('hidden',list.length<2);
}
$('acctSel').onchange=function(){S.cf.accountId=this.value;};

$('cfVerify').onclick=function(){
  var tk=$('cfToken').value.trim();if(!tk)return;
  var b=this;b.disabled=true;setStatus('cfStatus','','…');
  api('cloudflare/verify',{token:tk}).then(function(d){
    b.disabled=false;
    if(!d.ok){S.cf.ok=false;setStatus('cfStatus','bad','❌ '+msgOf(d));refresh();return;}
    S.cf={ok:true,accountId:d.accountId,subdomain:d.subdomain||''};
    fillAccounts(d.accounts,d.accountId);
    if(!d.subdomain){$('subBox').classList.remove('hidden');S.cf.ok=false;setStatus('cfStatus','warn','⚠️ '+(lang==='en'?'Choose a workers.dev name to continue.':'برای ادامه یک نام workers.dev انتخاب کنید.'));}
    else{$('subBox').classList.add('hidden');setStatus('cfStatus','ok','✅ '+(lang==='en'?'Connected — ':'متصل شد — ')+d.subdomain+'.workers.dev');}
    refresh();checkExists();
  });
};
$('subBtn').onclick=function(){
  var name=$('subName').value.trim().toLowerCase();if(!name)return;
  api('cloudflare/subdomain',{token:$('cfToken').value.trim(),accountId:S.cf.accountId,subdomain:name}).then(function(d){
    if(!d.ok){setStatus('cfStatus','bad','❌ '+msgOf(d));return;}
    S.cf.ok=true;S.cf.subdomain=d.subdomain;$('subBox').classList.add('hidden');setStatus('cfStatus','ok','✅ '+d.subdomain+'.workers.dev');refresh();
  });
};
function checkExists(){/* وجود Worker هم‌نام در مرحلهٔ منابع بررسی و نمایش داده می‌شود */}

$('ghVerify').onclick=function(){
  var tk=$('ghToken').value.trim();if(!tk)return;
  var b=this;b.disabled=true;setStatus('ghStatus','','…');
  api('github/verify',{token:tk}).then(function(d){
    b.disabled=false;
    if(!d.ok){S.gh.ok=false;setStatus('ghStatus','bad','❌ '+msgOf(d));refresh();return;}
    S.gh={ok:true,login:d.login};setStatus('ghStatus','ok','✅ '+(lang==='en'?'Connected as ':'متصل شد: ')+d.login);refresh();
  });
};

function randHex(bytes){var a=new Uint8Array(bytes);crypto.getRandomValues(a);var s='';for(var i=0;i<a.length;i++)s+=a[i].toString(16).padStart(2,'0');return s;}
function randPass(){var a=new Uint8Array(18);crypto.getRandomValues(a);return btoa(String.fromCharCode.apply(null,a)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}

var STEPS=[
 {id:'res',fa:'ساخت دیتابیس KV و D1',en:'Create KV and D1 databases'},
 {id:'deploy',fa:'دانلود و آپلود Worker',en:'Download and upload Worker'},
 {id:'fin',fa:'کران، دامنه و جدول‌ها',en:'Cron, domain and tables'},
 {id:'fork',fa:'فورک پروژه در GitHub',en:'Fork the project on GitHub'},
 {id:'sec',fa:'ثبت سکرت‌های رانر',en:'Store runner secrets'},
 {id:'run',fa:'فعال‌سازی و اجرای رانر',en:'Enable and start the runner'}
];
function renderLog(state){
  var ul=$('log');ul.innerHTML='';
  for(var i=0;i<STEPS.length;i++){
    var st=state[STEPS[i].id]||'wait';
    if(!$('skipGh').checked||i<3){
      var li=document.createElement('li');li.className=st;
      li.innerHTML='<span class="ic"></span><span></span>';li.children[1].textContent=lang==='en'?STEPS[i].en:STEPS[i].fa;
      ul.appendChild(li);
    }
  }
}
function fail(id,state,d){
  state[id]='fail';renderLog(state);
  $('errBox').classList.remove('hidden');$('errBox').textContent='❌ '+msgOf(d);
  $('retryRow').classList.remove('hidden');S.installing=false;refresh();
}

function install(){
  S.installing=true;refresh();
  $('progressCard').classList.remove('hidden');$('resultCard').classList.add('hidden');$('errBox').classList.add('hidden');$('retryRow').classList.add('hidden');
  $('progressCard').scrollIntoView({behavior:'smooth',block:'start'});
  var cf=$('cfToken').value.trim(),gh=$('ghToken').value.trim(),name=$('workerName').value.trim();
  var useGh=!$('skipGh').checked;
  var creds=S.res||{adminPassword:randPass(),runnerSecret:randHex(32)};
  S.res=creds;
  var state={};renderLog(state);
  var acct=S.cf.accountId,kv,d1,url='',repo='',branch='main',warn=[];

  function mark(id,st){state[id]=st;renderLog(state);}
  mark('res','run');
  api('cloudflare/resources',{token:cf,accountId:acct,workerName:name}).then(function(r){
    if(!r.ok){fail('res',state,r);throw 0;}
    kv=r.kvId;d1=r.d1Id;mark('res','done');if(r.workerExists)$('existsBox').classList.remove('hidden');
    mark('deploy','run');
    return api('cloudflare/deploy',{token:cf,accountId:acct,workerName:name,kvId:kv,d1Id:d1,adminPassword:creds.adminPassword,runnerSecret:creds.runnerSecret});
  }).then(function(r){
    if(!r.ok){fail('deploy',state,r);throw 0;}
    mark('deploy','done');mark('fin','run');
    return api('cloudflare/finalize',{token:cf,accountId:acct,workerName:name,d1Id:d1});
  }).then(function(r){
    if(!r.ok){fail('fin',state,r);throw 0;}
    url=r.url;mark('fin','done');
    if(!useGh)return {skip:true};
    mark('fork','run');
    return api('github/fork',{token:gh});
  }).then(function(r){
    if(r.skip)return r;
    if(!r.ok){fail('fork',state,r);throw 0;}
    repo=r.repo;branch=r.defaultBranch||'main';
    function waitReady(n){
      return api('github/secrets',{token:gh,repo:repo,cloudflareUrl:url,runnerSecret:creds.runnerSecret}).then(function(s){
        if(s.ok)return s;
        if(n<10&&(s.code==='gh_api')){return new Promise(function(res){setTimeout(res,3000)}).then(function(){return waitReady(n+1)});}
        return s;
      });
    }
    mark('fork','done');mark('sec','run');
    return waitReady(0);
  }).then(function(r){
    if(r.skip)return r;
    if(!r.ok){fail('sec',state,r);throw 0;}
    mark('sec','done');mark('run','run');
    return api('github/run',{token:gh,repo:repo,branch:branch});
  }).then(function(r){
    if(!r.skip){
      if(!r.ok){fail('run',state,r);throw 0;}
      mark('run','done');
      if(r.warnings&&r.warnings.length)warn.push(lang==='en'?'Open the Actions tab of your repository and enable the workflow if it is not running.':'اگر رانر اجرا نشد، تب Actions ریپوی خود را باز کنید و ورک‌فلو را فعال کنید.');
      $('rActions').href=r.actionsUrl;$('rActions').classList.remove('hidden');
    }
    $('bar').style.width='100%';
    $('rUrl').textContent=url;$('rAdmin').textContent=url+'/admin';$('rPass').textContent=creds.adminPassword;
    $('rRepoRow').classList.toggle('hidden',!useGh);$('rRepo').textContent=repo;
    $('rOpen').href=url;
    if(warn.length){$('rWarn').textContent='⚠️ '+warn.join(' ');$('rWarn').classList.remove('hidden');}
    $('progressCard').classList.add('hidden');$('resultCard').classList.remove('hidden');
    $('resultCard').scrollIntoView({behavior:'smooth',block:'start'});
    S.installing=false;refresh();
  }).catch(function(e){if(e!==0){$('errBox').classList.remove('hidden');$('errBox').textContent='❌ '+(lang==='en'?'Unexpected error.':'خطای غیرمنتظره.');$('retryRow').classList.remove('hidden');S.installing=false;refresh();}});
}
$('install').onclick=install;$('retry').onclick=install;

var cps=document.querySelectorAll('[data-copy]');
for(var c=0;c<cps.length;c++){cps[c].onclick=function(){var t=$(this.getAttribute('data-copy')).textContent;var b=this;
  (navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){var o=b.textContent;b.textContent='✓';setTimeout(function(){b.textContent=o},1200)}).catch(function(){});};}
$('dlCreds').onclick=function(){
  var txt='Arizo Self\\n\\nPanel: '+$('rUrl').textContent+'\\nAdmin: '+$('rAdmin').textContent+'\\nPassword: '+$('rPass').textContent+($('rRepo').textContent?'\\nRepository: '+$('rRepo').textContent:'')+'\\n';
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain'}));a.download='arizo-self-credentials.txt';document.body.appendChild(a);a.click();a.remove();
};
refresh();
})();
</script>
</body>
</html>`;
}
