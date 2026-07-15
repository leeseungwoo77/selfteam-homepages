import {
  auth, db, onAuthStateChanged, signOut,
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, where, orderBy, serverTimestamp,
  storage, ref, uploadBytes, getDownloadURL, deleteObject
} from "./firebase-init.js";

/* ===================== 섹션(메뉴) 정의 =====================
   collectionName : Firestore 컬렉션 이름
   scope           : 'team'(팀 전체 공용) | 'branch'(지점별 데이터)
   writable        : 'leader'(팀장만 작성/수정) | 'all'(전원 작성/수정)
                      | 'leader-and-branch'(팀장은 전체, 팀원은 자기 지점만)
   fields          : 입력 폼 구성
   columns         : 목록 표에 보여줄 필드 (없으면 fields 앞 3개 사용)
=========================================================== */
const SECTIONS = [
  { key:"schedule", label:"팀장 일정", group:"일정 · 미팅", color:"green",
    collectionName:"schedules", scope:"team", writable:"leader",
    desc:"구글 시트에 기록된 팀장 일정을 월별로 보여줍니다.",
    isScheduleSheet:true,
    fields:[
      { key:"date", label:"날짜", type:"date" },
      { key:"time", label:"시간", type:"time" },
      { key:"title", label:"일정 제목", type:"text" },
      { key:"memo", label:"메모", type:"textarea" }
    ], columns:["date","time","title"] },

  { key:"teamMeeting", label:"팀 회의 일지", group:"일정 · 미팅", color:"green",
    collectionName:"teamMeetings", scope:"team", writable:"all",
    desc:"팀 전체 회의 내용을 기록합니다.",
    cardView:true, headerFields:["title","date","attendees"],
    extraLink:{ label:"회의록 원본 열기", url:"https://docs.google.com/presentation/d/1xrRu5zRNooseQG-fHA4D8v6SDc1eEsDmMgc7e2pDhUs/edit" },
    fields:[
      { key:"title", label:"제목", type:"text" },
      { key:"date", label:"날짜", type:"date" },
      { key:"attendees", label:"참석자", type:"text" },
      { key:"agenda", label:"안건", type:"textarea" },
      { key:"decisions", label:"결정사항", type:"textarea" },
      { key:"followUp", label:"후속조치", type:"textarea" },
      { key:"images", label:"회의 슬라이드 이미지", type:"imageUpload" }
    ], columns:["date","attendees","agenda"] },

  { key:"directorMeeting", label:"지점 원장 미팅 일지", group:"일정 · 미팅", color:"green",
    collectionName:"directorMeetings", scope:"branch", writable:"leader",
    desc:"지점 원장님과의 미팅 내용을 기록합니다. (팀장만 열람 가능)",
    hasBranchSubmenu:true, leaderOnly:true, cardView:true, headerFields:["title","date","branchName","director"],
    fields:[
      { key:"title", label:"제목", type:"text" },
      { key:"date", label:"날짜", type:"date" },
      { key:"branchId", label:"지점", type:"branchSelect" },
      { key:"director", label:"원장 이름", type:"text" },
      { key:"content", label:"미팅 내용", type:"richtext" },
      { key:"followUp", label:"후속조치", type:"textarea" }
    ], columns:["date","branchName","director"] },

  { key:"memberMeeting", label:"지점 팀원 개별 미팅 일지", group:"일정 · 미팅", color:"green",
    collectionName:"memberMeetings", scope:"branch", writable:"leader-and-branch",
    desc:"지점 팀원과의 개별 미팅 내용을 기록합니다.",
    hasBranchSubmenu:true, cardView:true, headerFields:["title","date","branchName","memberName"],
    fields:[
      { key:"title", label:"제목", type:"text" },
      { key:"date", label:"날짜", type:"date" },
      { key:"branchId", label:"지점", type:"branchSelect" },
      { key:"memberName", label:"팀원 이름", type:"text" },
      { key:"content", label:"미팅 내용", type:"textarea" },
      { key:"followUp", label:"후속조치", type:"textarea" }
    ], columns:["date","branchName","memberName"] },

  { key:"performance", label:"지점 성과 지표", group:"성과", color:"blue",
    collectionName:"performance", scope:"branch", writable:"leader-and-branch",
    desc:"상상플렉스 고객지표 시트를 지점별로 보여줍니다.",
    isBranchSheet:true, hasBranchSubmenu:true,
    fields:[
      { key:"period", label:"기간 (예: 2026-07)", type:"text" },
      { key:"branchId", label:"지점", type:"branchSelect" },
      { key:"revenue", label:"매출(만원)", type:"number" },
      { key:"newRegistrations", label:"신규 등록 수", type:"number" },
      { key:"renewalRate", label:"재등록률(%)", type:"number" },
      { key:"consultationConversion", label:"상담 전환율(%)", type:"number" },
      { key:"memo", label:"메모", type:"textarea" }
    ], columns:["period","branchName","revenue","newRegistrations","renewalRate"] },

  { key:"notice", label:"팀 공지사항", group:"소통", color:"magenta",
    collectionName:"notices", scope:"team", writable:"leader",
    desc:"팀 전체 공지사항입니다.",
    fields:[
      { key:"title", label:"제목", type:"text" },
      { key:"important", label:"중요 공지", type:"importanceSelect" },
      { key:"content", label:"내용", type:"textarea" }
    ], columns:["title","important"] },

  { key:"operation", label:"지점 운영 자료", group:"자료실", color:"neutral",
    desc:"지점별 자료 링크를 한눈에 모아 봅니다. (지점 × 양식 표)",
    isOpsGrid:true },

  { key:"leadership", label:"리더십 자료", group:"자료실", color:"neutral",
    collectionName:"leadership", scope:"team", writable:"leader",
    desc:"리더십 관련 자료입니다.",
    fields:[
      { key:"title", label:"제목", type:"text" },
      { key:"content", label:"내용", type:"textarea" },
      { key:"fileLink", label:"첨부 링크(URL)", type:"text" }
    ], columns:["title"] },

  { key:"study", label:"팀 스터디 자료", group:"자료실", color:"neutral",
    collectionName:"study", scope:"team", writable:"all",
    desc:"팀 스터디 자료를 함께 공유합니다.",
    fields:[
      { key:"title", label:"제목", type:"text" },
      { key:"content", label:"내용", type:"textarea" },
      { key:"fileLink", label:"첨부 링크(URL)", type:"text" }
    ], columns:["title"] },

  { key:"roster", label:"지점 인적 구성", group:"자료실", color:"neutral",
    desc:"지점별 인력 이동 현황(잔류/신규입사/이동/퇴사)을 색깔 그대로 보여줍니다.",
    isRosterGrid:true }
];
const GROUP_ORDER = ["일정 · 미팅", "성과", "소통", "자료실"];
const COLOR_HEX = { blue:"var(--blue-bright)", green:"var(--green-bright)", magenta:"var(--magenta-bright)", neutral:"#9CA88F" };

/* ===================== 팀장 일정 - 구글 시트 연동 (OAuth) =====================
   회사 도메인으로만 공유된 시트라, 사용자가 직접 구글 로그인(OAuth)해서
   Sheets API로 읽어옵니다. 시트 하나(연도별 탭)에 그 해의 모든 날짜가
   열로 쭉 이어져 있고, 1행의 "MM. DD(요일)" 텍스트에서 월을 읽어 필터링합니다.
=========================================================== */
const SPREADSHEET_ID = "1pH_H7JJhT_1rMUyO05FSbHJeYuHUWoZ2gRBw8XWcea0";
const PERFORMANCE_SPREADSHEET_ID = "1uequoelbdG3zLzo-FgqbDsPIlb7NGFIasS_82ZzE6iA";
const GOOGLE_CLIENT_ID = "708745145673-j0ljnhqsl7gg0djq5p9j7uop040thqbe.apps.googleusercontent.com";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly";
const LOCATION_COLORS = {
  "에듀본사": "#E03C3C", "상상": "#F5A623", "전능": "#3B9BE8",
  "돈암": "#3FA33F", "행당": "#D3339C", "별내": "#E8D227", "다산": "#8E1E1E"
};
function matchLocationColor(str) {
  if (LOCATION_COLORS[str]) return LOCATION_COLORS[str];
  for (const key of Object.keys(LOCATION_COLORS)) {
    if (str.includes(key)) return LOCATION_COLORS[key];
  }
  return null;
}

let googleTokenClient = null;
let googleAccessToken = null;

function ensureGoogleTokenClient() {
  if (googleTokenClient || !window.google) return;
  googleTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: () => {} // requestGoogleAuth 안에서 그때그때 덮어씀
  });
}

function requestGoogleAuth() {
  return new Promise((resolve, reject) => {
    ensureGoogleTokenClient();
    if (!googleTokenClient) { reject(new Error("구글 로그인 모듈을 아직 불러오지 못했습니다. 잠시 후 다시 시도해주세요.")); return; }
    googleTokenClient.callback = (resp) => {
      if (resp.error) { reject(new Error("구글 인증에 실패했습니다: " + resp.error)); return; }
      googleAccessToken = resp.access_token;
      resolve(googleAccessToken);
    };
    googleTokenClient.requestAccessToken({ prompt: googleAccessToken ? "" : "consent" });
  });
}

async function fetchSheetValues(spreadsheetId, sheetName) {
  if (!googleAccessToken) await requestGoogleAuth();
  const range = encodeURIComponent(`${sheetName}!A1:ZZ3000`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  let res = await fetch(url, { headers: { Authorization: `Bearer ${googleAccessToken}` } });
  if (res.status === 401) {
    googleAccessToken = null;
    await requestGoogleAuth();
    res = await fetch(url, { headers: { Authorization: `Bearer ${googleAccessToken}` } });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `시트를 불러오지 못했습니다 (${res.status})`);
  }
  const data = await res.json();
  return data.values || [];
}

function parseMonthFromHeader(str) {
  const m = String(str).match(/^(\d{1,2})\s*\.\s*(\d{1,2})/);
  return m ? parseInt(m[1], 10) : null;
}

async function renderScheduleSheet(section) {
  const main = document.getElementById("mainContent");
  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}</h1>
        <p>${section.desc}</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <a href="https://docs.google.com/spreadsheets/d/1pH_H7JJhT_1rMUyO05FSbHJeYuHUWoZ2gRBw8XWcea0/edit" target="_blank" rel="noopener" class="btn small secondary" style="text-decoration:none;display:inline-flex;align-items:center;">원본 시트 열기</a>
        <button class="btn small" id="googleAuthBtn" type="button">${googleAccessToken ? "다시 연결" : "구글 계정으로 연결"}</button>
        <select id="yearSelect" style="padding:8px 12px;border-radius:8px;border:1.5px solid var(--border);font-family:var(--font-display);font-weight:700;"></select>
        <select id="monthSelect" style="padding:8px 12px;border-radius:8px;border:1.5px solid var(--border);font-family:var(--font-display);font-weight:700;"></select>
      </div>
    </div>
    ${state.profile.role === "leader" ? `
    <div class="card" id="sheetAdminCard">
      <h2>연도 탭 등록/관리</h2>
      <form id="sheetAddForm" class="grid-3" style="align-items:end;">
        <div class="field" style="margin:0;"><label>표시 이름 (예: 2026년)</label><input type="text" id="newSheetLabel" required></div>
        <div class="field" style="margin:0;"><label>구글 시트 탭 이름</label><input type="text" id="newSheetGid" placeholder="예: 2026년" required></div>
        <button class="btn" type="submit">추가</button>
      </form>
      <p style="font-size:12px;color:var(--text-muted);margin:10px 0 0;">시트 아래쪽 탭에 표시된 이름을 그대로 입력하세요 (예: 2026년).</p>
      <div id="sheetList" style="margin-top:14px;"></div>
    </div>` : ""}
    <div class="card" style="overflow:auto;max-height:calc(100vh - 210px);"><div id="sheetTableWrap">${googleAccessToken ? "불러오는 중..." : "오른쪽 위 \"구글 계정으로 연결\" 버튼을 눌러 상상플렉스 계정으로 로그인해주세요."}</div></div>`;

  document.getElementById("googleAuthBtn").onclick = async () => {
    try {
      await requestGoogleAuth();
      showToast("구글 계정이 연결되었습니다.");
      renderScheduleSheet(section);
    } catch (err) {
      alert(err.message);
    }
  };

  const yearsSnap = await getDocs(collection(db, "scheduleSheets"));
  const years = yearsSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.label || "").localeCompare(b.label || ""));

  const yearSelect = document.getElementById("yearSelect");
  const monthSelect = document.getElementById("monthSelect");
  const tableWrap = document.getElementById("sheetTableWrap");

  if (!years.length) {
    yearSelect.innerHTML = `<option value="">등록된 연도가 없습니다</option>`;
    monthSelect.innerHTML = "";
    if (googleAccessToken) tableWrap.innerHTML = `<div class="empty-state"><div class="shape"></div>등록된 연도가 없습니다. ${state.profile.role === "leader" ? "위에서 연도를 먼저 등록해주세요." : "팀장에게 문의해주세요."}</div>`;
  } else {
    yearSelect.innerHTML = years.map(y => `<option value="${escapeHtml(y.gid)}">${escapeHtml(y.label)}</option>`).join("");
    yearSelect.onchange = () => loadYearData(yearSelect.value);
    if (googleAccessToken) await loadYearData(years[years.length - 1].gid);
  }

  if (state.profile.role === "leader") {
    renderSheetList(years);
    document.getElementById("sheetAddForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const label = document.getElementById("newSheetLabel").value.trim();
      const gid = document.getElementById("newSheetGid").value.trim();
      if (!label || !gid) return;
      await addDoc(collection(db, "scheduleSheets"), { label, gid, createdAt: new Date().toISOString() });
      showToast("연도가 등록되었습니다.");
      renderScheduleSheet(section);
    });
  }
}

let currentSheetRows = null;

async function loadYearData(sheetName) {
  const tableWrap = document.getElementById("sheetTableWrap");
  const monthSelect = document.getElementById("monthSelect");
  if (!sheetName) { tableWrap.innerHTML = `<div class="empty-state">표시할 연도를 선택해주세요.</div>`; return; }
  tableWrap.innerHTML = `<div class="empty-state"><div class="shape"></div>불러오는 중...</div>`;
  try {
    const rows = await fetchSheetValues(SPREADSHEET_ID, sheetName);
    if (!rows.length) { tableWrap.innerHTML = `<div class="empty-state">이 시트에 표시할 데이터가 없습니다.</div>`; return; }
    currentSheetRows = rows;

    // 1행에서 등장하는 월 목록 추출 (등장 순서 유지, 중복 제거)
    const header = rows[0];
    const monthsSeen = [];
    for (let ci = 1; ci < header.length; ci++) {
      const mo = parseMonthFromHeader(header[ci]);
      if (mo && !monthsSeen.includes(mo)) monthsSeen.push(mo);
    }
    if (!monthsSeen.length) {
      tableWrap.innerHTML = `<div class="empty-state">1행에서 날짜(월) 형식을 인식하지 못했습니다. (예상 형식: 03. 02(월))</div>`;
      monthSelect.innerHTML = "";
      return;
    }
    monthSelect.innerHTML = monthsSeen.map(m => `<option value="${m}">${m}월</option>`).join("");
    const thisMonth = new Date().getMonth() + 1;
    monthSelect.value = monthsSeen.includes(thisMonth) ? String(thisMonth) : String(monthsSeen[0]);
    monthSelect.onchange = () => renderFilteredMonthTable(parseInt(monthSelect.value, 10));
    renderFilteredMonthTable(parseInt(monthSelect.value, 10));
  } catch (err) {
    tableWrap.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`;
  }
}

function renderFilteredMonthTable(month) {
  const wrap = document.getElementById("sheetTableWrap");
  if (!currentSheetRows) return;
  const header = currentSheetRows[0];
  const colIndexes = [0]; // 0번 열(행 라벨)은 항상 포함
  for (let ci = 1; ci < header.length; ci++) {
    if (parseMonthFromHeader(header[ci]) === month) colIndexes.push(ci);
  }
  if (colIndexes.length <= 1) { wrap.innerHTML = `<div class="empty-state">${month}월 데이터가 없습니다.</div>`; return; }

  let html = `<table style="min-width:900px;"><thead><tr>`;
  colIndexes.forEach(ci => {
    const str = String(header[ci] ?? "");
    let style = "position:sticky;top:0;background:#F4FAEF;";
    if (str.includes("(토)")) style += "color:var(--blue-deep);";
    if (str.includes("(일)")) style += "color:var(--danger);";
    html += `<th style="${style}">${escapeHtml(str)}</th>`;
  });
  html += `</tr></thead><tbody>`;
  for (let ri = 1; ri < currentSheetRows.length; ri++) {
    const row = currentSheetRows[ri];
    html += `<tr>`;
    colIndexes.forEach((ci, idx) => {
      const str = String(row[ci] ?? "");
      const isRowLabel = idx === 0;
      let style = isRowLabel ? "font-weight:700;white-space:nowrap;position:sticky;left:0;background:#fff;" : "white-space:nowrap;";
      if (matchLocationColor(str)) style += `background:${matchLocationColor(str)};color:#fff;font-weight:700;border-radius:4px;`;
      html += `<td style="${style}">${escapeHtml(str)}</td>`;
    });
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  wrap.innerHTML = html;
}

function renderSheetList(years) {
  const wrap = document.getElementById("sheetList");
  if (!years.length) { wrap.innerHTML = `<p style="font-size:13px;color:var(--text-muted);">아직 등록된 연도가 없습니다.</p>`; return; }
  wrap.innerHTML = `<table><thead><tr><th>표시 이름</th><th>탭 이름</th><th></th></tr></thead><tbody>
    ${years.map(y => `<tr><td>${escapeHtml(y.label)}</td><td class="mono">${escapeHtml(y.gid)}</td>
      <td class="actions"><button class="icon-btn danger" data-sid="${y.id}">삭제</button></td></tr>`).join("")}
  </tbody></table>`;
  wrap.querySelectorAll("[data-sid]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("이 연도 등록을 삭제할까요? (구글 시트 자체는 삭제되지 않습니다)")) return;
      await deleteDoc(doc(db, "scheduleSheets", btn.dataset.sid));
      showToast("삭제되었습니다.");
      renderScheduleSheet(getSectionByKey("schedule"));
    };
  });
}

/* ===================== 지점 성과 지표 - 구글 시트 임베드 (지점별 탭) ===================== */
function stripBranchSuffix(name) {
  return String(name || "").replace(/점$/, "");
}

function renderPlainSheetTable(container, rows) {
  if (rows.length < 2) { container.innerHTML = `<div class="empty-state">이 시트에 표시할 데이터가 없습니다.</div>`; return; }
  const dataRows = rows.slice(1); // 1행(제목/안내용 줄)은 표시하지 않음
  const colIndexes = [];
  for (let ci = 1; ci < dataRows[0].length; ci++) colIndexes.push(ci); // 0번(첫) 열도 제외

  let html = `<table class="table-compact" style="width:max-content;"><tbody>`;
  dataRows.forEach(row => {
    html += `<tr>`;
    colIndexes.forEach((ci, idx) => {
      const isSticky = idx === 0;
      const style = isSticky ? "font-weight:700;white-space:nowrap;position:sticky;left:0;background:#fff;" : "white-space:nowrap;";
      html += `<td style="${style}">${escapeHtml(String(row[ci] ?? ""))}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  container.innerHTML = html;
}

async function renderBranchSheet(section) {
  const main = document.getElementById("mainContent");
  const branchId = canViewAllRole() ? state.branchFilter[section.key] : state.profile.branchId;
  const branchObj = branchId ? state.branches.find(b => b.id === branchId) : null;
  const tabName = branchObj ? `${stripBranchSuffix(branchObj.name)}_2026` : "셀프팀_2026";
  const label = branchObj ? branchObj.name : "전체";

  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label} · ${escapeHtml(label)}</h1>
        <p>${section.desc}</p>
      </div>
      <div style="display:flex;gap:8px;">
        <a href="https://docs.google.com/spreadsheets/d/1uequoelbdG3zLzo-FgqbDsPIlb7NGFIasS_82ZzE6iA/edit" target="_blank" rel="noopener" class="btn small secondary" style="text-decoration:none;display:inline-flex;align-items:center;">고객 지표 시트 열기</a>
        <button class="btn small" id="googleAuthBtn" type="button">${googleAccessToken ? "다시 연결" : "구글 계정으로 연결"}</button>
      </div>
    </div>
    <div class="card" style="overflow:auto;max-height:calc(100vh - 210px);"><div id="branchSheetWrap">${googleAccessToken ? "불러오는 중..." : '오른쪽 위 "구글 계정으로 연결" 버튼을 눌러 상상플렉스 계정으로 로그인해주세요.'}</div></div>`;

  document.getElementById("googleAuthBtn").onclick = async () => {
    try { await requestGoogleAuth(); showToast("구글 계정이 연결되었습니다."); renderSection(section.key); }
    catch (err) { alert(err.message); }
  };

  if (!googleAccessToken) return;
  const wrap = document.getElementById("branchSheetWrap");
  try {
    const rows = await fetchSheetValues(PERFORMANCE_SPREADSHEET_ID, tabName);
    renderPlainSheetTable(wrap, rows);
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}<br><span style="font-size:12px;">시트에 "${escapeHtml(tabName)}" 이름의 탭이 있는지 확인해주세요.</span></div>`;
  }
}

/* ===================== 지점 운영 자료 - 지점 × 양식 링크 대시보드 ===================== */
async function loadOpsCategories() {
  const snap = await getDocs(collection(db, "opsCategories"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
}

async function loadOpsLinks() {
  const snap = await getDocs(collection(db, "opsLinks"));
  const map = {};
  snap.docs.forEach(d => { map[d.id] = { id: d.id, ...d.data() }; });
  return map;
}

function canEditOpsCell(branchId) {
  if (state.profile.role === "leader") return true;
  if (state.profile.role === "viewer") return false;
  return state.profile.branchId === branchId;
}

async function renderOpsGrid(section) {
  const main = document.getElementById("mainContent");
  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}</h1>
        <p>${section.desc}</p>
      </div>
    </div>
    ${state.profile.role === "leader" ? `
    <div class="card" id="categoryAdminCard">
      <h2>양식(행) 추가</h2>
      <form id="categoryForm" class="grid-2">
        <input type="text" id="newCategoryLabel" placeholder="예: 등록현황, 주간회의록..." required>
        <button class="btn" type="submit">추가</button>
      </form>
    </div>` : ""}
    <div class="card" style="overflow:auto;max-height:calc(100vh - 210px);"><div id="opsGridWrap">불러오는 중...</div></div>`;

  const [categories, branchesSorted] = await Promise.all([
    loadOpsCategories(),
    Promise.resolve([...state.branches].sort((a, b) => a.name.localeCompare(b.name, "ko")))
  ]);
  const linksMap = await loadOpsLinks();

  if (state.profile.role === "leader") {
    document.getElementById("categoryForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const label = document.getElementById("newCategoryLabel").value.trim();
      if (!label) return;
      const maxOrder = categories.reduce((m, c) => Math.max(m, c.order || 0), 0);
      await addDoc(collection(db, "opsCategories"), { label, order: maxOrder + 1, createdAt: new Date().toISOString() });
      showToast("추가되었습니다.");
      renderOpsGrid(section);
    });
  }

  renderOpsTable(categories, branchesSorted, linksMap);
}

async function moveCategory(categories, index, direction) {
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= categories.length) return;
  const a = categories[index], b = categories[swapWith];
  const orderA = a.order || 0, orderB = b.order || 0;
  await Promise.all([
    updateDoc(doc(db, "opsCategories", a.id), { order: orderB }),
    updateDoc(doc(db, "opsCategories", b.id), { order: orderA })
  ]);
  renderSection("operation");
}

function openCategoryEditModal(categoryId, currentLabel) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `<div class="modal-bg" id="modalBg">
    <div class="modal">
      <h3>양식 이름 수정</h3>
      <form id="categoryEditForm">
        <div class="field"><label>양식 이름</label><input type="text" id="categoryEditLabel" value="${escapeHtml(currentLabel)}" required></div>
        <div class="grid-2" style="margin-top:10px;">
          <button type="button" class="btn secondary" id="cancelBtn">취소</button>
          <button type="submit" class="btn">저장</button>
        </div>
      </form>
    </div></div>`;
  document.getElementById("cancelBtn").onclick = () => root.innerHTML = "";
  document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") root.innerHTML = ""; });
  document.getElementById("categoryEditForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = document.getElementById("categoryEditLabel").value.trim();
    if (!label) return;
    await updateDoc(doc(db, "opsCategories", categoryId), { label });
    root.innerHTML = "";
    showToast("수정되었습니다.");
    renderSection("operation");
  });
}

function renderOpsTable(categories, branchesSorted, linksMap) {
  const wrap = document.getElementById("opsGridWrap");
  if (!branchesSorted.length) { wrap.innerHTML = `<div class="empty-state">등록된 지점이 없습니다. "지점 · 팀원 관리"에서 지점을 먼저 추가해주세요.</div>`; return; }
  if (!categories.length) { wrap.innerHTML = `<div class="empty-state">${state.profile.role === "leader" ? "위에서 양식을 먼저 추가해주세요." : "아직 등록된 양식이 없습니다."}</div>`; return; }
  const isLeaderView = state.profile.role === "leader";

  let html = `<table style="min-width:700px;"><thead><tr><th style="position:sticky;left:0;background:#F4FAEF;">양식</th>
    ${branchesSorted.map(b => `<th>${escapeHtml(b.name)}</th>`).join("")}${isLeaderView ? `<th>관리</th>` : ""}</tr></thead><tbody>`;
  categories.forEach((cat, i) => {
    html += `<tr><td style="font-weight:700;position:sticky;left:0;background:#fff;white-space:nowrap;">${escapeHtml(cat.label)}</td>`;
    branchesSorted.forEach(b => {
      const cellId = `${b.id}_${cat.id}`;
      const link = linksMap[cellId];
      const editable = canEditOpsCell(b.id);
      const branchColor = matchLocationColor(b.name) || "var(--blue-deep)";
      if (link && link.url) {
        html += `<td style="white-space:nowrap;">
          <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" class="ops-open-btn" style="background:${branchColor};">열기 ↗</a>
          ${editable ? `<button type="button" class="icon-btn" data-edit-cell="${cellId}" data-branch="${b.id}" data-cat="${cat.id}">수정</button>` : ""}
        </td>`;
      } else {
        html += `<td>${editable ? `<button type="button" class="icon-btn" data-edit-cell="${cellId}" data-branch="${b.id}" data-cat="${cat.id}">+ 링크 추가</button>` : `<span style="color:var(--text-muted);font-size:12px;">-</span>`}</td>`;
      }
    });
    if (isLeaderView) {
      html += `<td style="white-space:nowrap;">
        <button class="icon-btn" data-move="up" data-idx="${i}" ${i === 0 ? "disabled style='opacity:.3;'" : ""}>▲</button>
        <button class="icon-btn" data-move="down" data-idx="${i}" ${i === categories.length - 1 ? "disabled style='opacity:.3;'" : ""}>▼</button>
        <button class="icon-btn" data-edit-cat="${cat.id}" data-label="${escapeHtml(cat.label)}">수정</button>
        <button class="icon-btn danger" data-cid="${cat.id}">삭제</button>
      </td>`;
    }
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll("[data-edit-cell]").forEach(btn => {
    btn.onclick = () => openOpsLinkModal(btn.dataset.editCell, btn.dataset.branch, btn.dataset.cat, linksMap[btn.dataset.editCell]?.url || "");
  });
  wrap.querySelectorAll("[data-move]").forEach(btn => {
    btn.onclick = () => moveCategory(categories, parseInt(btn.dataset.idx, 10), btn.dataset.move);
  });
  wrap.querySelectorAll("[data-edit-cat]").forEach(btn => {
    btn.onclick = () => openCategoryEditModal(btn.dataset.editCat, btn.dataset.label);
  });
  wrap.querySelectorAll("[data-cid]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("이 양식(행)을 삭제할까요? 등록된 링크들도 함께 안 보이게 됩니다.")) return;
      await deleteDoc(doc(db, "opsCategories", btn.dataset.cid));
      showToast("삭제되었습니다.");
      renderSection("operation");
    };
  });
}

function openOpsLinkModal(cellId, branchId, categoryId, currentUrl) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `<div class="modal-bg" id="modalBg">
    <div class="modal">
      <h3>링크 설정</h3>
      <form id="opsLinkForm">
        <div class="field"><label>URL (구글 시트, 문서 등)</label><input type="url" id="opsLinkUrl" placeholder="https://..." value="${escapeHtml(currentUrl)}"></div>
        <div class="grid-2" style="margin-top:10px;">
          <button type="button" class="btn secondary" id="cancelBtn">취소</button>
          <button type="submit" class="btn">저장</button>
        </div>
        ${currentUrl ? `<button type="button" class="btn danger" id="removeLinkBtn" style="width:100%;margin-top:8px;">링크 삭제</button>` : ""}
      </form>
    </div></div>`;
  document.getElementById("cancelBtn").onclick = () => root.innerHTML = "";
  document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") root.innerHTML = ""; });
  document.getElementById("opsLinkForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = document.getElementById("opsLinkUrl").value.trim();
    if (!url) { root.innerHTML = ""; return; }
    await setDoc(doc(db, "opsLinks", cellId), {
      branchId, categoryId, url, updatedAt: new Date().toISOString(), updatedBy: state.profile.name
    });
    root.innerHTML = "";
    showToast("저장되었습니다.");
    renderSection("operation");
  });
  const removeBtn = document.getElementById("removeLinkBtn");
  if (removeBtn) {
    removeBtn.onclick = async () => {
      if (!confirm("이 링크를 삭제할까요?")) return;
      await deleteDoc(doc(db, "opsLinks", cellId));
      root.innerHTML = "";
      showToast("삭제되었습니다.");
      renderSection("operation");
    };
  }
}


const state = { user:null, profile:null, branches:[], customFolders:[], menuOverrides:{}, currentSection:"schedule", branchFilter:{}, navExpanded:{} };

/* ===================== 인증 확인 ===================== */
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  state.user = user;
  let snap;
  try {
    snap = await getDoc(doc(db, "users", user.uid));
  } catch (err) {
    alert("프로필 정보를 불러오지 못했습니다: " + err.message);
    await signOut(auth);
    window.location.href = "index.html";
    return;
  }
  if (!snap.exists()) {
    // 프로필 문서가 없는 상태로 로그인된 경우: 무한 리다이렉트를 막기 위해 로그아웃 후 안내
    alert("계정 정보(프로필)를 찾을 수 없습니다. 다시 회원가입해주세요.");
    await signOut(auth);
    window.location.href = "index.html";
    return;
  }
  state.profile = snap.data();

  document.getElementById("whoBox").innerHTML = `
    <div class="name">${escapeHtml(state.profile.name || user.email)}</div>
    <div class="role">${state.profile.role === "leader" ? "팀장" : state.profile.role === "viewer" ? "전체 열람 (뷰어)" : "팀원 · " + escapeHtml(state.profile.branchName || "")}</div>`;

  await loadBranches();
  await loadCustomFolders();
  await loadMenuOverrides();
  buildNav();
  renderSection(state.currentSection);
});

document.getElementById("logoutBtn").onclick = () => signOut(auth);
document.getElementById("navToggleBtn").onclick = () => {
  document.querySelector(".sidebar").classList.toggle("nav-open");
};

async function loadBranches() {
  const snap = await getDocs(collection(db, "branches"));
  state.branches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadCustomFolders() {
  const snap = await getDocs(collection(db, "customFolders"));
  state.customFolders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadMenuOverrides() {
  const snap = await getDocs(collection(db, "menuOverrides"));
  const map = {};
  snap.docs.forEach(d => { map[d.id] = d.data(); });
  state.menuOverrides = map;
}

/* 팀장이 이름/그룹/색상을 바꾼 메뉴가 있으면 기본값 위에 덮어씌우기 */
function withOverride(section) {
  const o = state.menuOverrides[section.key];
  if (!o) return section;
  return { ...section, label: o.label || section.label, group: o.group || section.group, color: o.color || section.color };
}

/* 팀장이 만든 "사용자 정의 폴더"를 기존 SECTIONS 항목과 동일한 방식으로 다루기 위한 변환 */
function folderToSection(folder) {
  const base = {
    key: "folder_" + folder.id,
    label: folder.label,
    group: folder.group,
    color: folder.color || "neutral",
    collectionName: "folderEntries",
    scope: "custom",
    folderId: folder.id,
    writable: folder.writable || "leader",
    template: folder.template || "standard",
    desc: folder.desc || ""
  };
  if (folder.template === "okr") {
    return { ...base, isOkr: true, desc: folder.desc || "시즌별 OKR(Objective · Key Result · Key Task)을 관리합니다." };
  }
  return {
    ...base,
    cardView: true,
    headerFields: ["title"],
    fields: [
      { key: "title", label: "제목", type: "text" },
      { key: "content", label: "내용", type: "richtext" },
      { key: "link", label: "첨부 링크(URL)", type: "link" },
      { key: "images", label: "첨부 이미지", type: "imageUpload" }
    ]
  };
}

function getSectionByKey(key) {
  if (key.startsWith("folder_")) {
    const folder = state.customFolders.find(f => "folder_" + f.id === key);
    return folder ? withOverride(folderToSection(folder)) : null;
  }
  const s = SECTIONS.find(s => s.key === key);
  return s ? withOverride(s) : null;
}

/* ===================== 사이드바 네비게이션 ===================== */
function buildNav() {
  const nav = document.getElementById("navGroups");
  let html = "";
  const allBuiltIn = SECTIONS.filter(s => !s.leaderOnly || canViewAllRole()).map(withOverride);
  const allFolders = state.customFolders.map(f => withOverride(folderToSection(f)));
  const allItems = [...allBuiltIn, ...allFolders];
  GROUP_ORDER.forEach(group => {
    const items = allItems.filter(s => s.group === group);
    html += `<div class="nav-group"><div class="nav-group-label">${group}</div>`;
    items.forEach(s => {
      const expandable = s.hasBranchSubmenu && canViewAllRole();
      const expanded = !!state.navExpanded[s.key];
      html += `<div class="nav-item" data-key="${s.key}" data-branch="" data-expandable="${expandable}" style="--nav-color:${COLOR_HEX[s.color]}">
        <span class="nav-label"><span class="dot" style="background:${COLOR_HEX[s.color]}"></span>${s.label}</span>
        ${expandable ? `<span class="nav-chevron ${expanded ? "open" : ""}">›</span>` : ""}
      </div>`;
      if (expandable) {
        html += `<div class="nav-sub" style="display:${expanded ? "block" : "none"};">
          <div class="nav-subitem" data-key="${s.key}" data-branch="">전체</div>
          ${state.branches.map(b => `<div class="nav-subitem" data-key="${s.key}" data-branch="${b.id}">${escapeHtml(b.name)}</div>`).join("")}
        </div>`;
      }
    });
    html += `</div>`;
  });
  if (state.profile.role === "leader") {
    html += `<div class="nav-group"><div class="nav-group-label">관리</div>
      <div class="nav-item" data-key="admin" style="--nav-color:#9CA88F">
        <span class="dot" style="background:#9CA88F"></span>지점 · 팀원 관리
      </div></div>`;
  }
  nav.innerHTML = html;
  nav.querySelectorAll(".nav-item").forEach(el => {
    el.onclick = () => {
      const key = el.dataset.key;
      if (el.dataset.expandable === "true") {
        state.navExpanded[key] = !state.navExpanded[key];
        buildNav();
        return;
      }
      state.currentSection = key;
      renderSection(key);
      closeMobileNav();
    };
  });
  nav.querySelectorAll(".nav-subitem").forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const key = el.dataset.key;
      const branchId = el.dataset.branch || null;
      state.currentSection = key;
      state.branchFilter[key] = branchId;
      renderSection(key);
      closeMobileNav();
    };
  });
}

function closeMobileNav() {
  if (window.innerWidth <= 860) document.querySelector(".sidebar").classList.remove("nav-open");
}

function markActiveNav(key) {
  const branchId = state.branchFilter[key] || "";
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.key === key && !el.classList.contains("nav-subitem")));
  document.querySelectorAll(".nav-subitem").forEach(el => el.classList.toggle("active", el.dataset.key === key && (el.dataset.branch || "") === branchId));
}

/* ===================== 권한 판단 ===================== */
function canViewAllRole() { return state.profile.role === "leader" || state.profile.role === "viewer"; }

function canWriteSection(section) {
  if (state.profile.role === "viewer") return false;
  if (state.profile.role === "leader") return true;
  if (section.writable === "all") return true;
  if (section.writable === "leader-and-branch") return true; // 자기 지점 데이터만, 저장 시 branchId 강제
  return false;
}
function canEditDoc(section, data) {
  if (state.profile.role === "viewer") return false;
  if (state.profile.role === "leader") return true;
  if (section.writable === "all") return true;
  if (section.writable === "leader-and-branch") return data.branchId === state.profile.branchId;
  return false;
}

/* ===================== 섹션 렌더링(목록) ===================== */
async function renderSection(key) {
  markActiveNav(key);
  const main = document.getElementById("mainContent");
  if (key === "admin") { renderAdmin(); return; }

  const section = getSectionByKey(key);
  if (!section) { main.innerHTML = `<div class="empty-state">찾을 수 없는 메뉴입니다.</div>`; return; }
  if (section.isScheduleSheet) { renderScheduleSheet(section); return; }
  if (section.cardView) { renderLogCards(section); return; }
  if (section.isBranchSheet) { renderBranchSheet(section); return; }
  if (section.isOpsGrid) { renderOpsGrid(section); return; }
  if (section.isOkr) { renderOkrFolder(section); return; }
  if (section.isRosterGrid) { renderRosterGrid(section); return; }
  const branchId = state.branchFilter[key];
  const branchLabel = section.hasBranchSubmenu
    ? (canViewAllRole()
        ? (branchId ? " · " + (state.branches.find(b => b.id === branchId)?.name || "") : " · 전체")
        : " · " + (state.profile.branchName || ""))
    : "";
  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}${branchLabel}</h1>
        <p>${section.desc}</p>
      </div>
      ${canWriteSection(section) ? `<button class="btn small" id="addBtn">+ 새로 등록</button>` : ""}
    </div>
    ${section.isPerformance ? `<div class="stat-grid" id="statGrid"></div>` : ""}
    <div class="card"><div id="tableWrap">불러오는 중...</div></div>`;

  if (canWriteSection(section)) {
    document.getElementById("addBtn").onclick = () => openModal(section, null);
  }

  const docs = await fetchDocs(section);
  if (section.isPerformance) renderStatGrid(docs);
  renderTable(section, docs);
}

async function fetchDocs(section) {
  const colRef = collection(db, section.collectionName);
  let q;
  if (section.scope === "custom") {
    q = query(colRef, where("folderId", "==", section.folderId));
  } else if (section.scope === "branch" && !canViewAllRole()) {
    q = query(colRef, where("branchId", "==", state.profile.branchId));
  } else if (section.scope === "branch" && state.branchFilter[section.key]) {
    q = query(colRef, where("branchId", "==", state.branchFilter[section.key]));
  } else {
    q = colRef;
  }
  const snap = await getDocs(q);
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // 최신순 정렬 (date 또는 createdAt 기준, 인덱스 불필요하도록 클라이언트 정렬)
  docs.sort((a, b) => (b.date || b.createdAt || "").localeCompare(a.date || a.createdAt || ""));
  return docs;
}

function renderStatGrid(docs) {
  const grid = document.getElementById("statGrid");
  const revenue = docs.reduce((s, d) => s + (Number(d.revenue) || 0), 0);
  const regs = docs.reduce((s, d) => s + (Number(d.newRegistrations) || 0), 0);
  const avgRenewal = docs.length ? (docs.reduce((s, d) => s + (Number(d.renewalRate) || 0), 0) / docs.length).toFixed(1) : 0;
  const avgConv = docs.length ? (docs.reduce((s, d) => s + (Number(d.consultationConversion) || 0), 0) / docs.length).toFixed(1) : 0;
  grid.innerHTML = `
    <div class="stat-card"><div class="label">총 매출</div><div class="value">${revenue.toLocaleString()}<span style="font-size:13px;">만원</span></div></div>
    <div class="stat-card"><div class="label">총 신규 등록</div><div class="value">${regs.toLocaleString()}</div></div>
    <div class="stat-card"><div class="label">평균 재등록률</div><div class="value">${avgRenewal}%</div></div>
    <div class="stat-card"><div class="label">평균 상담 전환율</div><div class="value">${avgConv}%</div></div>`;
}

function renderTable(section, docs) {
  const wrap = document.getElementById("tableWrap");
  if (!docs.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="shape"></div>아직 등록된 자료가 없습니다.</div>`;
    return;
  }
  const cols = section.columns || section.fields.slice(0, 3).map(f => f.key);
  const fieldMap = Object.fromEntries(section.fields.map(f => [f.key, f]));

  let html = `<table><thead><tr>`;
  cols.forEach(c => html += `<th>${fieldMap[c] ? fieldMap[c].label : (c === "branchName" ? "지점" : c)}</th>`);
  html += `<th></th></tr></thead><tbody>`;

  docs.forEach(d => {
    html += `<tr>`;
    cols.forEach(c => {
      let val = d[c] ?? "";
      const f = fieldMap[c];
      if (c === "important") {
        val = val === "yes" ? `<span class="pill important">중요</span>` : `<span class="pill normal">일반</span>`;
      } else if (f && f.type === "number") {
        val = `<span class="mono">${val}</span>`;
      } else if (typeof val === "string" && val.length > 60) {
        val = escapeHtml(val.slice(0, 60)) + "…";
      } else {
        val = escapeHtml(String(val));
      }
      html += `<td>${val}</td>`;
    });
    const editable = canEditDoc(section, d);
    html += `<td class="actions">
      ${editable ? `<button class="icon-btn" data-act="edit" data-id="${d.id}">수정</button>
      <button class="icon-btn danger" data-act="del" data-id="${d.id}">삭제</button>` : ""}
    </td></tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll('[data-act="edit"]').forEach(btn => {
    btn.onclick = () => openModal(section, docs.find(d => d.id === btn.dataset.id));
  });
  wrap.querySelectorAll('[data-act="del"]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("정말 삭제하시겠습니까?")) return;
      await deleteDoc(doc(db, section.collectionName, btn.dataset.id));
      showToast("삭제되었습니다.");
      renderSection(section.key);
    };
  });
}

/* ===================== 팀 회의 일지 - 카드형 인라인 렌더러 (팝업 없이 바로 표시) ===================== */
async function renderLogCards(section) {
  const main = document.getElementById("mainContent");
  const branchId = state.branchFilter[section.key];
  const branchLabel = section.hasBranchSubmenu
    ? (canViewAllRole()
        ? (branchId ? " · " + (state.branches.find(b => b.id === branchId)?.name || "") : " · 전체")
        : " · " + (state.profile.branchName || ""))
    : "";

  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}${branchLabel}</h1>
        <p>${section.desc}</p>
      </div>
      <div style="display:flex;gap:8px;">
        ${section.extraLink ? `<a href="${section.extraLink.url}" target="_blank" rel="noopener" class="btn small secondary" style="text-decoration:none;display:inline-flex;align-items:center;">${escapeHtml(section.extraLink.label)}</a>` : ""}
        ${canWriteSection(section) ? `<button class="btn small" id="addBtn">+ 새로 등록</button>` : ""}
      </div>
    </div>
    <div id="logList">불러오는 중...</div>`;

  if (canWriteSection(section)) {
    document.getElementById("addBtn").onclick = () => openModal(section, null);
  }

  const docs = await fetchDocs(section);
  const wrap = document.getElementById("logList");
  if (!docs.length) {
    wrap.innerHTML = `<div class="card"><div class="empty-state"><div class="shape"></div>아직 등록된 자료가 없습니다.</div></div>`;
    return;
  }

  const imageField = section.fields.find(f => f.type === "imageUpload");
  const bodyFields = section.fields.filter(f =>
    !section.headerFields.includes(f.key) && f.type !== "imageUpload" && f.key !== "branchId"
  );

  wrap.innerHTML = docs.map(d => {
    const editable = canEditDoc(section, d);
    const metaKeys = section.headerFields.filter(k => k !== "title");
    const metaParts = metaKeys.map(k => d[k]).filter(Boolean).map(escapeHtml);
    if (d.createdAt) metaParts.push("업로드: " + escapeHtml(String(d.createdAt).slice(0, 10)));
    const metaText = metaParts.join(" · ");
    const titleText = d.title ? escapeHtml(d.title) : (metaParts.length ? "" : "(제목 없음)");
    const images = imageField ? (d[imageField.key] || []).filter(Boolean) : [];

    const bodyHtml = bodyFields.map(f => {
      const val = d[f.key];
      if (!val) return "";
      if (f.type === "link") {
        return `<div style="margin:12px 0 4px;"><a href="${escapeHtml(String(val))}" target="_blank" rel="noopener" class="ops-open-btn" style="background:var(--blue-deep);">🔗 ${escapeHtml(f.label)} 열기</a></div>`;
      }
      const rendered = f.type === "richtext"
        ? sanitizeRichHtml(String(val))
        : escapeHtml(String(val)).replace(/\n/g, "<br>");
      return `<div style="margin:12px 0 4px;"><strong>${escapeHtml(f.label)}</strong><div class="rich-content">${rendered}</div></div>`;
    }).join("");

    return `<div class="card meeting-card">
      <div class="log-summary" data-toggle="${d.id}">
        <div>
          ${titleText ? `<div style="font-weight:800;font-size:15px;">${titleText}</div>` : ""}
          <div style="font-size:12px;color:var(--text-muted);margin-top:${titleText ? "2px" : "0"};${!titleText ? "font-weight:800;font-size:15px;color:var(--text-main);" : ""}">${metaText}<span class="log-chevron">›</span></div>
        </div>
        ${editable ? `<div>
          <button class="icon-btn" data-act="edit" data-id="${d.id}">수정</button>
          <button class="icon-btn danger" data-act="del" data-id="${d.id}">삭제</button>
        </div>` : ""}
      </div>
      <div class="log-body" id="body_${d.id}">
        ${bodyHtml}
        ${images.length ? `<div class="meeting-gallery">
          ${images.map(url => `<span class="img-zoom-wrap"><img src="${url}" class="meeting-img" data-zoom="0" loading="lazy" onclick="cycleMeetingImgZoom(this)"></span>`).join("")}
        </div>` : ""}
      </div>
    </div>`;
  }).join("");

  wrap.querySelectorAll(".log-summary").forEach(el => {
    el.onclick = () => {
      const body = document.getElementById(`body_${el.dataset.toggle}`);
      const opening = !body.classList.contains("open");
      body.classList.toggle("open", opening);
      el.classList.toggle("open", opening);
    };
  });
  wrap.querySelectorAll('[data-act="edit"]').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); openModal(section, docs.find(d => d.id === btn.dataset.id)); };
  });
  wrap.querySelectorAll('[data-act="del"]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("정말 삭제하시겠습니까?")) return;
      await deleteDoc(doc(db, section.collectionName, btn.dataset.id));
      showToast("삭제되었습니다.");
      renderSection(section.key);
    };
  });
}

/* ===================== OKR 폴더 (시즌 · Objective · KR · KT) ===================== */
function seasonOptions() {
  const seasons = [
    { n: 1, label: "1시즌 (3~5월)" },
    { n: 2, label: "2시즌 (6~8월)" },
    { n: 3, label: "3시즌 (9~11월)" },
    { n: 4, label: "4시즌 (12~2월)" }
  ];
  const thisYear = new Date().getFullYear();
  const opts = [];
  for (let y = thisYear - 1; y <= thisYear + 1; y++) {
    seasons.forEach(s => opts.push(`${y}년 ${s.label}`));
  }
  return opts;
}

function parseSeasonKey(season) {
  const m = String(season || "").match(/(\d{4})년\s*(\d)시즌/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 10 + parseInt(m[2], 10);
}

async function renderOkrFolder(section) {
  const main = document.getElementById("mainContent");
  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}</h1>
        <p>${section.desc}</p>
      </div>
      ${canWriteSection(section) ? `<button class="btn small" id="addBtn">+ 새 OKR 등록</button>` : ""}
    </div>
    <div id="okrList">불러오는 중...</div>`;

  if (canWriteSection(section)) {
    document.getElementById("addBtn").onclick = () => openOkrModal(section, null);
  }

  const docs = await fetchDocs(section);
  docs.sort((a, b) => parseSeasonKey(b.season) - parseSeasonKey(a.season));
  const wrap = document.getElementById("okrList");
  if (!docs.length) {
    wrap.innerHTML = `<div class="card"><div class="empty-state"><div class="shape"></div>아직 등록된 OKR이 없습니다.</div></div>`;
    return;
  }

  wrap.innerHTML = docs.map(d => {
    const editable = canEditDoc(section, d);
    const krs = d.krs || [];
    const overall = krs.length ? Math.round(krs.reduce((s, k) => s + (k.achievement || 0), 0) / krs.length) : 0;
    const objectivePreview = (d.objective || "").slice(0, 50) + ((d.objective || "").length > 50 ? "…" : "");
    return `<div class="card meeting-card">
      <div class="log-summary" data-toggle="${d.id}">
        <div>
          <div style="font-weight:800;font-size:15px;">${escapeHtml(d.season || "")}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${escapeHtml(objectivePreview)} · 종합 달성율 ${overall}%<span class="log-chevron">›</span></div>
        </div>
        ${editable ? `<div>
          <button class="icon-btn" data-act="edit" data-id="${d.id}">수정</button>
          <button class="icon-btn danger" data-act="del" data-id="${d.id}">삭제</button>
        </div>` : ""}
      </div>
      <div class="log-body" id="body_${d.id}">
        <p style="margin:0 0 14px;"><strong>Objective</strong><br>${escapeHtml(d.objective || "").replace(/\n/g, "<br>")}</p>
        ${krs.map((k, i) => `
          <div style="margin:0 0 12px;padding:12px 14px;background:#FBFEFA;border-radius:10px;border:1px solid var(--border);">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
              <strong style="font-size:13.5px;">KR${i + 1}. ${escapeHtml(k.title || "")}</strong>
              <span class="mono" style="font-weight:700;color:var(--green-deep);white-space:nowrap;">${k.achievement || 0}%</span>
            </div>
            <div style="background:#EAF3E3;border-radius:6px;height:8px;margin:8px 0;overflow:hidden;">
              <div style="background:var(--green-bright);height:100%;width:${k.achievement || 0}%;"></div>
            </div>
            ${(k.kts || []).length ? `<ul style="margin:6px 0 0 18px;font-size:13px;line-height:1.6;">${(k.kts || []).map(kt => `<li>${escapeHtml(kt)}</li>`).join("")}</ul>` : ""}
          </div>`).join("")}
      </div>
    </div>`;
  }).join("");

  wrap.querySelectorAll(".log-summary").forEach(el => {
    el.onclick = () => {
      const body = document.getElementById(`body_${el.dataset.toggle}`);
      const opening = !body.classList.contains("open");
      body.classList.toggle("open", opening);
      el.classList.toggle("open", opening);
    };
  });
  wrap.querySelectorAll('[data-act="edit"]').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); openOkrModal(section, docs.find(d => d.id === btn.dataset.id)); };
  });
  wrap.querySelectorAll('[data-act="del"]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("정말 삭제하시겠습니까?")) return;
      await deleteDoc(doc(db, "folderEntries", btn.dataset.id));
      showToast("삭제되었습니다.");
      renderSection(section.key);
    };
  });
}

function krBlockHtml(i, kr) {
  const k = kr || { title: "", achievement: 0, kts: [] };
  return `<div class="card" style="background:#FBFEFA;margin-bottom:12px;padding:16px;">
    <h2 style="font-size:14px;margin:0 0 12px;">Key Result ${i + 1}</h2>
    <div class="field"><label>KR${i + 1} 내용 (정량적 목표)</label><input type="text" id="krTitle_${i}" value="${escapeHtml(k.title || "")}"></div>
    <div class="field"><label>달성율 (%)</label><input type="number" id="krAch_${i}" min="0" max="100" value="${k.achievement || 0}"></div>
    <div class="field"><label>Key Task (최대 3개)</label>
      ${[0, 1, 2].map(j => `<input type="text" id="kt_${i}_${j}" placeholder="KT ${j + 1}" value="${escapeHtml((k.kts && k.kts[j]) || "")}" style="margin-bottom:6px;">`).join("")}
    </div>
  </div>`;
}

function openOkrModal(section, existing) {
  const root = document.getElementById("modalRoot");
  const seasons = seasonOptions();
  const krs = (existing && existing.krs) || [{}, {}, {}];

  root.innerHTML = `<div class="modal-bg" id="modalBg">
    <div class="modal" style="max-width:560px;">
      <h3>${existing ? "수정" : "새 OKR 등록"} · ${section.label}</h3>
      <form id="okrForm">
        <div class="field"><label>시즌</label>
          <select id="okrSeason">${seasons.map(s => `<option value="${s}" ${existing && existing.season === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        </div>
        <div class="field"><label>Objective (목적 · 정성적 서술)</label><textarea id="okrObjective" rows="2">${escapeHtml((existing && existing.objective) || "")}</textarea></div>
        ${[0, 1, 2].map(i => krBlockHtml(i, krs[i])).join("")}
        <div class="grid-2" style="margin-top:10px;">
          <button type="button" class="btn secondary" id="cancelBtn">취소</button>
          <button type="submit" class="btn" id="saveBtn">저장</button>
        </div>
      </form>
    </div></div>`;

  document.getElementById("cancelBtn").onclick = () => root.innerHTML = "";
  document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") root.innerHTML = ""; });

  document.getElementById("okrForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("saveBtn");
    saveBtn.disabled = true;
    saveBtn.textContent = "저장 중...";
    try {
      const season = document.getElementById("okrSeason").value;
      const objective = document.getElementById("okrObjective").value.trim();
      const krsData = [0, 1, 2].map(i => ({
        title: document.getElementById(`krTitle_${i}`).value.trim(),
        achievement: Math.max(0, Math.min(100, parseInt(document.getElementById(`krAch_${i}`).value, 10) || 0)),
        kts: [0, 1, 2].map(j => document.getElementById(`kt_${i}_${j}`).value.trim()).filter(Boolean)
      }));
      const data = {
        folderId: section.folderId, season, objective, krs: krsData,
        updatedAt: new Date().toISOString(), updatedBy: state.profile.name
      };
      if (existing) {
        await updateDoc(doc(db, "folderEntries", existing.id), data);
      } else {
        data.createdAt = new Date().toISOString();
        data.createdBy = state.profile.name;
        await addDoc(collection(db, "folderEntries"), data);
      }
      root.innerHTML = "";
      showToast("저장되었습니다.");
      renderSection(section.key);
    } catch (err) {
      alert("저장 중 오류: " + err.message);
      saveBtn.disabled = false;
      saveBtn.textContent = "저장";
    }
  });
}

/* ===================== 지점 인적 구성 - 홈페이지에서 직접 관리 ===================== */
const ROSTER_LEGEND = [
  { key:"잔류", label:"잔류", color:"#0000FF" },
  { key:"신규입사", label:"신규 입사", color:"#00FFFF" },
  { key:"지점이동In", label:"지점 이동 In", color:"#00FF00" },
  { key:"지점이동Out", label:"지점 이동 Out", color:"#FF9900" },
  { key:"타팀이동Out", label:"타팀 이동 Out", color:"#FFFF00" },
  { key:"퇴사", label:"퇴사", color:"#FF0000" }
];
const ROSTER_STATUS_COLOR = Object.fromEntries(ROSTER_LEGEND.map(l => [l.key, l.color]));

// 2026년까지의 기존 자료 (엑셀에서 가져온 초기값). 지점별로 "불러오기" 버튼을 한 번 누르면
// Firestore에 저장되고, 이후로는 전부 홈페이지에서 직접 관리합니다.
const ROSTER_SEED_DATA = [{"branch": "행당", "years": ["2022년", "2023년", "2024년", "2025년", "2026년"], "people": [[{"name": "윤서연", "status": "잔류"}, {"name": "윤서연", "status": "잔류"}, {"name": "윤서연", "status": "잔류"}, {"name": "윤서연", "status": "잔류"}, {"name": "윤서연", "status": "잔류"}], [{"name": "김선희", "status": "신규입사"}, {"name": "김선희", "status": "잔류"}, {"name": "김선희", "status": "잔류"}, {"name": "김선희", "status": "잔류"}, {"name": "김선희", "status": "잔류"}], [{"name": "조이령", "status": "신규입사"}, {"name": "조이령", "status": "잔류"}, {"name": "조이령", "status": "잔류"}, {"name": "조이령", "status": "잔류"}, {"name": "조이령", "status": "잔류"}], [{"name": "", "status": null}, {"name": "김광수", "status": "신규입사"}, {"name": "김광수", "status": "지점이동Out"}, {"name": "", "status": null}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "박승연", "status": "신규입사"}, {"name": "박승연", "status": "퇴사"}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "박화영", "status": "지점이동In"}, {"name": "박화영", "status": "잔류"}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "임승호", "status": "지점이동In"}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "류채연", "status": "신규입사"}]]}, {"branch": "전농", "years": ["2022년", "2023년", "2024년", "2025년", "2026년"], "people": [[{"name": "", "status": null}, {"name": "한성호", "status": "잔류"}, {"name": "한성호", "status": "잔류"}, {"name": "한성호", "status": "타팀이동Out"}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "김지나", "status": "지점이동In"}, {"name": "김지나", "status": "잔류"}, {"name": "김지나", "status": "잔류"}, {"name": "김지나", "status": "잔류"}], [{"name": "", "status": null}, {"name": "박화영", "status": "잔류"}, {"name": "박화영", "status": "잔류"}, {"name": "박화영", "status": "지점이동Out"}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "김성은", "status": "잔류"}, {"name": "김성은", "status": "잔류"}, {"name": "김성은", "status": "잔류"}, {"name": "김성은", "status": "잔류"}], [{"name": "", "status": null}, {"name": "한승희", "status": "잔류"}, {"name": "한승희", "status": "잔류"}, {"name": "한승희", "status": "퇴사"}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "강승협", "status": "지점이동In"}, {"name": "강승협", "status": "잔류"}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "임소연", "status": "지점이동In"}, {"name": "임소연", "status": "퇴사"}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "윤재원", "status": "신규입사"}]]}, {"branch": "돈암", "years": ["2022년", "2023년", "2024년", "2025년", "2026년"], "people": [[{"name": "", "status": null}, {"name": "이유민", "status": "잔류"}, {"name": "이유민", "status": "잔류"}, {"name": "이유민", "status": "잔류"}, {"name": "이유민", "status": "잔류"}], [{"name": "", "status": null}, {"name": "김지영", "status": "잔류"}, {"name": "김지영", "status": "타팀이동Out"}, {"name": "", "status": null}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "임승호", "status": "지점이동In"}, {"name": "임승호", "status": "지점이동Out"}, {"name": "", "status": null}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "조누리", "status": "잔류"}, {"name": "조누리", "status": "잔류"}, {"name": "조누리", "status": "퇴사"}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "이영호", "status": "잔류"}, {"name": "이영호", "status": "잔류"}, {"name": "이영호", "status": "잔류"}, {"name": "이영호", "status": "잔류"}], [{"name": "", "status": null}, {"name": "황희선", "status": "신규입사"}, {"name": "황희선", "status": "잔류"}, {"name": "황희선", "status": "잔류"}, {"name": "황희선", "status": "잔류"}], [{"name": "", "status": null}, {"name": "김태목", "status": "신규입사"}, {"name": "김태목", "status": "퇴사"}, {"name": "", "status": null}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "강승협", "status": "신규입사"}, {"name": "강승협", "status": "지점이동Out"}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "김광수", "status": "지점이동In"}, {"name": "김광수", "status": "잔류"}, {"name": "김광수", "status": "타팀이동Out"}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "김진혁", "status": "신규입사"}, {"name": "김진혁", "status": "잔류"}, {"name": "김진혁", "status": "잔류"}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "송보경", "status": "잔류"}, {"name": "송보경", "status": "잔류"}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "이정은", "status": "지점이동In"}, {"name": "이정은", "status": "잔류"}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "홍지연", "status": "신규입사"}]]}, {"branch": "별내", "years": ["2022년", "2023년", "2024년", "2025년", "2026년"], "people": [[{"name": "", "status": null}, {"name": "박진희", "status": "잔류"}, {"name": "박진희", "status": "퇴사"}, {"name": "", "status": null}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "이하나", "status": "잔류"}, {"name": "이하나", "status": "타팀이동Out"}, {"name": "", "status": null}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "신축복", "status": "퇴사"}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "은혜리", "status": "잔류"}, {"name": "은혜리", "status": "잔류"}, {"name": "은혜리", "status": "타팀이동Out"}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "이혜진", "status": "퇴사"}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "임승호", "status": "지점이동In"}, {"name": "임승호", "status": "잔류"}, {"name": "임승호", "status": "타팀이동Out"}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "최윤호", "status": "신규입사"}, {"name": "최윤호", "status": "지점이동Out"}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "서지은", "status": "신규입사"}, {"name": "서지은", "status": "잔류"}, {"name": "서지은", "status": "잔류"}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "강건우", "status": "퇴사"}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "김영상", "status": "신규입사"}, {"name": "김영상", "status": "잔류"}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "박은별", "status": "지점이동In"}, {"name": "박은별", "status": "잔류"}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "이유진", "status": "신규입사"}, {"name": "이유진", "status": "잔류"}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "이준희", "status": "신규입사"}]]}, {"branch": "다산", "years": ["2022년", "2023년", "2024년", "2025년", "2026년"], "people": [[{"name": "", "status": null}, {"name": "", "status": null}, {"name": "전광수", "status": "지점이동In"}, {"name": "전광수", "status": "잔류"}, {"name": "전광수", "status": "잔류"}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "허태강", "status": "퇴사"}, {"name": "", "status": null}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "임소연", "status": "신규입사"}, {"name": "임소연", "status": "지점이동Out"}, {"name": "", "status": null}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "정지은", "status": "지점이동In"}, {"name": "정지은", "status": "잔류"}, {"name": "정지은", "status": "퇴사"}], [{"name": "", "status": null}, {"name": "", "status": null}, {"name": "", "status": null}, {"name": "김상현", "status": "신규입사"}, {"name": "김상현", "status": "잔류"}]]}]
;

function textColorForBg(hex) {
  if (!hex) return "inherit";
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#222" : "#fff";
}

function renderRosterLegend() {
  const el = document.getElementById("rosterLegend");
  el.innerHTML = ROSTER_LEGEND.map(l =>
    `<span style="display:inline-flex;align-items:center;gap:6px;margin:4px 14px 4px 0;font-size:12.5px;">
      <span style="width:14px;height:14px;border-radius:4px;background:${l.color};display:inline-block;border:1px solid rgba(0,0,0,0.1);"></span>${escapeHtml(l.label)}
    </span>`
  ).join("");
}

async function renderRosterGrid(section) {
  const main = document.getElementById("mainContent");
  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}</h1>
        <p>${section.desc}</p>
      </div>
    </div>
    <div class="card" id="rosterLegend" style="padding:14px 22px;"></div>
    <div id="rosterWrap">불러오는 중...</div>`;
  renderRosterLegend();

  const branchesSorted = [...state.branches].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const wrap = document.getElementById("rosterWrap");
  if (!branchesSorted.length) { wrap.innerHTML = `<div class="card"><div class="empty-state">등록된 지점이 없습니다.</div></div>`; return; }

  wrap.innerHTML = branchesSorted.map(b => `<div class="card" id="rosterCard_${b.id}" style="overflow:auto;"><div class="empty-state">불러오는 중...</div></div>`).join("");
  for (const b of branchesSorted) {
    await loadAndRenderRosterBranch(b);
  }
}

async function loadAndRenderRosterBranch(branch) {
  let data = null;
  try {
    const snap = await getDoc(doc(db, "rosterEntries", branch.id));
    if (snap.exists()) data = snap.data();
  } catch (err) { /* 문서 없음 */ }
  renderRosterBranchCard(branch, data);
}

function findSeedForBranch(branch) {
  const short = stripBranchSuffix(branch.name);
  return ROSTER_SEED_DATA.find(s => s.branch === short) || null;
}

function renderRosterBranchCard(branch, data) {
  const card = document.getElementById(`rosterCard_${branch.id}`);
  const isLeader = state.profile.role === "leader";

  if (!data) {
    const seed = findSeedForBranch(branch);
    card.innerHTML = `<h2 style="margin-bottom:10px;">${escapeHtml(branch.name)}</h2>
      <div class="empty-state">아직 등록된 인력 이력이 없습니다.
      ${isLeader && seed ? `<br><button class="btn small" id="seedBtn_${branch.id}" style="margin-top:10px;">2026년까지 기존 자료 불러오기</button>` : ""}
      ${isLeader ? `<br><button class="btn small secondary" id="newBtn_${branch.id}" style="margin-top:10px;">빈 표로 새로 시작</button>` : ""}
      </div>`;
    if (isLeader && seed) {
      document.getElementById(`seedBtn_${branch.id}`).onclick = async () => {
        const newData = { years: [...seed.years], people: seed.people.map(row => row.map(c => ({ ...c }))) };
        await setDoc(doc(db, "rosterEntries", branch.id), newData);
        showToast("불러왔습니다.");
        loadAndRenderRosterBranch(branch);
      };
    }
    if (isLeader) {
      document.getElementById(`newBtn_${branch.id}`).onclick = async () => {
        const newData = { years: [], people: [] };
        await setDoc(doc(db, "rosterEntries", branch.id), newData);
        loadAndRenderRosterBranch(branch);
      };
    }
    return;
  }

  const years = data.years || [];
  const people = data.people || [];

  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
    <h2 style="margin:0;">${escapeHtml(branch.name)}</h2>
    ${isLeader ? `<button class="btn small" id="addYearBtn_${branch.id}">+ 연도 추가</button>` : ""}
  </div>`;

  if (!years.length) {
    html += `<div class="empty-state">등록된 연도가 없습니다.</div>`;
  } else {
    html += `<table class="table-compact" style="width:max-content;min-width:100%;"><thead><tr>
      ${years.map((y, yi) => `<th>${escapeHtml(y)}${isLeader ? ` <button type="button" class="icon-btn danger" data-del-year="${yi}" style="padding:2px 4px;">✕</button>` : ""}</th>`).join("")}
      ${isLeader ? `<th></th>` : ""}
    </tr></thead><tbody>
      ${people.map((row, pi) => `<tr>
        ${years.map((y, yi) => {
          const cell = row[yi] || { name: "", status: null };
          const bg = cell.status ? ROSTER_STATUS_COLOR[cell.status] : null;
          const style = bg ? `background:${bg};color:${textColorForBg(bg)};font-weight:700;border-radius:4px;` : "";
          return `<td style="${style}${isLeader ? "cursor:pointer;" : ""}" ${isLeader ? `data-cell-edit="${pi}_${yi}"` : ""}>${escapeHtml(cell.name || "")}</td>`;
        }).join("")}
        ${isLeader ? `<td><button type="button" class="icon-btn danger" data-del-row="${pi}">✕</button></td>` : ""}
      </tr>`).join("")}
    </tbody></table>`;
  }
  if (isLeader) html += `<button class="btn small secondary" id="addPersonBtn_${branch.id}" style="margin-top:10px;">+ 인원 추가</button>`;

  card.innerHTML = html;
  if (!isLeader) return;

  if (document.getElementById(`addYearBtn_${branch.id}`)) {
    document.getElementById(`addYearBtn_${branch.id}`).onclick = () => {
      const label = prompt("추가할 연도 이름을 입력하세요 (예: 2027년)");
      if (!label) return;
      data.years = data.years || [];
      data.people = data.people || [];
      data.years.push(label);
      data.people.forEach(row => row.push({ name: "", status: null }));
      saveRosterBranch(branch, data);
    };
  }
  if (document.getElementById(`addPersonBtn_${branch.id}`)) {
    document.getElementById(`addPersonBtn_${branch.id}`).onclick = () => {
      data.people = data.people || [];
      data.people.push((data.years || []).map(() => ({ name: "", status: null })));
      saveRosterBranch(branch, data);
    };
  }
  card.querySelectorAll("[data-del-year]").forEach(btn => {
    btn.onclick = () => {
      const yi = parseInt(btn.dataset.delYear, 10);
      if (!confirm("이 연도 열을 삭제할까요?")) return;
      data.years.splice(yi, 1);
      data.people.forEach(row => row.splice(yi, 1));
      saveRosterBranch(branch, data);
    };
  });
  card.querySelectorAll("[data-del-row]").forEach(btn => {
    btn.onclick = () => {
      const pi = parseInt(btn.dataset.delRow, 10);
      if (!confirm("이 사람 행을 삭제할까요?")) return;
      data.people.splice(pi, 1);
      saveRosterBranch(branch, data);
    };
  });
  card.querySelectorAll("[data-cell-edit]").forEach(td => {
    td.onclick = () => {
      const [pi, yi] = td.dataset.cellEdit.split("_").map(Number);
      openRosterCellModal(branch, data, pi, yi);
    };
  });
}

async function saveRosterBranch(branch, data) {
  await setDoc(doc(db, "rosterEntries", branch.id), data);
  renderRosterBranchCard(branch, data);
}

function openRosterCellModal(branch, data, personIdx, yearIdx) {
  const root = document.getElementById("modalRoot");
  const cell = (data.people[personIdx] && data.people[personIdx][yearIdx]) || { name: "", status: null };
  root.innerHTML = `<div class="modal-bg" id="modalBg">
    <div class="modal">
      <h3>${escapeHtml(branch.name)} · ${escapeHtml(data.years[yearIdx] || "")}</h3>
      <form id="rosterCellForm">
        <div class="field"><label>이름</label><input type="text" id="rcName" value="${escapeHtml(cell.name || "")}"></div>
        <div class="field"><label>상태</label>
          <select id="rcStatus">
            <option value="">없음(빈 칸)</option>
            ${ROSTER_LEGEND.map(l => `<option value="${l.key}" ${cell.status === l.key ? "selected" : ""}>${escapeHtml(l.label)}</option>`).join("")}
          </select>
        </div>
        <div class="grid-2" style="margin-top:10px;">
          <button type="button" class="btn secondary" id="cancelBtn">취소</button>
          <button type="submit" class="btn">저장</button>
        </div>
      </form>
    </div></div>`;
  document.getElementById("cancelBtn").onclick = () => root.innerHTML = "";
  document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") root.innerHTML = ""; });
  document.getElementById("rosterCellForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("rcName").value.trim();
    const status = document.getElementById("rcStatus").value || null;
    data.people[personIdx][yearIdx] = { name, status };
    root.innerHTML = "";
    await saveRosterBranch(branch, data);
  });
}

/* ===================== 등록/수정 모달 ===================== */
const RICHTEXT_ALLOWED_TAGS = new Set([
  "P","BR","STRONG","B","EM","I","U","UL","OL","LI","TABLE","THEAD","TBODY","TR","TD","TH",
  "SPAN","DIV","A","H1","H2","H3","H4","BLOCKQUOTE","CODE","PRE","HR"
]);
const RICHTEXT_ALLOWED_ATTRS = new Set(["style","href","target","colspan","rowspan"]);

function sanitizeRichHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  function clean(node) {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === 1) {
        if (!RICHTEXT_ALLOWED_TAGS.has(child.tagName)) {
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
          return;
        }
        [...child.attributes].forEach(attr => {
          const name = attr.name.toLowerCase();
          if (!RICHTEXT_ALLOWED_ATTRS.has(name)) { child.removeAttribute(attr.name); return; }
          if (name === "href" && !/^https?:/i.test(attr.value)) child.removeAttribute(attr.name);
          if (name === "style" && /expression|javascript:/i.test(attr.value)) child.removeAttribute(attr.name);
        });
        if (child.tagName === "A") child.setAttribute("target", "_blank");
        clean(child);
      } else if (child.nodeType !== 3) {
        node.removeChild(child);
      }
    });
  }
  clean(doc.body);
  return doc.body.innerHTML;
}

function fieldInput(field, value) {
  const v = value ?? "";
  if (field.type === "textarea") {
    return `<textarea id="f_${field.key}" rows="3">${escapeHtml(String(v))}</textarea>`;
  }
  if (field.type === "link") {
    return `<input type="url" id="f_${field.key}" placeholder="https://..." value="${escapeHtml(String(v))}">`;
  }
  if (field.type === "branchSelect") {
    if (state.profile.role !== "leader") {
      // 팀원은 자기 지점으로 고정
      return `<input type="text" value="${escapeHtml(state.profile.branchName)}" disabled>
              <input type="hidden" id="f_${field.key}" value="${state.profile.branchId}">`;
    }
    const opts = state.branches.map(b => `<option value="${b.id}" ${b.id === v ? "selected" : ""}>${escapeHtml(b.name)}</option>`).join("");
    return `<select id="f_${field.key}"><option value="">선택하세요</option>${opts}</select>`;
  }
  if (field.type === "importanceSelect") {
    return `<select id="f_${field.key}">
      <option value="no" ${v === "no" || !v ? "selected" : ""}>일반</option>
      <option value="yes" ${v === "yes" ? "selected" : ""}>중요</option>
    </select>`;
  }
  return `<input type="${field.type}" id="f_${field.key}" value="${escapeHtml(String(v))}">`;
}

function openModal(section, existing) {
  const root = document.getElementById("modalRoot");
  const imageState = {}; // key -> { urls: [...기존 URL], files: [새로 추가한 File] }

  const fieldsHtml = section.fields.map(f => {
    if (f.type === "imageUpload") {
      imageState[f.key] = { urls: [...((existing && existing[f.key]) || [])], files: [] };
      return `<div class="field">
        <label>${f.label}</label>
        <div class="image-thumbs" id="imgthumbs_${f.key}"></div>
        <input type="file" id="imginput_${f.key}" accept="image/*" multiple>
        <p style="font-size:12px;color:var(--text-muted);margin-top:4px;">구글 슬라이드를 이미지로 내보낸 뒤 여러 장을 한 번에 올릴 수 있어요.</p>
      </div>`;
    }
    if (f.type === "richtext") {
      const initial = sanitizeRichHtml(existing ? existing[f.key] : "");
      return `<div class="field">
        <label>${f.label}</label>
        <div class="richtext-edit" id="f_${f.key}" contenteditable="true">${initial}</div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:4px;">Tiro 등에서 복사한 내용을 표까지 그대로 붙여넣기(Ctrl+V) 하실 수 있어요.</p>
      </div>`;
    }
    return `<div class="field"><label>${f.label}</label>${fieldInput(f, existing ? existing[f.key] : "")}</div>`;
  }).join("");

  root.innerHTML = `<div class="modal-bg" id="modalBg">
    <div class="modal">
      <h3>${existing ? "수정" : "새로 등록"} · ${section.label}</h3>
      <form id="entryForm">${fieldsHtml}
        <div class="grid-2" style="margin-top:10px;">
          <button type="button" class="btn secondary" id="cancelBtn">취소</button>
          <button type="submit" class="btn" id="saveBtn">저장</button>
        </div>
      </form>
    </div></div>`;

  document.getElementById("cancelBtn").onclick = () => root.innerHTML = "";
  document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") root.innerHTML = ""; });

  function renderThumbs(key) {
    const wrap = document.getElementById(`imgthumbs_${key}`);
    if (!wrap) return;
    const st = imageState[key];
    const items = [
      ...st.urls.map((url, i) => ({ type: "url", src: url, i })),
      ...st.files.map((file, i) => ({ type: "file", src: URL.createObjectURL(file), i }))
    ];
    wrap.innerHTML = items.length
      ? items.map(it => `<div class="thumb-item"><img src="${it.src}"><button type="button" class="thumb-remove" data-type="${it.type}" data-i="${it.i}">×</button></div>`).join("")
      : `<p style="font-size:12px;color:var(--text-muted);">등록된 이미지가 없습니다.</p>`;
    wrap.querySelectorAll(".thumb-remove").forEach(btn => {
      btn.onclick = () => {
        const i = parseInt(btn.dataset.i, 10);
        if (btn.dataset.type === "url") st.urls.splice(i, 1); else st.files.splice(i, 1);
        renderThumbs(key);
      };
    });
  }

  section.fields.filter(f => f.type === "imageUpload").forEach(f => {
    renderThumbs(f.key);
    document.getElementById(`imginput_${f.key}`).addEventListener("change", (e) => {
      imageState[f.key].files.push(...Array.from(e.target.files));
      renderThumbs(f.key);
      e.target.value = "";
    });
  });

  document.getElementById("entryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("saveBtn");
    saveBtn.disabled = true;
    saveBtn.textContent = "저장 중...";
    try {
      const data = {};
      for (const f of section.fields) {
        if (f.type === "imageUpload") continue;
        const el = document.getElementById(`f_${f.key}`);
        if (f.type === "richtext") {
          data[f.key] = el ? sanitizeRichHtml(el.innerHTML) : "";
        } else {
          data[f.key] = el ? el.value : "";
        }
      }
      for (const f of section.fields) {
        if (f.type !== "imageUpload") continue;
        const st = imageState[f.key];
        const uploadedUrls = [];
        for (const file of st.files) {
          const path = `${section.collectionName}/${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name}`;
          const fileRef = ref(storage, path);
          await uploadBytes(fileRef, file);
          uploadedUrls.push(await getDownloadURL(fileRef));
        }
        data[f.key] = [...st.urls, ...uploadedUrls];
      }
      if (section.scope === "branch") {
        if (state.profile.role !== "leader") {
          data.branchId = state.profile.branchId;
          data.branchName = state.profile.branchName;
        } else {
          const b = state.branches.find(x => x.id === data.branchId);
          data.branchName = b ? b.name : "";
        }
      }
      if (section.scope === "custom") {
        data.folderId = section.folderId;
      }
      data.updatedAt = new Date().toISOString();
      data.updatedBy = state.profile.name;

      if (existing) {
        await updateDoc(doc(db, section.collectionName, existing.id), data);
      } else {
        data.createdAt = new Date().toISOString();
        data.createdBy = state.profile.name;
        await addDoc(collection(db, section.collectionName), data);
      }
      root.innerHTML = "";
      showToast("저장되었습니다.");
      renderSection(section.key);
    } catch (err) {
      alert("저장 중 오류: " + err.message);
      saveBtn.disabled = false;
      saveBtn.textContent = "저장";
    }
  });
}


/* ===================== 관리자 화면 (지점 / 팀원) ===================== */
function renderAllMenuList() {
  const wrap = document.getElementById("allMenuList");
  const allBuiltIn = SECTIONS.map(withOverride).map(s => ({ ...s, isCustom: false }));
  const allFolders = state.customFolders.map(f => ({ ...withOverride(folderToSection(f)), isCustom: true, folderDocId: f.id }));
  const allItems = [...allBuiltIn, ...allFolders];

  wrap.innerHTML = `<table><thead><tr><th>메뉴 이름</th><th>그룹</th><th>색상</th><th></th></tr></thead><tbody>
    ${allItems.map(it => `<tr>
      <td>${escapeHtml(it.label)}</td>
      <td>${escapeHtml(it.group)}</td>
      <td><span class="dot" style="display:inline-block;background:${COLOR_HEX[it.color]};"></span></td>
      <td class="actions">
        <button class="icon-btn" data-edit-menu="${it.key}">수정</button>
        ${it.isCustom ? `<button class="icon-btn danger" data-del-folder="${it.folderDocId}">삭제</button>` : ""}
      </td>
    </tr>`).join("")}
  </tbody></table>`;

  wrap.querySelectorAll("[data-edit-menu]").forEach(btn => {
    btn.onclick = () => {
      const item = allItems.find(it => it.key === btn.dataset.editMenu);
      openMenuEditModal(item);
    };
  });
  wrap.querySelectorAll("[data-del-folder]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("이 폴더를 삭제하면 안의 게시물도 더 이상 보이지 않게 됩니다. 삭제할까요?")) return;
      await deleteDoc(doc(db, "customFolders", btn.dataset.delFolder));
      await loadCustomFolders();
      showToast("삭제되었습니다.");
      buildNav();
      markActiveNav("admin");
      renderAdmin();
    };
  });
}

function openMenuEditModal(item) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `<div class="modal-bg" id="modalBg">
    <div class="modal">
      <h3>메뉴 수정</h3>
      <form id="menuEditForm">
        <div class="field"><label>메뉴 이름</label><input type="text" id="menuEditLabel" value="${escapeHtml(item.label)}" required></div>
        <div class="field"><label>그룹</label>
          <select id="menuEditGroup">${GROUP_ORDER.map(g => `<option value="${g}" ${g === item.group ? "selected" : ""}>${g}</option>`).join("")}</select>
        </div>
        <div class="field"><label>색상</label>
          <select id="menuEditColor">
            <option value="blue" ${item.color === "blue" ? "selected" : ""}>파랑</option>
            <option value="green" ${item.color === "green" ? "selected" : ""}>초록</option>
            <option value="magenta" ${item.color === "magenta" ? "selected" : ""}>마젠타</option>
            <option value="neutral" ${item.color === "neutral" ? "selected" : ""}>회색(기본)</option>
          </select>
        </div>
        ${item.isCustom ? `<div class="field"><label>양식 종류</label>
          <select id="menuEditTemplate">
            <option value="standard" ${item.template !== "okr" ? "selected" : ""}>일반 (제목 + 내용 + 이미지)</option>
            <option value="okr" ${item.template === "okr" ? "selected" : ""}>OKR (시즌 · Objective · KR · KT)</option>
          </select>
          <p style="font-size:11px;color:var(--text-muted);margin-top:4px;">이미 등록된 게시물이 있는 상태에서 종류를 바꾸면 예전 글이 새 양식으로 안 보일 수 있어요.</p>
        </div>` : ""}
        <div class="grid-2" style="margin-top:10px;">
          <button type="button" class="btn secondary" id="cancelBtn">취소</button>
          <button type="submit" class="btn">저장</button>
        </div>
      </form>
    </div></div>`;
  document.getElementById("cancelBtn").onclick = () => root.innerHTML = "";
  document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") root.innerHTML = ""; });
  document.getElementById("menuEditForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = document.getElementById("menuEditLabel").value.trim();
    const group = document.getElementById("menuEditGroup").value;
    const color = document.getElementById("menuEditColor").value;
    if (!label) return;
    if (item.isCustom) {
      const template = document.getElementById("menuEditTemplate").value;
      await updateDoc(doc(db, "customFolders", item.folderDocId), { label, group, color, template });
      await loadCustomFolders();
    } else {
      await setDoc(doc(db, "menuOverrides", item.key), { label, group, color });
      await loadMenuOverrides();
    }
    root.innerHTML = "";
    showToast("저장되었습니다.");
    buildNav();
    markActiveNav("admin");
    renderAdmin();
  });
}

async function renderAdmin() {
  const main = document.getElementById("mainContent");
  main.innerHTML = `<div class="page-header"><div><h1>지점 · 팀원 관리</h1><p>지점을 추가하고 팀원 권한을 확인합니다.</p></div></div>
    <div class="card">
      <h2>지점 추가</h2>
      <form id="branchForm" class="grid-2">
        <input type="text" id="newBranchName" placeholder="지점 이름 (예: 강남점)" required>
        <button class="btn" type="submit">지점 추가</button>
      </form>
    </div>
    <div class="card"><h2>지점 목록</h2><div id="branchTable">불러오는 중...</div></div>
    <div class="card">
      <h2>전체 메뉴 관리</h2>
      <p style="font-size:12px;color:var(--text-muted);margin:-6px 0 14px;">기존 메뉴를 포함해 모든 메뉴의 이름·그룹·색상을 바꿀 수 있어요. 직접 만든 폴더는 삭제도 가능합니다.</p>
      <div id="allMenuList">불러오는 중...</div>
    </div>
    <div class="card">
      <h2>새 폴더(메뉴) 만들기</h2>
      <p style="font-size:12px;color:var(--text-muted);margin:-6px 0 14px;">제목·내용(표 포함 가능)·이미지를 자유롭게 올릴 수 있는 폴더를 직접 추가할 수 있어요. 코드 수정 없이 바로 메뉴에 반영됩니다.</p>
      <form id="folderForm" class="grid-2" style="align-items:end;">
        <div class="field" style="margin:0;"><label>폴더 이름</label><input type="text" id="newFolderLabel" placeholder="예: 채용 자료" required></div>
        <div class="field" style="margin:0;"><label>어느 그룹에 넣을까요?</label>
          <select id="newFolderGroup">${GROUP_ORDER.map(g => `<option value="${g}">${g}</option>`).join("")}</select>
        </div>
        <div class="field" style="margin:0;"><label>메뉴 색상</label>
          <select id="newFolderColor">
            <option value="blue">파랑</option>
            <option value="green">초록</option>
            <option value="magenta">마젠타</option>
            <option value="neutral" selected>회색(기본)</option>
          </select>
        </div>
        <div class="field" style="margin:0;"><label>작성 권한</label>
          <select id="newFolderWritable">
            <option value="leader">팀장만 작성</option>
            <option value="all">전원 작성 가능</option>
          </select>
        </div>
        <div class="field" style="margin:0;"><label>양식 종류</label>
          <select id="newFolderTemplate">
            <option value="standard">일반 (제목 + 내용 + 이미지)</option>
            <option value="okr">OKR (시즌 · Objective · KR · KT)</option>
          </select>
        </div>
        <button class="btn" type="submit" style="grid-column: span 2;">폴더 만들기</button>
      </form>
    </div>
    <div class="card"><h2>팀원 목록</h2><div id="userTable">불러오는 중...</div></div>`;

  renderAllMenuList();

  document.getElementById("branchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("newBranchName").value.trim();
    if (!name) return;
    await addDoc(collection(db, "branches"), { name, createdAt: new Date().toISOString() });
    await loadBranches();
    showToast("지점이 추가되었습니다.");
    buildNav();
    markActiveNav("admin");
    renderAdmin();
  });

  const branchWrap = document.getElementById("branchTable");
  if (!state.branches.length) {
    branchWrap.innerHTML = `<div class="empty-state">등록된 지점이 없습니다.</div>`;
  } else {
    branchWrap.innerHTML = `<table><thead><tr><th>지점명</th><th></th></tr></thead><tbody>
      ${state.branches.map(b => `<tr><td>${escapeHtml(b.name)}</td>
        <td class="actions"><button class="icon-btn danger" data-bid="${b.id}">삭제</button></td></tr>`).join("")}
    </tbody></table>`;
    branchWrap.querySelectorAll("[data-bid]").forEach(btn => {
      btn.onclick = async () => {
        if (!confirm("지점을 삭제하면 소속 데이터는 남아있지만 지점명 표시가 어긋날 수 있습니다. 삭제할까요?")) return;
        await deleteDoc(doc(db, "branches", btn.dataset.bid));
        await loadBranches();
        showToast("삭제되었습니다.");
        buildNav();
        markActiveNav("admin");
        renderAdmin();
      };
    });
  }

  document.getElementById("folderForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = document.getElementById("newFolderLabel").value.trim();
    if (!label) return;
    const group = document.getElementById("newFolderGroup").value;
    const color = document.getElementById("newFolderColor").value;
    const writable = document.getElementById("newFolderWritable").value;
    const template = document.getElementById("newFolderTemplate").value;
    await addDoc(collection(db, "customFolders"), { label, group, color, writable, template, createdAt: new Date().toISOString() });
    await loadCustomFolders();
    showToast("폴더가 생성되었습니다.");
    buildNav();
    markActiveNav("admin");
    renderAdmin();
  });

  const usersSnap = await getDocs(collection(db, "users"));
  const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const userWrap = document.getElementById("userTable");
  const roleLabel = (r) => r === "leader" ? "팀장" : r === "viewer" ? "전체 열람(뷰어)" : "팀원";
  userWrap.innerHTML = `<table><thead><tr><th>이름</th><th>이메일</th><th>지점</th><th>권한</th><th></th></tr></thead><tbody>
    ${users.map(u => `<tr>
      <td>${escapeHtml(u.name || "")}</td>
      <td>${escapeHtml(u.email || "")}</td>
      <td>${escapeHtml(u.branchName || "")}</td>
      <td>${roleLabel(u.role)}</td>
      <td class="actions">
        ${u.role !== "leader" ? `<button class="icon-btn" data-role-btn="leader" data-uid="${u.id}">팀장 권한 부여</button>` : ""}
        ${u.role !== "viewer" ? `<button class="icon-btn" data-role-btn="viewer" data-uid="${u.id}">전체 열람 권한 부여</button>` : ""}
        ${u.role !== "member" ? `<button class="icon-btn" data-role-btn="member" data-uid="${u.id}">일반 팀원으로</button>` : ""}
      </td>
    </tr>`).join("")}
  </tbody></table>`;
  userWrap.querySelectorAll("[data-role-btn]").forEach(btn => {
    btn.onclick = async () => {
      const target = btn.dataset.roleBtn;
      const labels = { leader: "팀장", viewer: "전체 열람(뷰어)", member: "일반 팀원" };
      if (!confirm(`이 사용자를 "${labels[target]}" 권한으로 바꿀까요?`)) return;
      await updateDoc(doc(db, "users", btn.dataset.uid), { role: target });
      showToast("권한이 변경되었습니다.");
      renderAdmin();
    };
  });
}

/* ===================== 유틸 ===================== */
window.cycleMeetingImgZoom = function (img) {
  const level = (parseInt(img.dataset.zoom || "0", 10) + 1) % 3;
  img.dataset.zoom = level;
  img.classList.remove("zoomed", "zoomed-more");
  if (level === 1) img.classList.add("zoomed");
  else if (level === 2) img.classList.add("zoomed-more");
  img.parentElement.classList.toggle("full", level > 0);
};

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));
}
function showToast(msg) {
  const root = document.getElementById("toastRoot");
  root.innerHTML = `<div class="toast">${msg}</div>`;
  setTimeout(() => root.innerHTML = "", 2200);
}
