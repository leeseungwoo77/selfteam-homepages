/* ===================== 지점·구성원 지표분석 =====================
   데이터: Apps Script 수집기(매일 06시)가 정리한 JSON
     branch.rows = [지점, 연도, 월, 지표, 값]              ← 고객지표 시트 (2024~2026)
     member.rows = [지점, 월(YYYY-MM), 영역, 구성원, 역할, 월초, 신규, 리퍼+, 리퍼-, 종료, 보정, 월말,
                    이탈률(재계산), 프미율, 콤마수, 인당콤마, 주5회, 주4회, 주3회, 상담비율, 양식]
   저장: 수집기가 Firestore metricData/{지점명} 문서에 { payload(JSON 문자열), updatedAt } 기록
   권한: 팀장·뷰어는 4개 지점 전부, 원장님은 자기 지점 문서만 읽기 (firestore.rules)
================================================================ */

const BRANCH_ORDER = ["돈암", "행당", "별내", "다산"];
// 낮을수록 좋은 지표
const LOWER_BETTER = new Set(["전체종료", "초기종료", "이탈율", "초기이탈율", "누적이탈율", "누적초기이탈율", "이탈율(개별)", "churn", "end", "refOut"]);
const PCT_METRICS = new Set(["이탈율", "초기이탈율", "누적이탈율", "누적초기이탈율", "프리미엄율", "이탈율(개별)", "초기학생비율", "단기학생비율", "중기학생비율", "장기학생비율", "수익율", "churn", "premium"]);

const KPI_CARDS = [
  { m: "월말", label: "월말 학생" },
  { m: "신규/복회", label: "신규/복회" },
  { m: "전체종료", label: "전체종료" },
  { m: "이탈율", label: "이탈율" },
  { m: "초기이탈율", label: "초기이탈율" },
  { m: "누적이탈율", label: "누적이탈율" },
  { m: "프리미엄율", label: "프리미엄율" },
  { m: "월말콤마", label: "월말콤마" },
];
// 연초~기준월 누적 비교: sum=합계, avg=평균
const YTD_ROWS = [
  { m: "신규/복회", agg: "sum" }, { m: "전체종료", agg: "sum" }, { m: "초기종료", agg: "sum" },
  { m: "월말", agg: "avg" }, { m: "이탈율", agg: "avg" }, { m: "초기이탈율", agg: "avg" },
  { m: "프리미엄율", agg: "avg" }, { m: "이탈율(개별)", agg: "avg" }, { m: "월말콤마", agg: "avg" },
];
const MEMBER_METRICS = {
  상담관리: [
    { k: "churn", label: "이탈률" }, { k: "net", label: "순증(신규−종료)" },
    { k: "finish", label: "월말 인원" }, { k: "new", label: "신규/복회" }, { k: "end", label: "종료" },
  ],
  개별지도: [
    { k: "churn", label: "이탈률" }, { k: "premium", label: "프미율" }, { k: "perComma", label: "인당콤마" },
    { k: "net", label: "순증(신규−종료)" }, { k: "finish", label: "월말 인원" }, { k: "end", label: "종료" },
  ],
};
const SERIES_COLORS = ["#1B5A96", "#2F6B14", "#8E1E5C", "#E8A33C", "#3B9BE8", "#8E7CC3", "#0F8A7E", "#C0396A"];
const MIN_BASE = 5;
// 평균 대비 ▲▼ 판정 허용폭 (이 안이면 '비슷')
const TOL = { churn: 0.02, premium: 0.02, perComma: 1, net: 0.5, finish: 0.5, new: 0.5, end: 0.5 }; // 월초 5명 미만이면 이탈률 표본이 작다고 표시

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isPct = m => PCT_METRICS.has(m);
function fmt(v, m) {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  if (isPct(m)) return (v * 100).toFixed(1) + "%";
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
function fmtDiff(d, m) {
  if (d === null || d === undefined || Number.isNaN(d)) return "-";
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  const a = Math.abs(d);
  return sign + (isPct(m) ? (a * 100).toFixed(1) + "%p" : (a >= 1000 ? Math.round(a).toLocaleString() : (Number.isInteger(a) ? a : a.toFixed(1))));
}
// good / bad / flat
function judge(d, m, tol = 0) {
  if (d === null || d === undefined || Number.isNaN(d) || Math.abs(d) <= tol) return "flat";
  const better = LOWER_BETTER.has(m) ? d < 0 : d > 0;
  return better ? "good" : "bad";
}
const toneColor = { good: "var(--green-deep)", bad: "var(--danger)", flat: "var(--text-muted)" };
const toneBg = { good: "#E6F4D9", bad: "#FBE3EC", flat: "#F4F6F2" };
const ymLabel = ym => `${ym.slice(2, 4)}.${Number(ym.slice(5))}월`;
const ymAdd = (ym, n) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const shortBranch = n => String(n || "").replace(/점$/, "").replace(/^에듀플렉스\s*/, "").trim();

/* ---------- 데이터 정리 ---------- */
export function buildModel(payload) {
  const B = {}; // B[지점][지표][연도][월] = 값
  (payload.branch?.rows || []).forEach(([br, y, mo, metric, v]) => {
    if (v === "" || v === null) return;
    ((((B[br] ||= {})[metric] ||= {})[y] ||= {})[mo] = Number(v));
  });
  const H = payload.member?.header || [];
  const ix = name => H.indexOf(name);
  const col = {
    br: 0, ym: 1, area: 2, name: 3, role: 4, start: ix("월초"), new: ix("신규"), refIn: ix("리퍼+"), refOut: ix("리퍼-"),
    end: ix("종료"), adj: ix("보정"), finish: ix("월말"), churn: ix("이탈률(재계산)"), premium: ix("프미율"),
    comma: ix("콤마수"), perComma: ix("인당콤마"),
  };
  const M = []; // 구성원 레코드
  (payload.member?.rows || []).forEach(r => {
    const n = k => (col[k] >= 0 && r[col[k]] !== "" && r[col[k]] !== null ? Number(r[col[k]]) : null);
    const ym = typeof r[1] === "string" ? r[1].slice(0, 7) : new Date(r[1]).toISOString().slice(0, 7);
    const rec = {
      branch: r[0], ym, area: r[2], name: String(r[3]).trim(), role: r[4],
      start: n("start"), new: n("new"), refIn: n("refIn"), refOut: n("refOut"), end: n("end"), finish: n("finish"),
      churn: n("churn"), premium: n("premium"), comma: n("comma"), perComma: n("perComma"),
    };
    rec.net = rec.new !== null || rec.end !== null ? (rec.new || 0) - (rec.end || 0) : null; // 순증 = 신규 − 종료 (담당 이동 제외)
    M.push(rec);
  });
  return { B, M };
}

function kv(model, br, metric, y, mo) {
  const v = model.B[br]?.[metric]?.[y]?.[mo];
  return v === undefined ? null : v;
}
function latestBranchMonth(model, br) {
  const ys = Object.keys(model.B[br]?.["월말"] || {}).map(Number).sort((a, b) => b - a);
  for (const y of ys) {
    const ms = Object.keys(model.B[br]["월말"][y]).map(Number).sort((a, b) => b - a);
    if (ms.length) return { y, mo: ms[0] };
  }
  return null;
}

/* ---------- 매니저 평균 (원장·교실장집계 제외) ---------- */
function managerAvg(recs, k) {
  const mgr = recs.filter(r => r.role === "매니저");
  if (!mgr.length) return null;
  if (k === "churn") { // 인원 가중: 매니저 전체 종료 ÷ 매니저 전체 월초
    const s = mgr.reduce((a, r) => a + (r.start || 0), 0);
    return s ? mgr.reduce((a, r) => a + (r.end || 0), 0) / s : null;
  }
  const vals = mgr.map(r => r[k]).filter(v => v !== null && v !== undefined);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/* ---------- SVG 라인차트 ---------- */
function lineChart(series, labels, metric, opts = {}) {
  const W = 860, Hh = opts.height || 240, pL = 48, pR = 16, pT = 18, pB = 28;
  const vals = series.flatMap(s => s.values).filter(v => v !== null && v !== undefined);
  if (!vals.length) return `<div class="empty-state">표시할 데이터가 없습니다.</div>`;
  let max = Math.max(...vals), min = Math.min(0, ...vals);
  if (max === min) max = min + 1;
  const x = i => pL + i * ((W - pL - pR) / Math.max(1, labels.length - 1));
  const y = v => Hh - pB - ((v - min) / (max - min)) * (Hh - pT - pB);
  let g = "";
  for (let i = 0; i <= 4; i++) {
    const v = min + (max - min) * i / 4;
    g += `<line x1="${pL}" x2="${W - pR}" y1="${y(v)}" y2="${y(v)}" stroke="#E5EDE0"/><text x="${pL - 6}" y="${y(v) + 4}" font-size="10" fill="#8A9A82" text-anchor="end">${esc(fmt(v, metric))}</text>`;
  }
  labels.forEach((l, i) => { g += `<text x="${x(i)}" y="${Hh - 8}" font-size="10" fill="#8A9A82" text-anchor="middle">${esc(l)}</text>`; });
  series.forEach(s => {
    let d = "", pen = false;
    s.values.forEach((v, i) => { if (v === null || v === undefined) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i)},${y(v)} `; pen = true; });
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.bold ? 3 : 2}" ${s.dash ? 'stroke-dasharray="6 4"' : ""} opacity="${s.faint ? 0.55 : 1}"/>`;
    s.values.forEach((v, i) => { if (v !== null && v !== undefined) g += `<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${s.color}"><title>${esc(s.name)} · ${esc(labels[i])}: ${esc(fmt(v, metric))}</title></circle>`; });
  });
  const legend = `<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;margin-bottom:6px;">${series.map(s => `<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:14px;height:3px;background:${s.color};display:inline-block;${s.dash ? "background:repeating-linear-gradient(90deg," + s.color + " 0 4px,transparent 4px 7px);" : ""}"></span>${esc(s.name)}</span>`).join("")}</div>`;
  return legend + `<svg viewBox="0 0 ${W} ${Hh}" style="width:100%;height:auto;display:block;">${g}</svg>`;
}

/* ---------- 스타일 (모듈 전용, 한 번만 주입) ---------- */
function injectStyle() {
  if (document.getElementById("dmStyle")) return;
  const st = document.createElement("style");
  st.id = "dmStyle";
  st.textContent = `
  .dm-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px}
  .dm-bar select{padding:7px 10px;border:1px solid var(--border);border-radius:8px;font:inherit;font-size:13px;background:#fff}
  .dm-seg{display:inline-flex;border:1px solid var(--border);border-radius:9px;overflow:hidden;background:#fff}
  .dm-seg button{border:0;background:transparent;padding:8px 14px;font:inherit;font-size:13px;cursor:pointer;color:var(--text-muted)}
  .dm-seg button.on{background:var(--blue-deep);color:#fff;font-weight:700}
  .dm-meta{font-size:12px;color:var(--text-muted);margin-left:auto}
  .dm-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px}
  .dm-kpi{border:1px solid var(--border);border-radius:10px;padding:12px 14px;background:#fff}
  .dm-kpi .l{font-size:12px;color:var(--text-muted)}
  .dm-kpi .v{font-size:22px;font-weight:800;margin:4px 0 6px;font-variant-numeric:tabular-nums}
  .dm-kpi .d{font-size:11.5px;display:flex;flex-direction:column;gap:2px;font-variant-numeric:tabular-nums}
  .dm-tbl td,.dm-tbl th{padding:7px 9px;font-variant-numeric:tabular-nums;white-space:nowrap}
  .dm-tbl td.num,.dm-tbl th.num{text-align:right}
  .dm-tbl tr.avg td{background:#F4FAEF;font-weight:700}
  .dm-tbl tr.dir td{color:var(--text-muted);background:#FAFAF7}
  .dm-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}
  .dm-heat td.cell{text-align:center;border:2px solid #fff;border-radius:6px;min-width:62px}
  .dm-ins{margin:0;padding-left:18px;font-size:13.5px;line-height:1.75}
  .dm-ins li b{font-weight:700}
  .dm-note{font-size:11.5px;color:var(--text-muted);margin:10px 0 0;line-height:1.6}
  .dm-scroll{overflow-x:auto}
  `;
  document.head.appendChild(st);
}

/* =================================================================
   메인 렌더러
   ctx = { state, db, doc, getDoc, setDoc, isLeader, canViewAll, COLOR_HEX, section }
================================================================= */
export async function renderDeepMetric(main, ctx) {
  injectStyle();
  const { section } = ctx;
  main.innerHTML = `<div class="page-header"><div>
      <h1><span class="badge" style="background:${ctx.COLOR_HEX?.[section.color] || "var(--blue-bright)"}"></span>${esc(section.label)}</h1>
      <p>${esc(section.desc)}</p></div>
    </div>
    <div id="dmBody"><div class="card"><div class="empty-state">데이터를 불러오는 중...</div></div></div>`;

  let payload;
  try { payload = await loadPayload(ctx); }
  catch (e) {
    document.getElementById("dmBody").innerHTML = `<div class="card"><div class="empty-state">${esc(e.message)}</div></div>`;
    return;
  }
  const model = buildModel(payload);
  const myBranch = shortBranch(ctx.state.profile.branchName);
  const branches = ctx.canViewAll
    ? BRANCH_ORDER.filter(b => model.B[b] || model.M.some(r => r.branch === b))
    : [myBranch].filter(b => model.B[b] || model.M.some(r => r.branch === b));
  if (!branches.length) {
    document.getElementById("dmBody").innerHTML = `<div class="card"><div class="empty-state">열람 가능한 지점 데이터가 없습니다.</div></div>`;
    return;
  }
  const ui = { branch: branches[0], tab: "branch", area: "상담관리", metricB: "월말", metricM: "churn", ym: null };
  const memberMonths = br => [...new Set(model.M.filter(r => r.branch === br).map(r => r.ym))].sort();

  function defaultYm(br) {
    const lb = latestBranchMonth(model, br);
    return lb ? `${lb.y}-${String(lb.mo).padStart(2, "0")}` : memberMonths(br).slice(-1)[0];
  }
  ui.ym = defaultYm(ui.branch);

  function monthOptions(br) {
    const set = new Set(memberMonths(br));
    Object.entries(model.B[br]?.["월말"] || {}).forEach(([y, ms]) => Object.keys(ms).forEach(mo => set.add(`${y}-${String(mo).padStart(2, "0")}`)));
    return [...set].sort().reverse();
  }

  function draw() {
    const nowYm = new Date().toISOString().slice(0, 7);
    const body = document.getElementById("dmBody");
    body.innerHTML = `
      <div class="dm-bar">
        ${branches.length > 1 ? `<select id="dmBranch">${branches.map(b => `<option ${b === ui.branch ? "selected" : ""}>${b}</option>`).join("")}</select>` : `<strong>${esc(ui.branch)}점</strong>`}
        <select id="dmYm">${monthOptions(ui.branch).map(m => `<option value="${m}" ${m === ui.ym ? "selected" : ""}>${m.slice(0, 4)}년 ${Number(m.slice(5))}월 기준</option>`).join("")}</select>
        <div class="dm-seg"><button data-tab="branch" class="${ui.tab === "branch" ? "on" : ""}">지점 전체</button><button data-tab="member" class="${ui.tab === "member" ? "on" : ""}">구성원</button></div>
        ${ui.ym === nowYm ? `<span class="dm-pill" style="background:#FFF4DC;color:#9A6A00;">진행 중인 달 · 확정 전</span>` : ""}
        <span class="dm-meta">데이터 기준 ${payload.updatedAt ? esc(String(payload.updatedAt).slice(0, 16).replace("T", " ")) : "-"} (매일 06시 자동 갱신)</span>
      </div>
      <div id="dmTab"></div>`;
    if (document.getElementById("dmBranch")) document.getElementById("dmBranch").onchange = e => { ui.branch = e.target.value; ui.ym = defaultYm(ui.branch); draw(); };
    document.getElementById("dmYm").onchange = e => { ui.ym = e.target.value; draw(); };
    body.querySelectorAll(".dm-seg button[data-tab]").forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; draw(); });
    const tab = document.getElementById("dmTab");
    if (ui.tab === "branch") drawBranch(tab); else drawMember(tab);
  }

  /* ---------------- 지점 전체 ---------------- */
  function drawBranch(el) {
    const br = ui.branch, y = Number(ui.ym.slice(0, 4)), mo = Number(ui.ym.slice(5));
    const prev = ymAdd(ui.ym, -1), py = Number(prev.slice(0, 4)), pmo = Number(prev.slice(5));
    const cards = KPI_CARDS.map(c => {
      const v = kv(model, br, c.m, y, mo), vPrev = kv(model, br, c.m, py, pmo), vLy = kv(model, br, c.m, y - 1, mo);
      const dM = v !== null && vPrev !== null ? v - vPrev : null, dY = v !== null && vLy !== null ? v - vLy : null;
      return `<div class="dm-kpi"><div class="l">${c.label}</div><div class="v">${fmt(v, c.m)}</div>
        <div class="d"><span style="color:${toneColor[judge(dM, c.m)]}">전월 ${fmtDiff(dM, c.m)}</span><span style="color:${toneColor[judge(dY, c.m)]}">전년 ${fmtDiff(dY, c.m)}</span></div></div>`;
    }).join("");

    const ytd = YTD_ROWS.map(r => {
      const agg = yr => {
        const vs = []; for (let i = 1; i <= mo; i++) { const v = kv(model, br, r.m, yr, i); if (v !== null) vs.push(v); }
        if (!vs.length) return null;
        const s = vs.reduce((a, b) => a + b, 0); return r.agg === "sum" ? s : s / vs.length;
      };
      const a = agg(y), b = agg(y - 1), d = a !== null && b !== null ? a - b : null, t = judge(d, r.m);
      return { ...r, a, b, d, t };
    });
    const ytdRows = ytd.map(r => `<tr><td>${r.m} <span style="color:var(--text-muted);font-size:11px;">${r.agg === "sum" ? "합계" : "월평균"}</span></td>
      <td class="num">${fmt(r.a, r.m)}</td><td class="num">${fmt(r.b, r.m)}</td>
      <td class="num" style="color:${toneColor[r.t]};font-weight:700;">${fmtDiff(r.d, r.m)}</td>
      <td><span class="dm-pill" style="background:${toneBg[r.t]};color:${toneColor[r.t]}">${r.t === "good" ? "개선" : r.t === "bad" ? "악화" : "유지"}</span></td></tr>`).join("");

    const metricsAvail = Object.keys(model.B[br] || {}).filter(m => Object.keys(model.B[br][m]).length);
    if (!metricsAvail.includes(ui.metricB)) ui.metricB = metricsAvail[0];
    const years = [y - 2, y - 1, y];
    const series = years.map((yr, i) => ({
      name: `${yr}년`, color: ["#B7C4AE", "#3B9BE8", "#1B5A96"][i], bold: yr === y, faint: yr === y - 2,
      values: Array.from({ length: 12 }, (_, k) => { if (yr === y && k + 1 > mo) return null; return kv(model, br, ui.metricB, yr, k + 1); }),
    }));

    el.innerHTML = `
      <div class="card"><h2>${y}년 ${mo}월 핵심 지표 <span style="font-weight:400;color:var(--text-muted);font-size:12px;">· 전월 / 전년 동월 대비</span></h2><div class="dm-kpis">${cards}</div></div>
      <div class="card"><h2>지금 봐야 할 것</h2><ul class="dm-ins">${branchInsights(br, y, mo, ytd).map(s => `<li>${s}</li>`).join("") || "<li>특이사항 없음</li>"}</ul></div>
      <div class="card"><h2>연초~${mo}월 누적: ${y}년 vs ${y - 1}년</h2>
        <div class="dm-scroll"><table class="dm-tbl"><thead><tr><th>지표</th><th class="num">${y}년</th><th class="num">${y - 1}년</th><th class="num">차이</th><th>판정</th></tr></thead><tbody>${ytdRows}</tbody></table></div></div>
      <div class="card"><h2 style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">3개년 흐름
        <select id="dmMetricB" style="padding:6px 10px;border:1px solid var(--border);border-radius:8px;font:inherit;font-size:13px;">${metricsAvail.map(m => `<option ${m === ui.metricB ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></h2>
        ${lineChart(series, Array.from({ length: 12 }, (_, i) => `${i + 1}월`), ui.metricB)}</div>`;
    document.getElementById("dmMetricB").onchange = e => { ui.metricB = e.target.value; draw(); };
  }

  function branchInsights(br, y, mo, ytd) {
    const out = [];
    const v = (m, yy = y, mm = mo) => kv(model, br, m, yy, mm);
    // 1) 학생 수: 전년 동월 대비
    const fin = v("월말"), finLy = v("월말", y - 1);
    if (fin !== null && finLy !== null) out.push(`월말 학생 <b>${fin}명</b>, 전년 동월 ${finLy}명 대비 <b style="color:${toneColor[judge(fin - finLy, "월말")]}">${fmtDiff(fin - finLy, "월말")}명</b>.`);
    // 2) 이탈율 악화
    const ch = v("이탈율"), chLy = v("이탈율", y - 1);
    if (ch !== null && chLy !== null && ch - chLy >= 0.03) out.push(`이번 달 이탈율 <b>${fmt(ch, "이탈율")}</b> — 전년 동월(${fmt(chLy, "이탈율")})보다 <b style="color:var(--danger)">${fmtDiff(ch - chLy, "이탈율")}</b> 높습니다. 구성원 탭에서 누구 담당에서 종료가 나왔는지 확인하세요.`);
    // 3) 초기이탈
    const ie = v("초기종료"), endAll = v("전체종료");
    if (ie !== null && endAll) out.push(`전체종료 ${endAll}명 중 초기(3개월 이내) 종료 <b>${ie}명(${Math.round(ie / endAll * 100)}%)</b>${ie / endAll >= 0.5 ? " — 등록 직후 관리(첫 4주) 점검이 우선입니다." : "."}`);
    // 4) 신규 vs 종료 누적 균형
    const nw = ytd.find(r => r.m === "신규/복회"), en = ytd.find(r => r.m === "전체종료");
    if (nw?.a !== null && en?.a !== null && nw && en) {
      const gap = nw.a - en.a;
      out.push(`연초~${mo}월 신규/복회 ${Math.round(nw.a)}명 vs 종료 ${Math.round(en.a)}명 → 순증 <b style="color:${gap >= 0 ? "var(--green-deep)" : "var(--danger)"}">${gap >= 0 ? "+" : ""}${Math.round(gap)}명</b>${nw.b !== null && en.b !== null ? ` (작년 같은 기간 ${Math.round(nw.b - en.b) >= 0 ? "+" : ""}${Math.round(nw.b - en.b)}명)` : ""}.`);
    }
    // 5) 3개월 연속 하락
    const last3 = [0, 1, 2].map(k => { const d = ymAdd(`${y}-${String(mo).padStart(2, "0")}`, -k); return v("월말", Number(d.slice(0, 4)), Number(d.slice(5))); });
    const prev3 = (() => { const d = ymAdd(`${y}-${String(mo).padStart(2, "0")}`, -3); return v("월말", Number(d.slice(0, 4)), Number(d.slice(5))); })();
    if ([...last3, prev3].every(x => x !== null) && last3[0] < last3[1] && last3[1] < last3[2] && last3[2] < prev3) out.push(`월말 학생이 <b style="color:var(--danger)">3개월 연속 감소</b> 중입니다 (${prev3}→${last3[2]}→${last3[1]}→${last3[0]}).`);
    // 6) 프리미엄율
    const pr = v("프리미엄율"), prLy = v("프리미엄율", y - 1);
    if (pr !== null && prLy !== null && Math.abs(pr - prLy) >= 0.05) out.push(`프리미엄율 ${fmt(pr, "프리미엄율")}, 전년 동월 대비 <b style="color:${toneColor[judge(pr - prLy, "프리미엄율")]}">${fmtDiff(pr - prLy, "프리미엄율")}</b>.`);
    return out;
  }

  /* ---------------- 구성원 ---------------- */
  function drawMember(el) {
    const br = ui.branch;
    const months = memberMonths(br).filter(m => m <= ui.ym).slice(-6);
    const recsOf = ym => model.M.filter(r => r.branch === br && r.ym === ym && r.area === ui.area && r.role !== "교실장집계");
    const cur = recsOf(ui.ym);
    const metrics = MEMBER_METRICS[ui.area];
    if (!metrics.some(m => m.k === ui.metricM)) ui.metricM = "churn";
    const mLabel = metrics.find(m => m.k === ui.metricM).label;

    const seg = `<div class="dm-bar" style="margin-bottom:12px;">
      <div class="dm-seg" id="dmArea">${["상담관리", "개별지도"].map(a => `<button data-a="${a}" class="${ui.area === a ? "on" : ""}">${a}</button>`).join("")}</div>
      <span class="dm-meta" style="margin-left:0;">평균 = 매니저만 (원장 직접 담당분은 회색 줄로 따로 표시) · 이탈률 = 종료 ÷ 월초 (담당 이동 '리퍼-'는 이탈에서 제외)</span></div>`;

    if (!cur.length) {
      el.innerHTML = seg + `<div class="card"><div class="empty-state">${ui.ym.slice(0, 4)}년 ${Number(ui.ym.slice(5))}월 구성원 데이터가 없습니다. (등록현황에 해당 월 탭이 있는지 확인)</div></div>`;
      bindArea(); return;
    }

    // 1) 기준월 표
    const isIndiv = ui.area === "개별지도";
    const cols = [
      { k: "start", l: "월초" }, { k: "new", l: "신규" }, { k: "ref", l: "리퍼 ±" }, { k: "end", l: "종료" }, { k: "finish", l: "월말" },
      { k: "churn", l: "이탈률", cmp: true }, ...(isIndiv ? [{ k: "premium", l: "프미율", cmp: true }, { k: "perComma", l: "인당콤마", cmp: true }] : []),
      { k: "net", l: "순증(신규−종료)", cmp: true },
    ];
    const avg = {}; cols.forEach(c => { if (c.k !== "ref") avg[c.k] = managerAvg(cur, c.k); });
    const cell = (r, c) => {
      if (c.k === "ref") return `${r.refIn ? "+" + r.refIn : ""}${r.refIn && r.refOut ? " / " : ""}${r.refOut ? "−" + r.refOut : ""}` || "-";
      const v = r[c.k];
      let s = fmt(v, c.k);
      if (c.cmp && r.role === "매니저" && v !== null && avg[c.k] !== null) {
        const t = judge(v - avg[c.k], c.k, TOL[c.k] ?? 0);
        s = `<span style="color:${toneColor[t]};font-weight:700;">${s} ${t === "good" ? "▲" : t === "bad" ? "▼" : ""}</span>`;
      }
      if (c.k === "churn" && r.start !== null && r.start < MIN_BASE && r.start > 0) s += ` <span title="월초 ${MIN_BASE}명 미만 — 한 명만 나가도 비율이 크게 흔들립니다" style="color:var(--text-muted);font-size:10.5px;">표본↓</span>`;
      return s;
    };
    const ordered = [...cur.filter(r => r.role === "매니저").sort((a, b) => (b.start || 0) - (a.start || 0)), ...cur.filter(r => r.role === "원장")];
    const tbl = `<div class="dm-scroll"><table class="dm-tbl"><thead><tr><th>구성원</th>${cols.map(c => `<th class="num">${c.l}</th>`).join("")}</tr></thead><tbody>
      ${ordered.filter(r => r.role === "매니저").map(r => `<tr><td><b>${esc(r.name)}</b></td>${cols.map(c => `<td class="num">${cell(r, c)}</td>`).join("")}</tr>`).join("")}
      <tr class="avg"><td>매니저 평균</td>${cols.map(c => `<td class="num">${c.k === "ref" ? "" : fmt(avg[c.k], c.k)}</td>`).join("")}</tr>
      ${ordered.filter(r => r.role === "원장").map(r => `<tr class="dir"><td>원장 (직접 담당)</td>${cols.map(c => `<td class="num">${cell(r, c)}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div><p class="dm-note">▲ 매니저 평균보다 좋음 · ▼ 평균보다 나쁨. 이탈률 평균은 인원 가중(매니저 전체 종료 ÷ 매니저 전체 월초)입니다.</p>`;

    // 2) 히트맵: 구성원 × 최근 6개월
    const names = [...new Set(months.flatMap(m => recsOf(m).map(r => r.name)))];
    const mgrNames = names.filter(n => months.some(m => recsOf(m).find(r => r.name === n)?.role === "매니저"));
    const dirNames = names.filter(n => !mgrNames.includes(n));
    const avgByMonth = Object.fromEntries(months.map(m => [m, managerAvg(recsOf(m), ui.metricM)]));
    const heatRow = (n, isDir) => {
      const vals = months.map(m => recsOf(m).find(r => r.name === n)?.[ui.metricM] ?? null);
      const diffs = vals.map((v, i) => v !== null && avgByMonth[months[i]] !== null ? v - avgByMonth[months[i]] : null);
      const valid = diffs.filter(d => d !== null);
      const meanDiff = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
      const tone = d => isDir ? "flat" : judge(d, ui.metricM, TOL[ui.metricM] ?? 0);
      return `<tr ${isDir ? 'class="dir"' : ""}><td>${isDir ? "원장 (직접 담당)" : `<b>${esc(n)}</b>`}</td>
        ${vals.map((v, i) => `<td class="cell" style="background:${v === null ? "transparent" : toneBg[tone(diffs[i])]};color:${toneColor[tone(diffs[i])]};font-weight:600;">${v === null ? "·" : fmt(v, ui.metricM)}</td>`).join("")}
        <td class="num" style="color:${toneColor[tone(meanDiff)]};font-weight:700;">${isDir ? "-" : fmtDiff(meanDiff, ui.metricM)}</td></tr>`;
    };
    const heat = `<div class="dm-scroll"><table class="dm-tbl dm-heat"><thead><tr><th>구성원</th>${months.map(m => `<th class="num" style="text-align:center;">${ymLabel(m)}</th>`).join("")}<th class="num">평균 대비<br>(기간)</th></tr></thead><tbody>
      ${mgrNames.map(n => heatRow(n, false)).join("")}
      <tr class="avg"><td>매니저 평균</td>${months.map(m => `<td class="num" style="text-align:center;">${fmt(avgByMonth[m], ui.metricM)}</td>`).join("")}<td></td></tr>
      ${dirNames.map(n => heatRow(n, true)).join("")}</tbody></table></div>`;

    // 3) 흐름 차트
    const series = [
      ...mgrNames.map((n, i) => ({ name: n, color: SERIES_COLORS[i % SERIES_COLORS.length], values: months.map(m => recsOf(m).find(r => r.name === n)?.[ui.metricM] ?? null) })),
      { name: "매니저 평균", color: "#22301A", dash: true, bold: true, values: months.map(m => avgByMonth[m]) },
    ];

    el.innerHTML = seg + `
      <div class="card"><h2>지금 봐야 할 것 · ${ui.area}</h2><ul class="dm-ins">${memberInsights(cur, months, recsOf).map(s => `<li>${s}</li>`).join("") || "<li>평균에서 크게 벗어난 구성원이 없습니다.</li>"}</ul></div>
      <div class="card"><h2>${Number(ui.ym.slice(5))}월 구성원별 지표</h2>${tbl}</div>
      <div class="card"><h2 style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">최근 ${months.length}개월 · 평균 대비
        <select id="dmMetricM" style="padding:6px 10px;border:1px solid var(--border);border-radius:8px;font:inherit;font-size:13px;">${metrics.map(m => `<option value="${m.k}" ${m.k === ui.metricM ? "selected" : ""}>${m.label}</option>`).join("")}</select></h2>
        ${heat}<div style="margin-top:18px;">${lineChart(series, months.map(ymLabel), ui.metricM, { height: 220 })}</div>
        <p class="dm-note">${esc(mLabel)} 기준. 칸 색은 그 달 매니저 평균 대비(초록=좋음, 분홍=나쁨). 매니저 구성이 바뀐 달은 평균 비교 대상도 달라집니다.</p></div>`;
    bindArea();
    document.getElementById("dmMetricM").onchange = e => { ui.metricM = e.target.value; draw(); };
  }
  function bindArea() {
    document.querySelectorAll("#dmArea button").forEach(b => b.onclick = () => { ui.area = b.dataset.a; draw(); });
  }

  function memberInsights(cur, months, recsOf) {
    const out = [];
    const mgr = cur.filter(r => r.role === "매니저");
    const avgCh = managerAvg(cur, "churn");
    // 1) 이탈률 평균 초과 (표본 충분 + 2명 이상 종료)
    mgr.filter(r => r.start >= MIN_BASE && r.churn !== null && avgCh !== null && r.churn - avgCh >= 0.05 && (r.end || 0) >= 2)
      .sort((a, b) => b.churn - a.churn)
      .forEach(r => out.push(`<b>${esc(r.name)}</b> 이탈률 <b style="color:var(--danger)">${fmt(r.churn, "churn")}</b> (종료 ${r.end}/${r.start}명) — 매니저 평균 ${fmt(avgCh, "churn")}보다 ${fmtDiff(r.churn - avgCh, "churn")}.`));
    // 2) 3개월 연속 평균 초과 이탈
    const last3 = months.slice(-3);
    if (last3.length === 3) mgr.forEach(r => {
      const over = last3.every(m => { const rs = recsOf(m); const me = rs.find(x => x.name === r.name); const a = managerAvg(rs, "churn"); return me && me.churn !== null && a !== null && me.churn > a && (me.end || 0) > 0; });
      if (over) out.push(`<b>${esc(r.name)}</b>: 최근 3개월 연속 이탈률이 평균보다 높습니다 — 일회성이 아니라 패턴입니다. 1:1 미팅 주제로 올려볼 만합니다.`);
    });
    // 3) 리퍼(담당 이동) 큰 폭
    cur.filter(r => (r.refOut || 0) >= 3 || (r.refIn || 0) >= 3).forEach(r => out.push(`<b>${esc(r.role === "원장" ? "원장" : r.name)}</b> 담당 이동 ${r.refIn ? "+" + r.refIn : ""}${r.refIn && r.refOut ? " / " : ""}${r.refOut ? "−" + r.refOut : ""}명 — 이탈이 아닌 재배정입니다. 이 달 인원·순증 비교는 재배정 영향을 감안해서 보세요.`));
    // 4) 개별지도: 프미율·인당콤마 평균 이하
    if (ui.area === "개별지도") {
      const ap = managerAvg(cur, "premium"), ac = managerAvg(cur, "perComma");
      mgr.forEach(r => {
        if (r.premium !== null && ap !== null && ap - r.premium >= 0.1) out.push(`<b>${esc(r.name)}</b> 프미율 ${fmt(r.premium, "premium")} — 평균(${fmt(ap, "premium")})보다 ${fmtDiff(r.premium - ap, "premium")}. 온리 개별지도 비중이 높은지 확인.`);
        if (r.perComma !== null && ac !== null && r.finish >= MIN_BASE && ac - r.perComma >= 3) out.push(`<b>${esc(r.name)}</b> 인당콤마 ${fmt(r.perComma, "perComma")} — 평균(${fmt(ac, "perComma")})보다 ${fmtDiff(r.perComma - ac, "perComma")}.`);
      });
    }
    // 5) 원장 직접 담당 비중
    const dir = cur.find(r => r.role === "원장");
    const tot = cur.reduce((a, r) => a + (r.finish || 0), 0);
    if (dir && tot && dir.finish / tot >= 0.2) out.push(`원장 직접 담당이 ${ui.area} 월말의 <b>${Math.round(dir.finish / tot * 100)}%</b>(${dir.finish}명)입니다. 원장 업무 시간 배분 관점에서 점검 포인트입니다.`);
    // 6) 우수
    const best = mgr.filter(r => r.start >= MIN_BASE && (r.end || 0) === 0 && (r.new || 0) + (r.refIn || 0) > 0);
    if (best.length) out.push(`<b style="color:var(--green-deep)">${best.map(r => esc(r.name)).join(", ")}</b>: 종료 0명 + 인원 유입 — 이번 달 잘한 사례로 공유할 만합니다.`);
    return out;
  }

  draw();
}

/* ---------- 데이터 로드 (Firestore metricData/{지점}) ---------- */
async function loadPayload(ctx) {
  const scopes = ctx.canViewAll ? BRANCH_ORDER : [shortBranch(ctx.state.profile.branchName)];
  const snaps = await Promise.all(scopes.map(b => ctx.getDoc(ctx.doc(ctx.db, "metricData", b)).catch(() => null)));
  const merged = { branch: { header: null, rows: [] }, member: { header: null, rows: [] }, updatedAt: null };
  snaps.forEach(snap => {
    if (!snap || !snap.exists()) return;
    const d = snap.data();
    const p = JSON.parse(d.payload || "{}");
    merged.branch.header ||= p.branch?.header; merged.member.header ||= p.member?.header;
    merged.branch.rows.push(...(p.branch?.rows || [])); merged.member.rows.push(...(p.member?.rows || []));
    const u = d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : d.updatedAt;
    if (u && (!merged.updatedAt || u < merged.updatedAt)) merged.updatedAt = u;
  });
  if (!merged.branch.rows.length && !merged.member.rows.length) {
    throw new Error(ctx.isLeader
      ? "아직 수집된 데이터가 없습니다. Apps Script에서 collectAll을 한 번 실행한 뒤 새로고침해주세요."
      : "아직 이 지점 데이터가 준비되지 않았습니다. 팀장님께 문의해주세요.");
  }
  if (merged.updatedAt) { // 한국 시간으로 표시
    const k = new Date(new Date(merged.updatedAt).getTime() + 9 * 3600 * 1000);
    merged.updatedAt = k.toISOString().slice(0, 16);
  }
  return merged;
}
