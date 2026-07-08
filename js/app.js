import {
  auth, db, onAuthStateChanged, signOut,
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, getDocs, query, where, orderBy, serverTimestamp
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
    isMeetingLog:true,
    fields:[
      { key:"date", label:"날짜", type:"date" },
      { key:"attendees", label:"참석자", type:"text" },
      { key:"agenda", label:"안건", type:"textarea" },
      { key:"decisions", label:"결정사항", type:"textarea" },
      { key:"followUp", label:"후속조치", type:"textarea" },
      { key:"images", label:"회의 슬라이드 이미지 (구글 드라이브 링크, 줄바꿈으로 여러 개)", type:"driveImages" }
    ], columns:["date","attendees","agenda"] },

  { key:"directorMeeting", label:"지점 원장 미팅 일지", group:"일정 · 미팅", color:"green",
    collectionName:"directorMeetings", scope:"branch", writable:"leader",
    desc:"지점 원장님과의 미팅 내용을 기록합니다. (팀장만 열람 가능)",
    hasBranchSubmenu:true, leaderOnly:true,
    fields:[
      { key:"date", label:"날짜", type:"date" },
      { key:"branchId", label:"지점", type:"branchSelect" },
      { key:"director", label:"원장 이름", type:"text" },
      { key:"content", label:"미팅 내용", type:"textarea" },
      { key:"followUp", label:"후속조치", type:"textarea" }
    ], columns:["date","branchName","director"] },

  { key:"memberMeeting", label:"지점 팀원 개별 미팅 일지", group:"일정 · 미팅", color:"green",
    collectionName:"memberMeetings", scope:"branch", writable:"leader-and-branch",
    desc:"지점 팀원과의 개별 미팅 내용을 기록합니다.",
    hasBranchSubmenu:true,
    fields:[
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
    collectionName:"operations", scope:"branch", writable:"leader-and-branch",
    desc:"지점 운영과 관련된 자료를 관리합니다.",
    fields:[
      { key:"branchId", label:"지점", type:"branchSelect" },
      { key:"title", label:"제목", type:"text" },
      { key:"content", label:"내용", type:"textarea" },
      { key:"fileLink", label:"첨부 링크(URL)", type:"text" }
    ], columns:["branchName","title"] },

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
    ], columns:["title"] }
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

const driveImageCache = {}; // fileId -> blob URL (같은 세션 안에서 재사용)
async function fetchDriveImageBlobUrl(fileId) {
  if (driveImageCache[fileId]) return driveImageCache[fileId];
  if (!googleAccessToken) await requestGoogleAuth();
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  let res = await fetch(url, { headers: { Authorization: `Bearer ${googleAccessToken}` } });
  if (res.status === 401) {
    googleAccessToken = null;
    await requestGoogleAuth();
    res = await fetch(url, { headers: { Authorization: `Bearer ${googleAccessToken}` } });
  }
  if (!res.ok) throw new Error(`이미지를 불러오지 못했습니다 (${res.status})`);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  driveImageCache[fileId] = objUrl;
  return objUrl;
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
      renderScheduleSheet(SECTIONS.find(s => s.key === "schedule"));
    };
  });
}

/* ===================== 지점 성과 지표 - 구글 시트 임베드 (지점별 탭) ===================== */
function stripBranchSuffix(name) {
  return String(name || "").replace(/점$/, "");
}

function renderPlainSheetTable(container, rows) {
  if (!rows.length) { container.innerHTML = `<div class="empty-state">이 시트에 표시할 데이터가 없습니다.</div>`; return; }
  const colIndexes = [];
  for (let ci = 1; ci < rows[0].length; ci++) colIndexes.push(ci); // 0번(첫) 열은 제외

  let html = `<table style="min-width:600px;"><thead><tr>`;
  colIndexes.forEach((ci, idx) => {
    const stickyStyle = idx === 0 ? "position:sticky;left:0;background:#F4FAEF;z-index:2;" : "";
    html += `<th style="position:sticky;top:0;background:#F4FAEF;${stickyStyle}">${escapeHtml(String(rows[0][ci] ?? ""))}</th>`;
  });
  html += `</tr></thead><tbody>`;
  for (let ri = 1; ri < rows.length; ri++) {
    html += `<tr>`;
    colIndexes.forEach((ci, idx) => {
      const isSticky = idx === 0;
      const style = isSticky ? "font-weight:700;white-space:nowrap;position:sticky;left:0;background:#fff;" : "white-space:nowrap;";
      html += `<td style="${style}">${escapeHtml(String(rows[ri][ci] ?? ""))}</td>`;
    });
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  container.innerHTML = html;
}

async function renderBranchSheet(section) {
  const main = document.getElementById("mainContent");
  const branchId = state.profile.role === "leader" ? state.branchFilter[section.key] : state.profile.branchId;
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

/* ===================== 전역 상태 ===================== */
const state = { user:null, profile:null, branches:[], currentSection:"schedule", branchFilter:{}, navExpanded:{} };

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
    <div class="role">${state.profile.role === "leader" ? "팀장" : "팀원 · " + escapeHtml(state.profile.branchName || "")}</div>`;

  await loadBranches();
  buildNav();
  renderSection(state.currentSection);
});

document.getElementById("logoutBtn").onclick = () => signOut(auth);

async function loadBranches() {
  const snap = await getDocs(collection(db, "branches"));
  state.branches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ===================== 사이드바 네비게이션 ===================== */
function buildNav() {
  const nav = document.getElementById("navGroups");
  let html = "";
  GROUP_ORDER.forEach(group => {
    const items = SECTIONS.filter(s => s.group === group && (!s.leaderOnly || state.profile.role === "leader"));
    html += `<div class="nav-group"><div class="nav-group-label">${group}</div>`;
    items.forEach(s => {
      const expandable = s.hasBranchSubmenu && state.profile.role === "leader";
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
    };
  });
}

function markActiveNav(key) {
  const branchId = state.branchFilter[key] || "";
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.key === key && !el.classList.contains("nav-subitem")));
  document.querySelectorAll(".nav-subitem").forEach(el => el.classList.toggle("active", el.dataset.key === key && (el.dataset.branch || "") === branchId));
}

/* ===================== 권한 판단 ===================== */
function canWriteSection(section) {
  if (state.profile.role === "leader") return true;
  if (section.writable === "all") return true;
  if (section.writable === "leader-and-branch") return true; // 자기 지점 데이터만, 저장 시 branchId 강제
  return false;
}
function canEditDoc(section, data) {
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

  const section = SECTIONS.find(s => s.key === key);
  if (section.isScheduleSheet) { renderScheduleSheet(section); return; }
  if (section.isMeetingLog) { renderMeetingLog(section); return; }
  if (section.isBranchSheet) { renderBranchSheet(section); return; }
  const branchId = state.branchFilter[key];
  const branchLabel = section.hasBranchSubmenu
    ? (state.profile.role === "leader"
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
  if (section.scope === "branch" && state.profile.role !== "leader") {
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
function extractDriveId(link) {
  const str = String(link || "").trim();
  const m = str.match(/\/d\/([a-zA-Z0-9_-]+)/) || str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

async function renderMeetingLog(section) {
  const main = document.getElementById("mainContent");
  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}</h1>
        <p>${section.desc}</p>
      </div>
      <div style="display:flex;gap:8px;">
        <a href="https://docs.google.com/presentation/d/1xrRu5zRNooseQG-fHA4D8v6SDc1eEsDmMgc7e2pDhUs/edit" target="_blank" rel="noopener" class="btn small secondary" style="text-decoration:none;display:inline-flex;align-items:center;">회의록 원본 열기</a>
        <button class="btn small" id="googleAuthBtn" type="button">${googleAccessToken ? "구글 계정 다시 연결" : "구글 계정으로 연결"}</button>
        ${canWriteSection(section) ? `<button class="btn small" id="addBtn">+ 새로 등록</button>` : ""}
      </div>
    </div>
    <div id="meetingList">불러오는 중...</div>`;

  document.getElementById("googleAuthBtn").onclick = async () => {
    try { await requestGoogleAuth(); showToast("구글 계정이 연결되었습니다."); renderSection(section.key); }
    catch (err) { alert(err.message); }
  };
  if (canWriteSection(section)) {
    document.getElementById("addBtn").onclick = () => openModal(section, null);
  }

  const docs = await fetchDocs(section);
  const wrap = document.getElementById("meetingList");
  if (!docs.length) {
    wrap.innerHTML = `<div class="card"><div class="empty-state"><div class="shape"></div>아직 등록된 회의 일지가 없습니다.</div></div>`;
    return;
  }

  wrap.innerHTML = docs.map(d => {
    const editable = canEditDoc(section, d);
    const images = (d.images || []).filter(Boolean);
    return `<div class="card meeting-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:800;font-size:15px;">${escapeHtml(d.date || "")} <span style="font-weight:400;color:var(--text-muted);font-size:13px;">· 참석자: ${escapeHtml(d.attendees || "-")}</span></div>
        </div>
        ${editable ? `<div>
          <button class="icon-btn" data-act="edit" data-id="${d.id}">수정</button>
          <button class="icon-btn danger" data-act="del" data-id="${d.id}">삭제</button>
        </div>` : ""}
      </div>
      ${d.agenda ? `<p style="margin:12px 0 4px;"><strong>안건</strong><br>${escapeHtml(d.agenda).replace(/\n/g, "<br>")}</p>` : ""}
      ${d.decisions ? `<p style="margin:12px 0 4px;"><strong>결정사항</strong><br>${escapeHtml(d.decisions).replace(/\n/g, "<br>")}</p>` : ""}
      ${d.followUp ? `<p style="margin:12px 0 4px;"><strong>후속조치</strong><br>${escapeHtml(d.followUp).replace(/\n/g, "<br>")}</p>` : ""}
      ${images.length ? `<div class="meeting-gallery" data-images="${escapeHtml(JSON.stringify(images))}" id="gallery_${d.id}">
        ${images.map(() => `<div class="meeting-img meeting-img-loading">불러오는 중...</div>`).join("")}
      </div>` : ""}
    </div>`;
  }).join("");

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

  // 각 카드의 이미지를 OAuth로 하나씩 불러와서 채워넣기
  wrap.querySelectorAll(".meeting-gallery").forEach(async (galleryEl) => {
    const images = JSON.parse(galleryEl.dataset.images);
    const placeholders = galleryEl.querySelectorAll(".meeting-img-loading");
    for (let i = 0; i < images.length; i++) {
      const link = images[i];
      const slot = placeholders[i];
      const id = extractDriveId(link);
      if (!id) { slot.outerHTML = `<div class="meeting-img-broken">유효한 드라이브 링크가 아니에요.</div>`; continue; }
      try {
        const blobUrl = await fetchDriveImageBlobUrl(id);
        const img = document.createElement("img");
        img.src = blobUrl;
        img.className = "meeting-img";
        img.loading = "lazy";
        img.onclick = () => img.classList.toggle("zoomed");
        slot.replaceWith(img);
      } catch (err) {
        slot.outerHTML = `<div class="meeting-img-broken">이미지를 불러올 수 없어요.<br><a href="${link}" target="_blank" rel="noopener">드라이브에서 열기</a></div>`;
      }
    }
  });
}

/* ===================== 등록/수정 모달 ===================== */
function fieldInput(field, value) {
  const v = value ?? "";
  if (field.type === "textarea") {
    return `<textarea id="f_${field.key}" rows="3">${escapeHtml(String(v))}</textarea>`;
  }
  if (field.type === "driveImages") {
    const text = Array.isArray(v) ? v.join("\n") : String(v || "");
    return `<textarea id="f_${field.key}" rows="3" placeholder="https://drive.google.com/file/d/.../view\nhttps://drive.google.com/file/d/.../view">${escapeHtml(text)}</textarea>`;
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
  const fieldsHtml = section.fields.map(f => `
    <div class="field"><label>${f.label}</label>${fieldInput(f, existing ? existing[f.key] : "")}</div>
  `).join("");

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

  document.getElementById("entryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("saveBtn");
    saveBtn.disabled = true;
    saveBtn.textContent = "저장 중...";
    try {
      const data = {};
      section.fields.forEach(f => {
        const el = document.getElementById(`f_${f.key}`);
        if (f.type === "driveImages") {
          data[f.key] = el ? el.value.split("\n").map(s => s.trim()).filter(Boolean) : [];
        } else {
          data[f.key] = el ? el.value : "";
        }
      });
      if (section.scope === "branch") {
        if (state.profile.role !== "leader") {
          data.branchId = state.profile.branchId;
          data.branchName = state.profile.branchName;
        } else {
          const b = state.branches.find(x => x.id === data.branchId);
          data.branchName = b ? b.name : "";
        }
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
    <div class="card"><h2>팀원 목록</h2><div id="userTable">불러오는 중...</div></div>`;

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

  const usersSnap = await getDocs(collection(db, "users"));
  const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const userWrap = document.getElementById("userTable");
  userWrap.innerHTML = `<table><thead><tr><th>이름</th><th>이메일</th><th>지점</th><th>권한</th><th></th></tr></thead><tbody>
    ${users.map(u => `<tr>
      <td>${escapeHtml(u.name || "")}</td>
      <td>${escapeHtml(u.email || "")}</td>
      <td>${escapeHtml(u.branchName || "")}</td>
      <td>${u.role === "leader" ? "팀장" : "팀원"}</td>
      <td class="actions">${u.role === "leader" ? "" : `<button class="icon-btn" data-uid="${u.id}">팀장 권한 부여</button>`}</td>
    </tr>`).join("")}
  </tbody></table>`;
  userWrap.querySelectorAll("[data-uid]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("이 팀원에게 팀장 권한을 부여할까요?")) return;
      await updateDoc(doc(db, "users", btn.dataset.uid), { role: "leader" });
      showToast("권한이 변경되었습니다.");
      renderAdmin();
    };
  });
}

/* ===================== 유틸 ===================== */
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));
}
function showToast(msg) {
  const root = document.getElementById("toastRoot");
  root.innerHTML = `<div class="toast">${msg}</div>`;
  setTimeout(() => root.innerHTML = "", 2200);
}
