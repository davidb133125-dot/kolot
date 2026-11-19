/* סוכנות הבלשים — מצב מחובר (Supabase): כניסה, שמירה בשרת, לוח מורה ולוח מנהל.
   נטען רק כש-config.js מגדיר את window.SOCHNUT_CONFIG. בלי זה המשחק עובד במצב הדגמה. */
(function(){
"use strict";
const CFG=window.SOCHNUT_CONFIG;if(!CFG)return;
const DOMAIN="@sochnut.school";
const WORDS=["lion","tiger","bear","fox","owl","wolf","deer","frog","duck","fish","bird","star","moon","sun","tree","lamp","kite","boat","rose","leaf"];
const genPass=()=>WORDS[Math.floor(Math.random()*WORDS.length)]+String(10+Math.floor(Math.random()*90));
let sb=null,me=null,cls=null,pushT=null,staffTab="dash",dashClass=null,adminClass=null,created=[],flashMsg="";

const s=document.createElement("script");
s.src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js";
s.onload=()=>{sb=window.supabase.createClient(CFG.url,CFG.key,{auth:{persistSession:true,autoRefreshToken:true}});boot();};
s.onerror=()=>showLogin("אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו לרענן את הדף.");
document.head.appendChild(s);

/* ---------- login ---------- */
function loginBox(){let el=document.getElementById("login");if(!el){el=document.createElement("div");el.id="login";el.setAttribute("dir","rtl");document.body.appendChild(el);}return el;}
function showLogin(msg){const el=loginBox();el.hidden=false;document.body.style.overflow="hidden";
  el.innerHTML=`<div class="wrap"><div><div class="eyebrow" style="color:#f4c26b">רובע המילים</div><h2>סוכנות הבלשים</h2><p style="margin:6px 0 0;color:#dfe7f3;font-size:18px">כניסה לבלשים, למורים ולמנהלים.</p></div>
  <form class="card stack" id="loginForm" autocomplete="on"><div><label for="lgUser">שם משתמש</label><input id="lgUser" autocomplete="username" autocapitalize="none" spellcheck="false" dir="ltr" placeholder="למשל: he1a07" required></div>
  <div><label for="lgPass">סיסמה</label><input id="lgPass" type="password" autocomplete="current-password" dir="ltr" required></div>
  ${msg?`<p class="fb no" style="margin:0">${esc(msg)}</p>`:""}<button class="btn primary" id="lgGo" type="submit" style="width:100%">כניסה ←</button>
  <p class="demo" style="margin:0">שכחתם את הסיסמה? פנו למורה. המורה יכול לאפס אותה.</p></form></div>`;
  document.getElementById("loginForm").onsubmit=async e=>{e.preventDefault();const u=document.getElementById("lgUser").value.trim().toLowerCase(),p=document.getElementById("lgPass").value;
    const b=document.getElementById("lgGo");b.disabled=true;b.textContent="נכנסים…";
    if(!sb){showLogin("אין חיבור לשרת. נסו לרענן את הדף.");return;}
    const {error}=await sb.auth.signInWithPassword({email:u+DOMAIN,password:p});
    if(error){showLogin(/invalid/i.test(error.message)?"שם המשתמש או הסיסמה לא נכונים. בדקו ונסו שוב.":"הכניסה נכשלה: "+error.message);return;}
    afterLogin();};
  setTimeout(()=>{const f=document.getElementById("lgUser");f&&f.focus();},50);}
async function boot(){const {data:{session}}=await sb.auth.getSession();if(session)afterLogin();else showLogin();}
async function afterLogin(){
  const {data:{user}}=await sb.auth.getUser();if(!user){showLogin();return;}
  const {data:prof,error}=await sb.from("profiles").select("*").eq("id",user.id).single();
  if(error||!prof){await sb.auth.signOut();showLogin("החשבון הזה לא מוגדר במערכת. פנו למנהל.");return;}
  me=prof;window.ONLINE_ME=me;loginBox().hidden=true;document.body.style.overflow="";
  if(me.role==="student"){await loadStudent();}else{showStaff();}
}
async function logout(){try{await pushNow();}catch(e){}await sb.auth.signOut();me=null;location.reload();}
window.onlineLogout=logout;

/* ---------- student: progress & settings ---------- */
const LKEY=()=>KEY+":"+me.id;
async function loadStudent(){
  const {data}=await sb.from("progress").select("data,updated_at").eq("user_id",me.id).maybeSingle();
  let local=null;try{local=JSON.parse(localStorage.getItem(LKEY())||"null");}catch(e){}
  const server=data&&data.data&&Object.keys(data.data).length?data.data:null;
  const pick=(local&&server)?((local._t||0)>(server._t||0)?local:server):(server||local);
  P=Object.assign(fresh(),pick||{});P.name=P.name||me.full_name.split(" ")[0];P.tutorial=!!P.tutorial;
  await loadSettings();buildMap();screen="home";render();
  if(!server||(pick===local&&local))pushSoon();
}
async function loadSettings(){
  let c=null;if(me.class_id){const r=await sb.from("classes").select("name,gate_mode,unlock_all").eq("id",me.class_id).maybeSingle();c=r.data;}
  const {data:p}=await sb.from("profiles").select("gate_mode,unlock_all").eq("id",me.id).single();
  cls=c;P.teacher={gate:(p&&p.gate_mode)||(c&&c.gate_mode)||"auto",unlockAll:(p&&p.unlock_all!=null)?p.unlock_all:!!(c&&c.unlock_all)};
}
document.addEventListener("visibilitychange",()=>{if(!me||me.role!=="student")return;if(document.hidden)pushNow();else loadSettings().then(()=>{if(!document.getElementById("world").hidden)updateHud();else render();});});
window.addEventListener("pagehide",()=>{if(me&&me.role==="student")pushNow();});
function pushSoon(){clearTimeout(pushT);pushT=setTimeout(pushNow,1500);setSync("שומר…");}
async function pushNow(){clearTimeout(pushT);if(!me||me.role!=="student")return;
  const data=JSON.parse(JSON.stringify(P));delete data.teacher;
  const {error}=await sb.from("progress").upsert({user_id:me.id,data,updated_at:new Date().toISOString()});
  setSync(error?"לא נשמר — בדקו חיבור":"נשמר ✓",!!error);}
function setSync(t,bad){const el=document.getElementById("syncState");if(el){el.textContent=t;el.style.color=bad?"var(--stamp)":"var(--good)";}}
// every save also goes to the server
const baseSave=save;
save=function(){P._t=Date.now();try{if(me)localStorage.setItem(LKEY(),JSON.stringify(P));}catch(e){}if(me&&me.role==="student")pushSoon();else if(!me)baseSave();};
window.onlineMeExtra=function(){if(!me)return "";return `<div class="card stack" style="padding-top:12px"><div><b>${esc(me.full_name)}</b><div class="muted">שם משתמש: <span dir="ltr">${esc(me.username)}</span>${cls?` · כיתה: ${esc(cls.name)}`:""}</div></div><div class="muted" id="syncState" style="font-weight:700">ההתקדמות נשמרת בחשבון שלכם</div><button class="btn ghost" id="logoutBtn" style="width:100%">יציאה מהחשבון</button></div>`;};
document.addEventListener("click",e=>{if(e.target&&e.target.id==="logoutBtn")logout();});

/* ---------- staff shell ---------- */
function showStaff(){document.querySelector(".nav").hidden=true;document.getElementById("app").style.paddingBottom="16px";renderStaff();}
async function renderStaff(){
  const el=document.getElementById("screen");$("#avatarBtn").textContent=me.full_name.charAt(0);
  const tabs=[["dash","לוח המורה"],...(me.role==="admin"?[["admin","ניהול"]]:[]),["play","לנסות את המשחק"]];
  el.innerHTML=`<div class="wrap stack"><div class="staffbar"><div><b>${esc(me.full_name)}</b> <span class="muted">· ${me.role==="admin"?"מנהל":"מורה"}</span></div><button class="btn ghost" id="stOut" style="min-height:40px;padding:6px 14px">יציאה</button></div>
  <div class="seg">${tabs.map(([k,h])=>`<button data-st="${k}" aria-pressed="${staffTab===k}">${h}</button>`).join("")}</div>
  ${flashMsg?`<p class="fb ok" style="margin:0">${esc(flashMsg)}</p>`:""}<div id="staffBody"><p class="muted">טוען…</p></div></div>`;
  flashMsg="";
  document.getElementById("stOut").onclick=logout;
  el.querySelectorAll("[data-st]").forEach(b=>b.onclick=()=>{staffTab=b.dataset.st;renderStaff();});
  try{if(staffTab==="dash")await renderDash();else if(staffTab==="admin")await renderAdmin();else renderPlay();}
  catch(err){document.getElementById("staffBody").innerHTML=`<p class="fb no">שגיאה: ${esc(err.message||err)}</p>`;}
}
const errMsg=e=>(e&&(e.message||e.details))||"שגיאה";
function renderPlay(){document.getElementById("staffBody").innerHTML=`<div class="card"><p style="margin:0 0 10px">כאן אפשר לשחק כמו תלמיד ולראות את המשחק מבפנים. ההתקדמות במצב הזה נשמרת רק בדפדפן הזה, ולא נכנסת לנתוני הכיתה.</p><button class="btn primary" id="playGo" style="width:100%">לשחק ←</button></div>`;
  document.getElementById("playGo").onclick=()=>{const prevMe=me;me=null;window.ONLINE_ME=null;load();P.name=P.name||prevMe.full_name.split(" ")[0];P.tutorial=P.tutorial||false;buildMap();document.querySelector(".nav").hidden=false;screen="home";render();
    const back=document.createElement("button");back.className="btn primary staffback";back.textContent="← חזרה ללוח";back.onclick=()=>{me=prevMe;window.ONLINE_ME=me;back.remove();staffTab="dash";showStaff();};document.body.appendChild(back);};}

/* ---------- teacher dashboard (real data) ---------- */
async function renderDash(){
  const body=document.getElementById("staffBody");
  const {data:classes,error}=await sb.from("classes").select("*").order("name");if(error)throw error;
  if(!classes.length){body.innerHTML=`<div class="card"><p style="margin:0">${me.role==="admin"?"עוד אין כיתות. צרו כיתה בלשונית ״ניהול״.":"עוד לא שויכה אליכם כיתה. פנו למנהל."}</p></div>`;return;}
  if(!dashClass||!classes.some(c=>c.id===dashClass))dashClass=classes[0].id;const c=classes.find(x=>x.id===dashClass);
  const {data:studs}=await sb.from("profiles").select("id,full_name,username,gate_mode,unlock_all").eq("class_id",c.id).eq("role","student").order("full_name");
  const ids=(studs||[]).map(x=>x.id);let prog=[];if(ids.length){const r=await sb.from("progress").select("user_id,data,updated_at").in("user_id",ids);prog=r.data||[];}
  const pm=Object.fromEntries(prog.map(p=>[p.user_id,p]));const cols=skillCols();
  const rows=(studs||[]).map(st=>{const d=(pm[st.id]||{}).data||{};const sk={},cases={},words={};
    Object.entries(d.skill||{}).forEach(([k,r])=>{if(r.n)sk[k]=Math.round(r.s/r.n*100);});LESSONS.forEach(l=>{if(d.solved&&d.solved[l.id])cases[l.id]=d.solved[l.id];});
    Object.entries(d.words||{}).forEach(([k,v])=>{if(v&&v.length)words[k]=v[v.length-1].t;});
    return{st,sk,cases,words,pts:d.points||0,last:(pm[st.id]||{}).updated_at,solvedN:LESSONS.filter(l=>d.solved&&d.solved[l.id]&&d.solved[l.id].done).length};});
  const avg=cols.map(col=>{const v=rows.map(x=>x.sk[col.l+":"+col.sk]).filter(v=>v!=null);return{col,a:v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length):null,n:v.length};}).filter(x=>x.a!=null).sort((a,b)=>a.a-b.a);
  const ago=t=>{if(!t)return "עוד לא נכנס";const m=Math.round((Date.now()-new Date(t))/60000);return m<60?`לפני ${Math.max(1,m)} דק׳`:m<1440?`לפני ${Math.round(m/60)} שע׳`:`לפני ${Math.round(m/1440)} ימים`;};
  const caseCell=v=>v==null?`<td class="hc none">—</td>`:`<td class="hc ${v.done?"g":v.best>=60?"y":"r"}">${v.perfect?"★ ":""}${v.best}%${v.done?"":" ✗"}</td>`;
  const gsel=(id,val,withNone)=>`<select data-g="${id}">${withNone?`<option value="" ${val==null?"selected":""}>כמו הכיתה</option>`:""}<option value="auto" ${val==="auto"?"selected":""}>אוטומטי</option><option value="open" ${val==="open"?"selected":""}>פתוח</option><option value="locked" ${val==="locked"?"selected":""}>נעול</option></select>`;
  body.innerHTML=`${classes.length>1?`<div class="row" style="align-items:center"><b>כיתה:</b><select id="dashSel">${classes.map(x=>`<option value="${x.id}" ${x.id===c.id?"selected":""}>${esc(x.name)}</option>`).join("")}</select></div>`:""}
  <h2 style="font-size:26px;color:var(--navy);margin-top:6px">${esc(c.name)} · ${rows.length} תלמידים</h2>
  <div class="section-title">איפה הכיתה מתקשה</div><div class="card"><ol style="margin:0;padding-inline-start:20px">${avg.slice(0,3).map(x=>`<li><b>${L(x.col.l).title.split(":")[0]} · ${x.col.h}</b> — ממוצע ${x.a}% (${x.n} תלמידים)</li>`).join("")||"<li>עוד אין מספיק נתונים.</li>"}</ol></div>
  <div class="section-title">קצב הכיתה</div><div class="card stack" style="padding-top:12px">
   <div><b>השער לאזור 2</b><div class="seg" style="margin-top:6px">${["auto","open","locked"].map(g=>`<button data-cg="${g}" aria-pressed="${c.gate_mode===g}">${{auto:"אוטומטי (אחרי כל הבתים)",open:"פתוח לכולם",locked:"נעול לכולם"}[g]}</button>`).join("")}</div></div>
   <div><b>סדר הבתים</b><div class="seg" style="margin-top:6px"><button data-cu="0" aria-pressed="${!c.unlock_all}">סדר מחייב</button><button data-cu="1" aria-pressed="${c.unlock_all}">פתיחה חופשית</button></div>
   <p class="muted" style="margin:6px 0 0;font-size:14px">״סדר מחייב״: כל בית נפתח אחרי הקודם. ״פתיחה חופשית״: כל הבתים פתוחים, למשל לחזרה לפני מבחן. אפשר לקבוע חריגה לתלמיד מסוים בטבלה למטה.</p></div></div>
  <div class="section-title">התקדמות בתיקים</div><div class="tscroll"><table class="htable"><tr><th>תלמיד</th><th>נכנס</th><th>תיקים</th><th>נקודות</th>${LESSONS.map((l,i)=>`<th>${i+1}. ${l.title.split(":")[0]}</th>`).join("")}</tr>
   ${rows.map(x=>`<tr><th>${esc(x.st.full_name)}</th><td class="muted">${ago(x.last)}</td><td>${x.solvedN}/${LESSONS.length}</td><td>${x.pts}</td>${LESSONS.map(l=>caseCell(x.cases[l.id])).join("")}</tr>`).join("")||`<tr><td colspan="9">אין עדיין תלמידים בכיתה.</td></tr>`}</table></div>
  <div class="section-title">מפת מיומנויות</div><p class="muted" style="margin:0;font-size:14px">ירוק — 80% ומעלה, צהוב — 60–79%, אדום — מתחת ל־60%.</p>
  <div class="tscroll"><table class="htable"><tr><th>תלמיד</th>${cols.map(col=>`<th><small>${L(col.l).title.split(":")[0]}</small>${col.h}</th>`).join("")}</tr>${rows.map(x=>`<tr><th>${esc(x.st.full_name)}</th>${cols.map(col=>heat(x.sk[col.l+":"+col.sk]??null)).join("")}</tr>`).join("")}</table></div>
  <div class="section-title">במילים שלי</div><div class="list">${rows.flatMap(x=>Object.entries(x.words).map(([lid,t])=>`<div class="li" style="display:block"><b>${esc(x.st.full_name)}</b> · <small class="muted">${L(lid)?L(lid).title.split(":")[0]:lid}</small><p style="margin:4px 0 0">״${esc(t)}״</p></div>`)).join("")||`<p class="muted">עוד אין תשובות.</p>`}</div>
  <div class="section-title">תלמידים: חריגות וסיסמאות</div><div class="tscroll"><table class="htable"><tr><th>תלמיד</th><th>שם משתמש</th><th>שער לאזור 2</th><th>סדר הבתים</th><th>סיסמה</th></tr>
   ${rows.map(x=>`<tr><th>${esc(x.st.full_name)}</th><td dir="ltr">${esc(x.st.username)}</td><td>${gsel(x.st.id,x.st.gate_mode,true)}</td><td><select data-u="${x.st.id}"><option value="" ${x.st.unlock_all==null?"selected":""}>כמו הכיתה</option><option value="0" ${x.st.unlock_all===false?"selected":""}>סדר מחייב</option><option value="1" ${x.st.unlock_all===true?"selected":""}>פתיחה חופשית</option></select></td><td><button class="btn soft mini" data-rp="${x.st.id}" data-nm="${esc(x.st.full_name)}">איפוס</button></td></tr>`).join("")}</table></div>`;
  const sel=document.getElementById("dashSel");if(sel)sel.onchange=()=>{dashClass=sel.value;renderStaff();};
  const setC=async(g,u)=>{const {error}=await sb.rpc("set_class_settings",{p_class:c.id,p_gate:g,p_unlock:u});flashMsg=error?errMsg(error):"ההגדרה נשמרה. התלמידים יראו אותה בכניסה הבאה למשחק.";renderStaff();};
  body.querySelectorAll("[data-cg]").forEach(b=>b.onclick=()=>setC(b.dataset.cg,c.unlock_all));
  body.querySelectorAll("[data-cu]").forEach(b=>b.onclick=()=>setC(c.gate_mode,b.dataset.cu==="1"));
  const setS=async(id)=>{const g=body.querySelector(`[data-g="${id}"]`).value||null,u=body.querySelector(`[data-u="${id}"]`).value;
    const {error}=await sb.rpc("set_student_settings",{p_user:id,p_gate:g,p_unlock:u===""?null:u==="1"});flashMsg=error?errMsg(error):"החריגה לתלמיד נשמרה.";renderStaff();};
  body.querySelectorAll("[data-g],[data-u]").forEach(x=>x.onchange=()=>setS(x.dataset.g||x.dataset.u));
  body.querySelectorAll("[data-rp]").forEach(b=>b.onclick=async()=>{const np=genPass();const {error}=await sb.rpc("reset_password",{p_user:b.dataset.rp,p_password:np});
    flashMsg=error?errMsg(error):`הסיסמה החדשה של ${b.dataset.nm}: ${np}`;renderStaff();});
}

/* ---------- admin ---------- */
async function renderAdmin(){
  const body=document.getElementById("staffBody");
  const [{data:classes},{data:staff},{data:allStud}]=await Promise.all([sb.from("classes").select("*").order("name"),sb.from("profiles").select("id,full_name,username,role").in("role",["teacher","admin"]).order("full_name"),sb.from("profiles").select("id,class_id").eq("role","student")]);
  const teachers=(staff||[]).filter(x=>x.role==="teacher");const count=id=>(allStud||[]).filter(x=>x.class_id===id).length;
  if(!adminClass&&classes&&classes.length)adminClass=classes[0].id;
  let studs=[];if(adminClass){const r=await sb.from("profiles").select("id,full_name,username").eq("class_id",adminClass).eq("role","student").order("full_name");studs=r.data||[];}
  const tOpts=sel=>`<option value="">— בלי מורה —</option>`+teachers.map(t=>`<option value="${t.id}" ${t.id===sel?"selected":""}>${esc(t.full_name)}</option>`).join("");
  body.innerHTML=`
  ${created.length?`<div class="card" id="printArea"><div class="section-title">חשבונות חדשים — להדפסה ולחלוקה</div><p class="muted" style="margin:4px 0 8px">הסיסמאות מוצגות רק עכשיו. הדפיסו או העתיקו אותן לפני שעוזבים את הדף.</p>
    <div class="tscroll"><table class="htable"><tr><th>שם</th><th>שם משתמש</th><th>סיסמה</th></tr>${created.map(x=>`<tr><th>${esc(x.name)}</th><td dir="ltr">${esc(x.user)}</td><td dir="ltr">${esc(x.pass)}</td></tr>`).join("")}</table></div>
    <div class="row noprint" style="margin-top:10px"><button class="btn primary" id="prBtn">הדפסה</button><button class="btn soft" id="cpBtn">העתקה</button><button class="btn ghost" id="clrBtn">סיימתי</button></div></div>`:""}
  <div class="section-title">כיתות</div><div class="card stack" style="padding-top:12px">
   ${(classes||[]).map(c=>`<div class="admrow"><div style="flex:1;min-width:0"><b>${esc(c.name)}</b> <span class="muted" dir="ltr">(${esc(c.code)})</span><div class="muted" style="font-size:14px">${count(c.id)} תלמידים</div></div><select data-ct="${c.id}">${tOpts(c.teacher_id)}</select></div>`).join("")||`<p class="muted" style="margin:0">עוד אין כיתות.</p>`}
   <form id="newClass" class="admform"><b>כיתה חדשה</b><input id="ncName" placeholder="שם הכיתה, למשל ה׳1" required><input id="ncCode" dir="ltr" placeholder="קוד באנגלית, למשל he1" pattern="[a-z][a-z0-9]{0,7}" required><select id="ncTeacher">${tOpts(null)}</select><button class="btn primary" type="submit">ליצור כיתה</button>
   <small class="muted">הקוד הוא תחילת שם המשתמש של כל תלמיד בכיתה: he1a01, he1a02…</small></form></div>
  <div class="section-title">מורים</div><div class="card stack" style="padding-top:12px">
   ${teachers.map(t=>`<div class="admrow"><div style="flex:1"><b>${esc(t.full_name)}</b> <span class="muted" dir="ltr">${esc(t.username)}</span></div><button class="btn soft mini" data-rp="${t.id}" data-nm="${esc(t.full_name)}" data-us="${esc(t.username)}">איפוס סיסמה</button></div>`).join("")||`<p class="muted" style="margin:0">עוד אין מורים.</p>`}
   <form id="newTeacher" class="admform"><b>מורה חדש</b><input id="ntName" placeholder="שם מלא" required><input id="ntUser" dir="ltr" placeholder="שם משתמש באנגלית, למשל cohen" pattern="[a-z][a-z0-9_]{2,19}" required><button class="btn primary" type="submit">ליצור חשבון מורה</button></form></div>
  <div class="section-title">תלמידים</div><div class="card stack" style="padding-top:12px">
   ${classes&&classes.length?`<div class="row" style="align-items:center"><b>כיתה:</b><select id="admSel">${classes.map(c=>`<option value="${c.id}" ${c.id===adminClass?"selected":""}>${esc(c.name)}</option>`).join("")}</select></div>
   <form id="newStud" class="admform"><b>הוספת תלמידים לכיתה</b><textarea id="nsNames" rows="6" placeholder="שם מלא של כל תלמיד בשורה נפרדת" required></textarea><button class="btn primary" type="submit">ליצור חשבונות</button>
   <small class="muted">לכל תלמיד ייווצרו שם משתמש וסיסמה, ויוצגו לכם בטבלה להדפסה.</small></form>
   <div class="list">${studs.map(st=>`<div class="admrow"><div style="flex:1;min-width:0"><b>${esc(st.full_name)}</b> <span class="muted" dir="ltr">${esc(st.username)}</span></div><button class="btn soft mini" data-rp="${st.id}" data-nm="${esc(st.full_name)}" data-us="${esc(st.username)}">איפוס סיסמה</button><button class="btn ghost mini" data-del="${st.id}" data-nm="${esc(st.full_name)}">מחיקה</button></div>`).join("")||`<p class="muted" style="margin:0">אין עדיין תלמידים בכיתה הזאת.</p>`}</div>`
   :`<p class="muted" style="margin:0">קודם צרו כיתה.</p>`}<div id="delBox"></div></div>`;
  const $b=id=>document.getElementById(id);
  if($b("prBtn")){$b("prBtn").onclick=()=>window.print();$b("clrBtn").onclick=()=>{created=[];renderStaff();};
    $b("cpBtn").onclick=()=>{const t=created.map(x=>`${x.name}\t${x.user}\t${x.pass}`).join("\n");navigator.clipboard.writeText(t).then(()=>{$b("cpBtn").textContent="הועתק ✓";},()=>{$b("cpBtn").textContent="לא הצליח, סמנו והעתיקו ידנית";});};}
  body.querySelectorAll("[data-ct]").forEach(sl=>sl.onchange=async()=>{const c=classes.find(x=>x.id===sl.dataset.ct);const {error}=await sb.rpc("admin_save_class",{p_id:c.id,p_name:c.name,p_code:c.code,p_teacher:sl.value||null});flashMsg=error?errMsg(error):"המורה שויך לכיתה.";renderStaff();});
  $b("newClass").onsubmit=async e=>{e.preventDefault();const {error}=await sb.rpc("admin_save_class",{p_id:null,p_name:$b("ncName").value,p_code:$b("ncCode").value.toLowerCase(),p_teacher:$b("ncTeacher").value||null});flashMsg=error?(/duplicate|unique/i.test(error.message)?"כבר יש כיתה עם השם או הקוד האלה.":errMsg(error)):"הכיתה נוצרה.";renderStaff();};
  $b("newTeacher").onsubmit=async e=>{e.preventDefault();const pw=genPass(),u=$b("ntUser").value.toLowerCase(),n=$b("ntName").value;const {error}=await sb.rpc("admin_create_user",{p_username:u,p_full_name:n,p_role:"teacher",p_class:null,p_password:pw});
    if(error)flashMsg=errMsg(error);else{created=[...created,{name:n,user:u,pass:pw}];flashMsg="חשבון המורה נוצר.";}renderStaff();};
  if($b("admSel"))$b("admSel").onchange=()=>{adminClass=$b("admSel").value;renderStaff();};
  if($b("newStud"))$b("newStud").onsubmit=async e=>{e.preventDefault();const c=classes.find(x=>x.id===adminClass);const names=$b("nsNames").value.split("\n").map(x=>x.trim()).filter(Boolean);
    const btn=e.submitter||$b("newStud").querySelector("button");btn.disabled=true;
    const {data:ex}=await sb.from("profiles").select("username").like("username",c.code+"a%");let n=Math.max(0,...(ex||[]).map(x=>+x.username.slice(c.code.length+1)||0));const fails=[];
    for(const name of names){btn.textContent=`יוצר… ${names.indexOf(name)+1}/${names.length}`;let ok=false;
      for(let tries=0;tries<5&&!ok;tries++){n++;const u=`${c.code}a${String(n).padStart(2,"0")}`,pw=genPass();const {error}=await sb.rpc("admin_create_user",{p_username:u,p_full_name:name,p_role:"student",p_class:c.id,p_password:pw});
        if(!error){created.push({name,user:u,pass:pw});ok=true;}else if(!/קיים|23505|duplicate/i.test(error.message)){fails.push(name+": "+error.message);break;}}}
    flashMsg=fails.length?`חלק מהחשבונות לא נוצרו: ${fails.join(" · ")}`:`נוצרו ${names.length} חשבונות.`;renderStaff();};
  body.querySelectorAll("[data-rp]").forEach(b=>b.onclick=async()=>{const np=genPass();const {error}=await sb.rpc("reset_password",{p_user:b.dataset.rp,p_password:np});
    if(error)flashMsg=errMsg(error);else{created=[...created,{name:b.dataset.nm+" (סיסמה חדשה)",user:b.dataset.us,pass:np}];flashMsg="הסיסמה אופסה.";}renderStaff();});
  body.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{$b("delBox").innerHTML=`<div class="confirm"><b>למחוק את ${esc(b.dataset.nm)}?</b> כל ההתקדמות שלו תימחק. אי אפשר לבטל.<div class="row" style="margin-top:8px"><button class="btn primary" id="delYes" style="background:var(--stamp)">כן, למחוק</button><button class="btn soft" id="delNo">ביטול</button></div></div>`;
    $b("delNo").onclick=()=>{$b("delBox").innerHTML="";};$b("delYes").onclick=async()=>{const {error}=await sb.rpc("admin_delete_user",{p_user:b.dataset.del});flashMsg=error?errMsg(error):"התלמיד נמחק.";renderStaff();};});
}
})();
