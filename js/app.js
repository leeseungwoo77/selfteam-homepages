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
  { key:"schedule", label:"팀장 일정", group:"일정·미팅", color:"green",
    collectionName:"scheduleEntries", scope:"team", writable:"leader",
    desc:"팀장 일정을 월 단위로 직접 입력하고 관리합니다.",
    isMonthlySchedule:true },

  { key:"teamMeeting", label:"팀 회의 일지", group:"일정·미팅", color:"green",
    collectionName:"teamMeetings", scope:"team", writable:"all",
    desc:"팀 전체 회의 내용을 기록합니다.",
    cardView:true, headerFields:["title","date","attendees"],
    extraLink:{ label:"회의록 원본 열기", url:"https://docs.google.com/presentation/d/1xrRu5zRNooseQG-fHA4D8v6SDc1eEsDmMgc7e2pDhUs/edit" },
    fields:[
      { key:"title", label:"제목", type:"text" },
      { key:"date", label:"날짜", type:"date" },
      { key:"attendees", label:"참석자", type:"text" },
      { key:"agenda", label:"안건", type:"richtext", tall:true },
      { key:"followUp", label:"후속조치", type:"richtext" },
      { key:"images", label:"회의 슬라이드 이미지", type:"imageUpload" }
    ], columns:["date","attendees","agenda"] },

  { key:"directorMeeting", label:"지점 원장 미팅 일지", group:"일정·미팅", color:"green",
    collectionName:"directorMeetings", scope:"branch", writable:"leader",
    desc:"지점 원장님과의 미팅 내용을 기록합니다. (팀장만 열람 가능)",
    leaderOnly:true, isMeetingGrid:true, headerFields:["title","date","branchName","director"],
    fields:[
      { key:"title", label:"제목", type:"text" },
      { key:"date", label:"날짜", type:"date" },
      { key:"branchId", label:"지점", type:"branchSelect" },
      { key:"director", label:"원장 이름", type:"text" },
      { key:"content", label:"미팅 내용", type:"richtext" },
      { key:"followUp", label:"후속조치", type:"textarea" },
      { key:"images", label:"첨부파일 (이미지·PDF·PPT)", type:"imageUpload" }
    ], columns:["date","branchName","director"] },

  { key:"memberMeeting", label:"지점 팀원 개별 미팅 일지", group:"일정·미팅", color:"green",
    collectionName:"memberMeetings", scope:"branch", writable:"leader-and-branch",
    desc:"지점 팀원과의 개별 미팅 내용을 기록합니다.",
    isMeetingGrid:true, headerFields:["title","date","branchName","memberName"],
    fields:[
      { key:"title", label:"제목", type:"text" },
      { key:"date", label:"날짜", type:"date" },
      { key:"branchId", label:"지점", type:"branchSelect" },
      { key:"memberName", label:"팀원 이름", type:"text" },
      { key:"content", label:"미팅 내용", type:"textarea" },
      { key:"followUp", label:"후속조치", type:"textarea" },
      { key:"images", label:"첨부파일 (이미지·PDF·PPT)", type:"imageUpload" }
    ], columns:["date","branchName","memberName"] },

  { key:"performance", label:"지점 성과 지표", group:"성과·전략", color:"blue",
    desc:"고객지표 · 경영지표 등 평가지표를 그대로 보여줍니다.",
    isEvalSheet:true },

  { key:"notice", label:"팀 공지사항", group:"소통·협업", color:"magenta",
    collectionName:"notices", scope:"team", writable:"leader",
    desc:"팀 전체 공지사항입니다.",
    cardView:true, headerFields:["title","important"],
    fields:[
      { key:"title", label:"제목", type:"text" },
      { key:"important", label:"중요 공지", type:"importanceSelect" },
      { key:"content", label:"내용", type:"textarea" },
      { key:"images", label:"첨부파일 (이미지·PDF·PPT)", type:"imageUpload" }
    ], columns:["title","important"] },

  { key:"operation", label:"지점 운영 자료", group:"자료실", color:"neutral",
    desc:"지점별 자료 링크를 한눈에 모아 봅니다. (지점 × 양식 표)",
    isOpsGrid:true },

  { key:"leadership", label:"리더십 자료", group:"자료실", color:"neutral",
    collectionName:"leadership", scope:"team", writable:"leader",
    desc:"리더십 관련 자료입니다.",
    cardView:true, headerFields:["title"],
    fields:[
      { key:"title", label:"제목", type:"text" },
      { key:"content", label:"내용", type:"textarea" },
      { key:"fileLink", label:"첨부 링크(URL)", type:"link" },
      { key:"images", label:"첨부파일 (이미지·PDF·PPT)", type:"imageUpload" }
    ], columns:["title"] },

  { key:"study", label:"팀 스터디 자료", group:"자료실", color:"neutral",
    collectionName:"study", scope:"team", writable:"all",
    desc:"팀 스터디 자료를 함께 공유합니다.",
    cardView:true, headerFields:["title"],
    fields:[
      { key:"title", label:"제목", type:"text" },
      { key:"content", label:"내용", type:"textarea" },
      { key:"fileLink", label:"첨부 링크(URL)", type:"link" },
      { key:"images", label:"첨부파일 (이미지·PDF·PPT)", type:"imageUpload" }
    ], columns:["title"] },

  { key:"roster", label:"지점 인적 구성", group:"자료실", color:"neutral",
    desc:"지점별 인력 이동 현황(잔류/신규입사/이동/퇴사)을 색깔 그대로 보여줍니다.",
    isRosterGrid:true }
];
const GROUP_ORDER = ["일정·미팅", "성과·전략", "소통·협업", "자료실"];
const COLOR_HEX = { blue:"var(--blue-bright)", green:"var(--green-bright)", magenta:"var(--magenta-bright)", neutral:"#9CA88F" };

/* ===================== 팀장 일정 - 구글 시트 연동 (OAuth) =====================
   회사 도메인으로만 공유된 시트라, 사용자가 직접 구글 로그인(OAuth)해서
   Sheets API로 읽어옵니다. 시트 하나(연도별 탭)에 그 해의 모든 날짜가
   열로 쭉 이어져 있고, 1행의 "MM. DD(요일)" 텍스트에서 월을 읽어 필터링합니다.
=========================================================== */
const GOOGLE_CLIENT_ID = "708745145673-j0ljnhqsl7gg0djq5p9j7uop040thqbe.apps.googleusercontent.com";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly";
const LOCATION_COLORS = {
  "에듀": "#E03C3C", "에듀본사": "#E03C3C", "상상": "#F5A623", "전능": "#2979FF", "전농": "#2979FF",
  "돈암": "#00C853", "행당": "#D3339C", "별내": "#FFD600", "다산": "#8E1E1E"
};
// 배경색이 밝아서 흰 글씨는 잘 안 보이는 지점은 검정 글씨로 표시합니다.
const LOCATION_TEXT_COLORS = {
  "돈암": "#000000", "별내": "#000000"
};
function matchLocationColor(str) {
  if (LOCATION_COLORS[str]) return LOCATION_COLORS[str];
  for (const key of Object.keys(LOCATION_COLORS)) {
    if (str.includes(key)) return LOCATION_COLORS[key];
  }
  return null;
}
function matchLocationTextColor(str) {
  if (LOCATION_TEXT_COLORS[str]) return LOCATION_TEXT_COLORS[str];
  for (const key of Object.keys(LOCATION_TEXT_COLORS)) {
    if (str.includes(key)) return LOCATION_TEXT_COLORS[key];
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

/* ===================== 팀장 일정 - 홈페이지에서 직접 입력 (월 단위, 30분 단위 시간표) ===================== */
function pad2(n) { return String(n).padStart(2, "0"); }
function ymd(y, m, d) { return `${y}-${pad2(m)}-${pad2(d)}`; }
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
function weekdayLabel(y, m, d) {
  return ["일","월","화","수","목","금","토"][new Date(y, m - 1, d).getDay()];
}
function generateTimeSlots() {
  const slots = [];
  for (let h = 10; h < 22; h++) { slots.push(`${pad2(h)}:00`); slots.push(`${pad2(h)}:30`); }
  return slots; // 10:00 ~ 21:30, 30분 단위
}
const SCHEDULE_TIME_SLOTS = generateTimeSlots();
const SCHEDULE_NOTE_ROWS = ["에듀본사", "상상", "전농", "돈암", "행당", "별내", "다산"];
const SCHEDULE_ROW_ORDER = ["location", ...SCHEDULE_NOTE_ROWS.map(l => "note_" + l), ...SCHEDULE_TIME_SLOTS.map(s => "time_" + s)];

const scheduleViewState = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };

function scheduleRowKey(kind) { return kind; } // "location" | "note_에듀본사" | "time_10:00" 등

const SCHEDULE_KEYWORD_RULES = [
  { word: "연차", bg: "#000000", color: "#fff" },
  { word: "회의", bg: "#E8938C", color: "#fff" },
  { word: "식사", bg: "#BFBFBF", color: "#000" },
  { word: "생일", bg: "#8E44AD", color: "#fff" },
  { word: "이동", bg: "#F0E4C8", color: "#000" },
  { word: "휴무", bg: "#FFFFFF", color: "#E03C3C" }
];
function computeScheduleCellStyle(text, explicitColor, explicitTextColor) {
  // 지점명이나 "연차/회의/식사" 같은 키워드가 글자에 들어있으면, 예전에 지정해둔(또는 붙여넣기로 딸려온)
  // 수동 색상이 남아있어도 자동 서식이 항상 우선 적용되도록 합니다.
  if (text) {
    for (const rule of SCHEDULE_KEYWORD_RULES) {
      if (text.includes(rule.word)) return { bg: rule.bg, color: rule.color };
    }
    const autoBg = matchLocationColor(text);
    if (autoBg) {
      const autoTextColor = matchLocationTextColor(text);
      return { bg: autoBg, color: autoTextColor || "#fff" };
    }
  }
  if (explicitColor || explicitTextColor) {
    return { bg: explicitColor || null, color: explicitTextColor || (explicitColor ? "#fff" : "inherit") };
  }
  return { bg: null, color: "inherit" };
}

function findAdjacentCell(input, direction) {
  const td = input.closest("td");
  if (!td) return null;
  const tr = td.parentElement;
  const colIndex = td.cellIndex;
  let targetTd = null;
  if (direction === "up" || direction === "down") {
    const targetRow = direction === "up" ? tr.previousElementSibling : tr.nextElementSibling;
    if (!targetRow) return null;
    targetTd = targetRow.cells[colIndex];
  } else {
    targetTd = direction === "left" ? td.previousElementSibling : td.nextElementSibling;
  }
  return targetTd ? targetTd.querySelector(".sched-cell") : null;
}

async function renderMonthlySchedule(section) {
  const main = document.getElementById("mainContent");
  const canEdit = canWriteSection(section);
  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}</h1>
        <p>${section.desc}${canEdit ? " · 칸을 클릭해서 바로 입력하고, 다른 곳을 클릭하면 저장돼요." : ""}</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="icon-btn" id="prevMonthBtn" style="font-size:18px;">‹</button>
        <span id="monthLabel" style="font-weight:800;font-size:15px;min-width:110px;text-align:center;"></span>
        <button class="icon-btn" id="nextMonthBtn" style="font-size:18px;">›</button>
      </div>
    </div>
    ${canEdit ? `<div class="card" style="padding:12px 20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:12px;font-weight:700;color:var(--text-muted);">선택한 칸 서식:</span>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;">배경색 <input type="color" id="cellBgPicker" value="#ffffff"></label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;">글자색 <input type="color" id="cellTextPicker" value="#000000"></label>
      <button class="btn small secondary" id="cellClearFormatBtn" type="button">자동 서식으로 되돌리기</button>
      <span id="activeCellHint" style="font-size:11px;color:var(--text-muted);">먼저 표에서 칸을 클릭한 뒤 색을 골라주세요.</span>
    </div>` : ""}
    <div id="scheduleTopScroll" style="overflow-x:auto;overflow-y:hidden;height:16px;margin-bottom:4px;"><div id="scheduleTopScrollInner" style="height:1px;"></div></div>
    <div class="card" id="scheduleScrollCard" style="overflow:auto;max-height:calc(100vh - 190px);"><div id="scheduleCalendar">불러오는 중...</div></div>`;

  document.getElementById("prevMonthBtn").onclick = () => {
    scheduleViewState.month--;
    if (scheduleViewState.month < 1) { scheduleViewState.month = 12; scheduleViewState.year--; }
    renderMonthlySchedule(section);
  };
  document.getElementById("nextMonthBtn").onclick = () => {
    scheduleViewState.month++;
    if (scheduleViewState.month > 12) { scheduleViewState.month = 1; scheduleViewState.year++; }
    renderMonthlySchedule(section);
  };
  document.getElementById("monthLabel").textContent = `${scheduleViewState.year}년 ${scheduleViewState.month}월`;

  const { year, month } = scheduleViewState;
  const start = ymd(year, month, 1);
  const end = ymd(year, month, daysInMonth(year, month));
  const q = query(collection(db, "scheduleEntries"), where("date", ">=", start), where("date", "<=", end));
  const snap = await getDocs(q);
  const byDate = {};
  snap.docs.forEach(d => { byDate[d.id] = d.data(); });

  const nDays = daysInMonth(year, month);
  const dates = [];
  for (let d = 1; d <= nDays; d++) dates.push(d);

  const cellBase = "white-space:normal;word-break:keep-all;overflow-wrap:break-word;min-width:80px;max-width:160px;text-align:center;border-right:1px solid var(--border);";
  const leftLabelStyle = "position:sticky;left:0;background:#fff;z-index:5;white-space:nowrap;font-weight:700;padding:5px 8px;border-right:1px solid var(--border);text-align:center;";
  const rightLabelStyle = "position:sticky;right:0;background:#fff;z-index:5;white-space:normal;word-break:keep-all;font-weight:700;padding:5px 4px;border-left:1px solid var(--border);box-sizing:border-box;text-align:center;line-height:1.2;";

  function getCellValue(dateStr, rowKey) {
    const entry = byDate[dateStr];
    const raw = entry && entry.cells && entry.cells[rowKey];
    if (!raw) return { text: "", color: null, textColor: null };
    if (typeof raw === "string") return { text: raw, color: null, textColor: null }; // 예전 방식(문자열만 저장) 호환
    return { text: raw.text || "", color: raw.color || null, textColor: raw.textColor || null };
  }

  function cellHtml(dateStr, rowKey, extraStyle) {
    const cell = getCellValue(dateStr, rowKey);
    const { bg, color } = computeScheduleCellStyle(cell.text, cell.color, cell.textColor);
    const bgStyle = bg ? `background:${bg};color:${color};font-weight:700;` : "";
    const extra = extraStyle || "";
    if (canEdit) {
      return `<td style="${cellBase}${bgStyle}${extra}padding:0;border-radius:4px;">
        <input type="text" class="sched-cell" data-date="${dateStr}" data-row="${rowKey}" value="${escapeHtml(cell.text)}"
          style="display:block;width:100%;max-width:100%;box-sizing:border-box;border:none;background:transparent;color:inherit;font-weight:inherit;text-align:center;outline:none;font-family:inherit;font-size:inherit;"></td>`;
    }
    return `<td style="${cellBase}${bgStyle}${extra}padding:5px 10px;border-radius:4px;">${escapeHtml(cell.text)}</td>`;
  }

  let html = `<table class="table-compact" style="width:max-content;border-collapse:separate;border-spacing:0;table-layout:fixed;">
    <colgroup>
      <col style="width:90px;">
      ${dates.map(() => `<col style="width:100px;">`).join("")}
    </colgroup>
    <thead>
    <tr>
      <th style="position:sticky;left:0;top:0;background:#F4FAEF;z-index:6;border-right:1px solid var(--border);">날짜</th>
      ${dates.map(d => {
        const wd = weekdayLabel(year, month, d);
        const wdColor = wd === "토" ? "var(--blue-deep)" : wd === "일" ? "var(--danger)" : "var(--text-main)";
        return `<th data-date="${ymd(year, month, d)}" style="position:sticky;top:0;background:#F4FAEF;z-index:4;color:${wdColor};border-right:1px solid var(--border);">${month}.${pad2(d)}(${wd})</th>`;
      }).join("")}
    </tr>
  </thead><tbody>`;

  // 근무장소 행
  html += `<tr><td style="${leftLabelStyle}">근무장소</td>`;
  dates.forEach(d => { html += cellHtml(ymd(year, month, d), "location"); });
  html += `</tr>`;

  // 지점별 특이사항 행
  SCHEDULE_NOTE_ROWS.forEach(rowLabel => {
    const rowColor = LOCATION_COLORS[rowLabel] || "#9CA88F";
    const rowTextColor = LOCATION_TEXT_COLORS[rowLabel] || "#fff";
    html += `<tr><td style="${leftLabelStyle}background:${rowColor};color:${rowTextColor};">${escapeHtml(rowLabel)}</td>`;
    dates.forEach(d => { html += cellHtml(ymd(year, month, d), "note_" + rowLabel); });
    html += `</tr>`;
  });

  // 30분 단위 시간표 행
  SCHEDULE_TIME_SLOTS.forEach((slot, si) => {
    const dividerStyle = si === 0 ? "border-top:3px solid var(--text-main);" : "";
    html += `<tr><td style="${leftLabelStyle}${dividerStyle}">${slot}</td>`;
    dates.forEach(d => { html += cellHtml(ymd(year, month, d), "time_" + slot, dividerStyle); });
    html += `</tr>`;
  });

  html += `</tbody></table>`;
  document.getElementById("scheduleCalendar").innerHTML = html;

  // 표가 옆으로 길어서 스크롤바가 화면 맨 아래에만 있으면 찾기 불편하니, 표 위에도 스크롤바를 하나 더 만들어서 서로 맞물려 움직이게 합니다.
  const scrollCard = document.getElementById("scheduleScrollCard");
  const topScroll = document.getElementById("scheduleTopScroll");
  const topScrollInner = document.getElementById("scheduleTopScrollInner");
  const scheduleTable = document.querySelector("#scheduleCalendar table");
  if (scrollCard && topScroll && topScrollInner && scheduleTable) {
    // 표 자체에 이미 여유 공간(margin-right:100px)을 넉넉히 붙여놨어요. 위쪽 미러 스크롤바 폭만 실제 폭에 맞춰줍니다.
    const syncWidths = () => {
      topScrollInner.style.width = scheduleTable.scrollWidth + "px";
      const scrollbarGutter = scrollCard.offsetWidth - scrollCard.clientWidth;
      topScroll.style.paddingRight = scrollbarGutter + "px";
    };
    // 폰트/셀 크기가 자리 잡은 뒤에 폭을 재도록 한 프레임 뒤, 그리고 폰트 로딩이 끝난 뒤에도 다시 계산합니다.
    syncWidths();
    requestAnimationFrame(syncWidths);
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(syncWidths); }
    setTimeout(syncWidths, 300);
    window.addEventListener("resize", syncWidths);

    let syncing = false;
    const syncByRatio = (from, to) => {
      if (syncing) return;
      syncing = true;
      const fromMax = from.scrollWidth - from.clientWidth;
      const toMax = to.scrollWidth - to.clientWidth;
      to.scrollLeft = fromMax > 0 ? (from.scrollLeft / fromMax) * toMax : 0;
      syncing = false;
    };
    topScroll.addEventListener("scroll", () => syncByRatio(topScroll, scrollCard));
    scrollCard.addEventListener("scroll", () => syncByRatio(scrollCard, topScroll));


    // 이번 달을 보고 있을 때는, 오늘 날짜 칸이 (왼쪽에 고정된 라벨 열 바로 다음) 화면 맨 왼쪽에 오도록 자동으로 스크롤합니다.
    const today = new Date();
    if (year === today.getFullYear() && month === today.getMonth() + 1) {
      const scrollToToday = () => {
        // th의 offsetLeft를 재는 대신, 이미 고정해둔 칸 폭(날짜 칸 100px)으로 직접 계산합니다.
        // 레이아웃이 아직 자리 잡기 전에 재면 값이 틀어질 수 있어서, 계산 자체를 폰트/레이아웃 타이밍에 영향받지 않게 합니다.
        const dayIndex = today.getDate() - 1; // 이 달의 며칠째인지 (0부터 시작)
        const target = Math.max(0, dayIndex * 100);
        scrollCard.scrollLeft = target;
        syncByRatio(scrollCard, topScroll);
      };
      scrollToToday();
      requestAnimationFrame(scrollToToday);
      if (document.fonts && document.fonts.ready) { document.fonts.ready.then(scrollToToday); }
      setTimeout(scrollToToday, 300);
    }
  }

  let activeCellInput = null;

  if (canEdit) {
    document.querySelectorAll(".sched-cell").forEach(input => {
      input.addEventListener("focus", () => {
        activeCellInput = input;
        document.getElementById("activeCellHint").textContent = `${input.dataset.date} 칸 선택됨`;
        document.querySelectorAll("#scheduleCalendar td.sched-row-active").forEach(td => td.classList.remove("sched-row-active"));
        const rowLabelTd = input.closest("tr")?.querySelector("td:first-child");
        if (rowLabelTd) rowLabelTd.classList.add("sched-row-active");
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const below = findAdjacentCell(input, "down");
          if (below) { below.focus(); below.select(); } else { input.blur(); }
          return;
        }
        // Shift/Ctrl/Cmd/Alt를 누르고 있으면 글자 선택·복사 등 원래 하려던 동작을 방해하지 않도록 그냥 둡니다.
        if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
        const arrowMap = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
        if (!arrowMap[e.key]) return;
        const hasSelection = input.selectionStart !== input.selectionEnd;
        // 좌우 이동은 커서가 글자 맨 앞/맨 끝에 있고 선택된 글자가 없을 때만 옆 칸으로 넘어가고,
        // 글자 중간에 커서가 있을 땐 그냥 커서만 움직이게(원래 입력창 동작) 둡니다.
        if (e.key === "ArrowLeft" && (hasSelection || input.selectionStart !== 0)) return;
        if (e.key === "ArrowRight" && (hasSelection || input.selectionEnd !== input.value.length)) return;
        const target = findAdjacentCell(input, arrowMap[e.key]);
        if (target) { e.preventDefault(); target.focus(); target.select(); }
      });
      input.addEventListener("blur", async () => {
        const dateStr = input.dataset.date;
        const rowKey = input.dataset.row;
        const value = input.value.trim();
        try {
          if (!byDate[dateStr]) byDate[dateStr] = { date: dateStr, cells: {} };
          if (!byDate[dateStr].cells) byDate[dateStr].cells = {};
          const existing = byDate[dateStr].cells[rowKey] || {};
          byDate[dateStr].cells[rowKey] = { text: value, color: existing.color || null, textColor: existing.textColor || null };
          await setDoc(doc(db, "scheduleEntries", dateStr), { date: dateStr, cells: byDate[dateStr].cells });
          const { bg, color } = computeScheduleCellStyle(value, existing.color || null, existing.textColor || null);
          const td = input.closest("td");
          td.style.cssText = `${cellBase}${bg ? `background:${bg};color:${color};font-weight:700;` : ""}padding:0;border-radius:4px;`;
        } catch (err) {
          alert("저장 중 오류: " + err.message);
        }
      });
      input.addEventListener("paste", async (e) => {
        e.preventDefault();
        const grid = parseScheduleClipboard(e.clipboardData);
        if (!grid.length) return;

        const startRowIdx = SCHEDULE_ROW_ORDER.indexOf(input.dataset.row);
        const startDay = parseInt(input.dataset.date.slice(-2), 10);
        const startDateIdx = dates.indexOf(startDay);
        if (startRowIdx === -1 || startDateIdx === -1) return;

        const touchedDates = new Set();
        grid.forEach((row, ri) => {
          row.forEach((cell, ci) => {
            if (!cell) return;
            const rowIdx = startRowIdx + ri;
            const dateIdx = startDateIdx + ci;
            if (rowIdx >= SCHEDULE_ROW_ORDER.length || dateIdx >= dates.length) return;
            const rowKey = SCHEDULE_ROW_ORDER[rowIdx];
            const dStr = ymd(year, month, dates[dateIdx]);
            if (!byDate[dStr]) byDate[dStr] = { date: dStr, cells: {} };
            if (!byDate[dStr].cells) byDate[dStr].cells = {};
            byDate[dStr].cells[rowKey] = { text: cell.text, color: cell.color };
            touchedDates.add(dStr);
          });
        });

        try {
          await Promise.all(Array.from(touchedDates).map(dStr =>
            setDoc(doc(db, "scheduleEntries", dStr), { date: dStr, cells: byDate[dStr].cells })
          ));
          showToast("붙여넣었습니다.");
          renderMonthlySchedule(section);
        } catch (err) {
          alert("붙여넣기 저장 중 오류: " + err.message);
        }
      });
    });

    async function applyCellFormat(bg, textColor) {
      if (!activeCellInput) { alert("먼저 표에서 칸을 클릭해주세요."); return; }
      const dateStr = activeCellInput.dataset.date;
      const rowKey = activeCellInput.dataset.row;
      if (!byDate[dateStr]) byDate[dateStr] = { date: dateStr, cells: {} };
      if (!byDate[dateStr].cells) byDate[dateStr].cells = {};
      const existing = byDate[dateStr].cells[rowKey] || {};
      const text = activeCellInput.value.trim();
      byDate[dateStr].cells[rowKey] = { text, color: bg, textColor: textColor };
      try {
        await setDoc(doc(db, "scheduleEntries", dateStr), { date: dateStr, cells: byDate[dateStr].cells });
        const { bg: finalBg, color: finalColor } = computeScheduleCellStyle(text, bg, textColor);
        const td = activeCellInput.closest("td");
        td.style.cssText = `${cellBase}${finalBg ? `background:${finalBg};color:${finalColor};font-weight:700;` : ""}padding:0;border-radius:4px;`;
      } catch (err) {
        alert("저장 중 오류: " + err.message);
      }
    }

    const bgPicker = document.getElementById("cellBgPicker");
    const textPicker = document.getElementById("cellTextPicker");
    bgPicker.addEventListener("change", () => {
      const dateStr = activeCellInput?.dataset.date;
      const rowKey = activeCellInput?.dataset.row;
      const existingTextColor = (dateStr && byDate[dateStr]?.cells?.[rowKey]?.textColor) || textPicker.value;
      applyCellFormat(bgPicker.value, existingTextColor);
    });
    textPicker.addEventListener("change", () => {
      const dateStr = activeCellInput?.dataset.date;
      const rowKey = activeCellInput?.dataset.row;
      const existingBg = (dateStr && byDate[dateStr]?.cells?.[rowKey]?.color) || bgPicker.value;
      applyCellFormat(existingBg, textPicker.value);
    });
    document.getElementById("cellClearFormatBtn").onclick = () => applyCellFormat(null, null);
  }
}

function rgbStringToHex(rgbStr) {
  if (!rgbStr) return null;
  const m = rgbStr.match(/\d+/g);
  if (!m || m.length < 3) return null;
  const [r, g, b] = m.map(Number);
  if (r > 240 && g > 240 && b > 240) return null; // 흰색/거의 흰색은 색 없음 처리
  return `#${[r, g, b].map(x => x.toString(16).padStart(2, "0")).join("")}`;
}

function parseScheduleClipboard(clipboardData) {
  const html = clipboardData.getData("text/html");
  if (html) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const rows = parsed.querySelectorAll("tr");
    if (rows.length) return expandMergedGrid(Array.from(rows));
  }
  const text = clipboardData.getData("text/plain");
  if (text) {
    return text.split(/\r?\n/).filter(r => r.length).map(row => row.split("\t").map(t => ({ text: t.trim(), color: null })));
  }
  return [];
}

// 구글 시트에서 병합된 셀(colspan/rowspan)을 실제 칸 수만큼 값을 복제해서 채워 넣는다.
function expandMergedGrid(rowEls) {
  const grid = [];
  const rowSpanTracker = {}; // colIndex -> { remaining, value }
  rowEls.forEach((tr, rIdx) => {
    grid[rIdx] = [];
    const cells = Array.from(tr.querySelectorAll("td,th"));
    let cellPtr = 0;
    let colIdx = 0;
    while (cellPtr < cells.length || rowSpanTracker[colIdx]) {
      if (rowSpanTracker[colIdx] && rowSpanTracker[colIdx].remaining > 0) {
        grid[rIdx][colIdx] = rowSpanTracker[colIdx].value;
        rowSpanTracker[colIdx].remaining--;
        if (rowSpanTracker[colIdx].remaining === 0) delete rowSpanTracker[colIdx];
        colIdx++;
        continue;
      }
      if (cellPtr >= cells.length) break;
      const cell = cells[cellPtr++];
      const colspan = parseInt(cell.getAttribute("colspan") || "1", 10) || 1;
      const rowspan = parseInt(cell.getAttribute("rowspan") || "1", 10) || 1;
      const value = { text: cell.textContent.trim(), color: rgbStringToHex(cell.style.backgroundColor) };
      for (let cs = 0; cs < colspan; cs++) {
        while (rowSpanTracker[colIdx] && rowSpanTracker[colIdx].remaining > 0) colIdx++; // 이미 예약된 칸은 건너뜀
        grid[rIdx][colIdx] = value;
        if (rowspan > 1) rowSpanTracker[colIdx] = { remaining: rowspan - 1, value };
        colIdx++;
      }
    }
  });
  return grid;
}



/* ===================== 전역 상태 ===================== */
const state = { user:null, profile:null, branches:[], customFolders:[], menuOverrides:{}, currentSection:"schedule", branchFilter:{}, navExpanded:{}, openTabs:[] };

function tabStorageKey() {
  return "selfteam_openTabs_" + (state.user ? state.user.uid : "anon");
}
function loadOpenTabs() {
  try {
    const raw = localStorage.getItem(tabStorageKey());
    const parsed = raw ? JSON.parse(raw) : null;
    state.openTabs = Array.isArray(parsed) ? parsed : [];
  } catch (err) { state.openTabs = []; }
}
function saveOpenTabs() {
  try { localStorage.setItem(tabStorageKey(), JSON.stringify(state.openTabs)); } catch (err) { /* 무시 */ }
}

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
    await renderProfileRepairScreen(user);
    return;
  }
  state.profile = snap.data();

  document.getElementById("whoBox").innerHTML = `
    <div class="name">${escapeHtml(state.profile.name || user.email)}</div>
    <div class="role">${state.profile.role === "leader" ? "팀장" : state.profile.role === "viewer" ? "전체 열람 (뷰어)" : "팀원 · " + escapeHtml(state.profile.branchName || "")}</div>
    <div style="margin-top:8px;"><a href="#" id="whoBoxOpsShortcut" style="font-size:11.5px;color:#DCEFD3;text-decoration:underline;">지점 운영 자료 바로가기 ›</a></div>`;
  document.getElementById("whoBoxOpsShortcut").onclick = (e) => { e.preventDefault(); goToSection("operation"); };

  await loadBranches();
  await loadCustomFolders();
  await loadMenuOverrides();
  loadOpenTabs();
  if (!state.openTabs.includes(state.currentSection)) state.openTabs.unshift(state.currentSection);
  buildNav();
  renderTabBar();
  renderSection(state.currentSection);
});

// 회원가입 중 네트워크 문제 등으로 로그인 계정만 만들어지고 Firestore 프로필 저장이 실패했던 경우를 위한 화면입니다.
// 다시 로그인하면 이 화면이 뜨고, 이름/지점을 입력하면 바로 정상적으로 이용할 수 있습니다.
async function renderProfileRepairScreen(user) {
  let branches = [];
  try {
    const snap = await getDocs(collection(db, "branches"));
    branches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) { /* 무시하고 빈 목록으로 진행 */ }

  document.body.innerHTML = `<div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-logo"><span style="font-weight:800;font-size:15px;">셀프팀 홈페이지</span></div>
      <p class="auth-sub">로그인 계정은 있는데 프로필 정보가 비어있어요. (가입 중 일시적인 오류였을 수 있어요.) 이름과 담당 지점을 입력하면 바로 이용하실 수 있어요.</p>
      <form id="profileRepairForm">
        <div class="field"><label>이름</label><input type="text" id="repairName" required></div>
        <div class="field"><label>담당 지점</label>
          <select id="repairBranch" required>
            <option value="">${branches.length ? "선택하세요" : "등록된 지점이 없습니다 (팀장 문의)"}</option>
            ${branches.map(b => `<option value="${b.id}" data-name="${escapeHtml(b.name)}">${escapeHtml(b.name)}</option>`).join("")}
          </select>
        </div>
        <button class="btn" type="submit">저장하고 계속하기</button>
        <p class="error-msg" id="repairError"></p>
      </form>
      <p class="hint">${escapeHtml(user.email)} 계정으로 로그인되어 있어요. 문제가 계속되면 팀장에게 문의하세요.</p>
    </div>
  </div>`;

  document.getElementById("profileRepairForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("repairName").value.trim();
    const branchSelect = document.getElementById("repairBranch");
    const branchId = branchSelect.value;
    const branchName = branchSelect.selectedOptions[0]?.dataset.name || "";
    const errEl = document.getElementById("repairError");
    errEl.textContent = "";
    if (!branchId) { errEl.textContent = "담당 지점을 선택해주세요."; return; }
    try {
      await setDoc(doc(db, "users", user.uid), {
        name, email: user.email, branchId, branchName, role: "member",
        createdAt: new Date().toISOString()
      });
      window.location.reload();
    } catch (err) {
      errEl.textContent = "저장 중 오류가 발생했습니다: " + err.message;
    }
  });
}

document.getElementById("logoutBtn").onclick = () => signOut(auth);
document.getElementById("navToggleBtn").onclick = () => {
  document.querySelector(".sidebar").classList.toggle("nav-open");
};

async function moveBranch(bid, direction) {
  const index = state.branches.findIndex(b => b.id === bid);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= state.branches.length) return;
  const reordered = [...state.branches];
  [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
  await Promise.all(reordered.map((b, i) => updateDoc(doc(db, "branches", b.id), { order: i })));
  await loadBranches();
  buildNav();
  markActiveNav("admin");
  renderAdmin();
}

async function loadBranches() {
  const snap = await getDocs(collection(db, "branches"));
  state.branches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  state.branches.sort((a, b) => {
    const oa = a.order !== undefined ? a.order : Infinity;
    const ob = b.order !== undefined ? b.order : Infinity;
    if (oa !== ob) return oa - ob;
    return (a.name || "").localeCompare(b.name || "", "ko");
  });
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

/* 팀장이 이름/그룹/색상/권한을 바꾼 메뉴가 있으면 기본값 위에 덮어씌우기 */
function withOverride(section) {
  const o = state.menuOverrides[section.key];
  if (!o) return section;
  const visibility = o.visibility || section.visibility;
  return {
    ...section,
    label: o.label || section.label,
    group: o.group || section.group,
    color: o.color || section.color,
    order: o.order ?? section.order,
    writable: o.writable || section.writable,
    visibility,
    leaderOnly: visibility ? visibility === "leader" : section.leaderOnly,
    hidden: !!o.hidden
  };
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
    visibility: folder.visibility || "all",
    leaderOnly: folder.visibility === "leader",
    template: folder.template || "standard",
    order: folder.order ?? 1000,
    desc: folder.desc || ""
  };
  if (folder.template === "okr") {
    return { ...base, isOkr: true, desc: folder.desc || "시즌별 OKR(Objective · Key Result · Key Task)을 관리합니다." };
  }
  if (folder.template === "metricAnalysis") {
    return { ...base, isMetricAnalysis: true, desc: folder.desc || "연결한 구글 시트의 지표를 두 시점 기준으로 비교합니다." };
  }
  if (folder.template === "taskTracking") {
    return { ...base, isTaskTracking: true, desc: folder.desc || "팀장이 각 지점 원장님에게 동일하게 내린 업무 지시를 지점별로 체크하고, 완료율·마감기한을 관리합니다." };
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

/* ===================== 상단 탭 바 ===================== */
function tabMeta(key) {
  if (key === "admin") return { label: "지점 · 팀원 관리", color: "#9CA88F" };
  const s = getSectionByKey(key);
  return s ? { label: s.label, color: COLOR_HEX[s.color] || "#9CA88F" } : null;
}
function renderTabBar() {
  const bar = document.getElementById("tabBar");
  if (!bar) return;
  // 더 이상 존재하지 않는(삭제된 폴더 등) 탭은 자동으로 정리합니다.
  const before = state.openTabs.length;
  state.openTabs = state.openTabs.filter(k => tabMeta(k));
  if (state.openTabs.length !== before) saveOpenTabs();

  if (!state.openTabs.length) { bar.innerHTML = ""; bar.style.display = "none"; return; }
  bar.style.display = "flex";
  bar.innerHTML = state.openTabs.map(key => {
    const meta = tabMeta(key);
    const active = key === state.currentSection;
    return `<div class="tab-item ${active ? "active" : ""}" data-tab-key="${key}" style="--tab-color:${meta.color}">
      <span class="dot" style="background:${meta.color};"></span>
      <span>${escapeHtml(meta.label)}</span>
      <span class="tab-close" data-close-key="${key}">×</span>
    </div>`;
  }).join("");
  bar.querySelectorAll("[data-tab-key]").forEach(el => {
    el.onclick = () => goToSection(el.dataset.tabKey);
  });
  bar.querySelectorAll("[data-close-key]").forEach(el => {
    el.onclick = (e) => { e.stopPropagation(); closeTab(el.dataset.closeKey); };
  });
  const activeEl = bar.querySelector(".tab-item.active");
  if (activeEl) activeEl.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function goToSection(key, branchId) {
  state.currentSection = key;
  if (branchId !== undefined) state.branchFilter[key] = branchId;
  if (!state.openTabs.includes(key)) state.openTabs.push(key);
  saveOpenTabs();
  renderTabBar();
  renderSection(key);
  closeMobileNav();
}
function closeTab(key) {
  const idx = state.openTabs.indexOf(key);
  if (idx === -1) return;
  state.openTabs.splice(idx, 1);
  saveOpenTabs();
  if (state.currentSection === key) {
    const fallback = state.openTabs[idx] || state.openTabs[idx - 1] || state.openTabs[0];
    if (fallback) {
      goToSection(fallback);
      return;
    }
    // 남은 탭이 하나도 없으면 팀장 일정으로 돌아갑니다.
    goToSection("schedule");
    return;
  }
  renderTabBar();
}

/* ===================== 사이드바 네비게이션 ===================== */
function buildNav() {
  const nav = document.getElementById("navGroups");
  let html = "";
  const allBuiltIn = SECTIONS
    .map((s, i) => ({ ...s, order: s.order ?? i }))
    .map(withOverride)
    .filter(s => !s.hidden)
    .filter(s => !s.leaderOnly || canViewAllRole());
  const allFolders = state.customFolders.map(f => withOverride(folderToSection(f))).filter(s => !s.leaderOnly || canViewAllRole());
  // "본사" 지점 소속 팀원(이사님 제외)은 아래 메뉴만 보이게 합니다.
  const isHqStaff = state.profile.role === "member" && state.profile.branchName === "본사";
  const HQ_STAFF_ALLOWED_LABELS = ["팀장 일정", "팀 회의", "전체 회의", "본사 회의", "지표 분석", "지점 운영 자료", "리더십 자료", "팀 스터디 자료", "지점 인적 구성"];
  const allItems = [...allBuiltIn, ...allFolders].filter(s => !isHqStaff || HQ_STAFF_ALLOWED_LABELS.includes(s.label));
  GROUP_ORDER.forEach(group => {
    const items = allItems.filter(s => s.group === group).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
        <span class="nav-label"><span class="dot" style="background:#9CA88F"></span>지점 · 팀원 관리</span>
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
      goToSection(key);
    };
  });
  nav.querySelectorAll(".nav-subitem").forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      goToSection(el.dataset.key, el.dataset.branch || null);
    };
  });
}

function closeMobileNav() {
  if (window.innerWidth <= 860) document.querySelector(".sidebar").classList.remove("nav-open");
}

function markActiveNav(key) {
  const branchId = state.branchFilter[key] || "";
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.key === key));
  document.querySelectorAll(".nav-subitem").forEach(el => el.classList.toggle("active", el.dataset.key === key && (el.dataset.branch || "") === branchId));
  renderTabBar();
}

/* ===================== 권한 판단 ===================== */
function canViewAllRole() { return state.profile.role === "leader" || state.profile.role === "viewer"; }

function canWriteSection(section) {
  if (state.profile.role === "viewer") return false;
  if (state.profile.role === "leader") return true;
  if (section.writable === "all") return true;
  if (section.writable === "leader-and-branch") return true;
  return false;
}
function canEditDoc(section, data) {
  if (state.profile.role === "viewer") return false;
  if (state.profile.role === "leader") return true;
  if (section.writable === "all") return true;
  if (section.writable === "leader-and-branch") return data.branchId === state.profile.branchId;
  return false;
}
function canCreateForBranch(section, branchId) {
  if (state.profile.role === "viewer") return false;
  if (state.profile.role === "leader") return true;
  if (section.writable === "all") return true;
  if (section.writable === "leader-and-branch") return branchId === state.profile.branchId;
  return false;
}

/* ===================== 섹션 렌더링(목록) ===================== */
async function renderSection(key) {
  markActiveNav(key);
  const main = document.getElementById("mainContent");
  if (key === "admin") { renderAdmin(); return; }

  const section = getSectionByKey(key);
  if (!section) { main.innerHTML = `<div class="empty-state">찾을 수 없는 메뉴입니다.</div>`; return; }
  if (section.hidden && state.profile.role !== "leader") { main.innerHTML = `<div class="empty-state">삭제된 메뉴입니다.</div>`; return; }
  if (section.isMonthlySchedule) { renderMonthlySchedule(section); return; }
  if (section.isEvalSheet) { renderEvalSheet(section); return; }
  if (section.isOpsGrid) { renderOpsGrid(section); return; }
  if (section.isOkr) { renderOkrFolder(section); return; }
  if (section.isMetricAnalysis) { renderMetricAnalysis(section); return; }
  if (section.isRosterGrid) { renderRosterGrid(section); return; }
  if (section.isTaskTracking) { renderTaskTracking(section); return; }
  if (section.isMeetingGrid) { renderMeetingGrid(section); return; }
  if (section.cardView) { renderFolderGrid(section); return; }

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
      ${canWriteSection(section) ? `<button class="btn small" id="addBtn">+ 새로 등록</button>` : ""}
    </div>
    <div class="card"><div id="tableWrap">불러오는 중...</div></div>`;

  if (canWriteSection(section)) {
    document.getElementById("addBtn").onclick = () => openModal(section, null);
  }

  const docs = await fetchDocs(section);
  renderTable(section, docs);
}

async function fetchDocs(section) {
  const colRef = collection(db, section.collectionName);
  const clauses = [];
  if (section.scope === "custom") {
    clauses.push(where("folderId", "==", section.folderId));
  }
  if (section.scope === "branch" && !canViewAllRole()) {
    clauses.push(where("branchId", "==", state.profile.branchId));
  } else if (section.scope === "branch" && state.branchFilter[section.key]) {
    clauses.push(where("branchId", "==", state.branchFilter[section.key]));
  } else if (section.scope !== "branch" && section.visibility === "branch" && !canViewAllRole()) {
    // 팀 전체/사용자 정의 폴더 메뉴인데 "팀장은 전체 / 팀원은 자기 지점만 열람"으로 설정된 경우
    clauses.push(where("branchId", "==", state.profile.branchId));
  }
  const q = clauses.length ? query(colRef, ...clauses) : colRef;
  const snap = await getDocs(q);
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  docs.sort((a, b) => (b.date || b.createdAt || "").localeCompare(a.date || a.createdAt || ""));
  return docs;
}

function renderTable(section, docs) {
  const wrap = document.getElementById("tableWrap");
  if (!docs.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="shape"></div>아직 등록된 자료가 없습니다.</div>`;
    return;
  }
  const cols = section.columns || section.fields.slice(0, 3).map(f => f.key);
  const colsWithBranch = (section.visibility === "branch" && !cols.includes("branchName")) ? ["branchName", ...cols] : cols;
  const fieldMap = Object.fromEntries(section.fields.map(f => [f.key, f]));

  let html = `<table><thead><tr>`;
  colsWithBranch.forEach(c => html += `<th>${fieldMap[c] ? fieldMap[c].label : (c === "branchName" ? "지점" : c)}</th>`);
  html += `<th></th></tr></thead><tbody>`;

  docs.forEach(d => {
    html += `<tr>`;
    colsWithBranch.forEach(c => {
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

/* ===================== 카드형 목록 (팀 회의 일지, 미팅 일지, 표준 폴더) ===================== */
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
    if (d.branchName && !metaKeys.includes("branchName")) metaParts.unshift(escapeHtml(d.branchName));
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
        ${renderAttachmentGallery(images)}
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

function fileExtOf(s) {
  const clean = String(s || "").split("?")[0].split("#")[0];
  const m = clean.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : "";
}
function isImageFile(s) { return ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(fileExtOf(s)); }
function fileIconFor(s) {
  const ext = fileExtOf(s);
  if (ext === "pdf") return "📄";
  if (ext === "ppt" || ext === "pptx") return "📊";
  return "📎";
}
function fileNameFromUrl(url) {
  try {
    const pathPart = decodeURIComponent(String(url).split("?")[0]);
    const lastSeg = pathPart.split("%2F").pop().split("/").pop();
    return lastSeg.replace(/^\d+_[a-z0-9]+_/i, "") || "첨부파일";
  } catch (e) { return "첨부파일"; }
}
// 이미지는 예전처럼 확대해서 볼 수 있는 갤러리로, PDF·PPT 등은 클릭하면 새 탭에서 열리는 파일 카드로 보여줍니다.
function renderAttachmentGallery(urls) {
  if (!urls || !urls.length) return "";
  return `<div class="meeting-gallery">${urls.map(url => {
    if (isImageFile(url)) {
      return `<span class="img-zoom-wrap"><img src="${url}" class="meeting-img" data-zoom="0" loading="lazy" onclick="cycleMeetingImgZoom(this)"></span>`;
    }
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:#F4FAEF;border:1px solid var(--border);border-radius:10px;font-size:12.5px;color:var(--blue-deep);font-weight:700;text-decoration:none;max-width:220px;">
      <span style="font-size:18px;">${fileIconFor(url)}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(fileNameFromUrl(url))}</span>
    </a>`;
  }).join("")}</div>`;
}

/* ===================== 사용자 정의 폴더 - 4칸 그리드 보기 (순서는 ▲▼로 직접 조정) ===================== */
async function renderFolderGrid(section) {
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
    <div id="folderGridWrap">불러오는 중...</div>`;

  if (canWriteSection(section)) {
    document.getElementById("addBtn").onclick = () => openModal(section, null);
  }

  const docs = await fetchDocs(section);
  // order 값이 있으면 그 순서대로(작은 값이 먼저), 없는 예전 게시물은 뒤로 보내고 최신순으로 정렬합니다.
  docs.sort((a, b) => {
    const oa = a.order !== undefined ? a.order : Infinity;
    const ob = b.order !== undefined ? b.order : Infinity;
    if (oa !== ob) return oa - ob;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });

  const wrap = document.getElementById("folderGridWrap");
  if (!docs.length) {
    wrap.innerHTML = `<div class="card"><div class="empty-state"><div class="shape"></div>아직 등록된 게시물이 없습니다.</div></div>`;
    return;
  }

  const stripHtml = (html) => (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const previewField = section.fields.find(f => f.type === "richtext" || f.type === "textarea");
  const imageField = section.fields.find(f => f.type === "imageUpload");
  const fieldMap = Object.fromEntries(section.fields.map(f => [f.key, f]));
  const metaKeys = (section.headerFields || []).filter(k => k !== "title");

  wrap.innerHTML = `<div class="folder-grid">${docs.map((d, i) => {
    const editable = canEditDoc(section, d);
    const preview = previewField ? stripHtml(d[previewField.key]) : "";
    const attachments = imageField ? (d[imageField.key] || []).filter(Boolean) : [];
    const thumbUrl = attachments[0] || "";
    const thumbIsImage = thumbUrl && isImageFile(thumbUrl);
    const uploadDate = (d.createdAt || d.updatedAt || "").slice(0, 10);
    const metaParts = metaKeys.map(k => {
      const f = fieldMap[k];
      if (f && f.type === "importanceSelect") return d[k] === "yes" ? "🔴 중요" : "";
      return d[k] ? escapeHtml(d[k]) : "";
    }).filter(Boolean);
    if (uploadDate) metaParts.push("업로드: " + escapeHtml(uploadDate));
    return `<div class="card folder-grid-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
        <div style="font-weight:800;font-size:14px;cursor:pointer;flex:1;" data-view="${d.id}">${escapeHtml(d.title || "(제목 없음)")}</div>
        ${editable ? `<div style="display:flex;flex-direction:column;">
          <button class="icon-btn" style="padding:0 4px;line-height:1.3;" data-move="up" data-id="${d.id}" ${i === 0 ? "disabled" : ""}>▲</button>
          <button class="icon-btn" style="padding:0 4px;line-height:1.3;" data-move="down" data-id="${d.id}" ${i === docs.length - 1 ? "disabled" : ""}>▼</button>
        </div>` : ""}
      </div>
      ${metaParts.length ? `<div style="font-size:11px;color:var(--text-muted);margin:4px 0 8px;">${metaParts.join(" · ")}</div>` : ""}
      ${thumbIsImage
        ? `<img src="${thumbUrl}" style="width:100%;height:110px;object-fit:cover;border-radius:8px;margin-bottom:8px;cursor:pointer;" data-view="${d.id}">`
        : (thumbUrl ? `<div style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:#F4FAEF;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;cursor:pointer;font-size:12px;color:var(--blue-deep);font-weight:700;" data-view="${d.id}"><span style="font-size:16px;">${fileIconFor(thumbUrl)}</span><span>첨부파일 ${attachments.length}개</span></div>` : "")}
      ${preview ? `<div style="font-size:12.5px;color:var(--text-main);cursor:pointer;line-height:1.5;min-height:20px;" data-view="${d.id}">${escapeHtml(preview.slice(0, 60))}${preview.length > 60 ? "…" : ""}</div>` : ""}
      ${editable ? `<div style="margin-top:10px;display:flex;gap:10px;justify-content:flex-end;">
        <button class="icon-btn" data-act="edit" data-id="${d.id}">수정</button>
        <button class="icon-btn danger" data-act="del" data-id="${d.id}">삭제</button>
      </div>` : ""}
    </div>`;
  }).join("")}</div>`;

  wrap.querySelectorAll("[data-view]").forEach(el => {
    el.onclick = () => openFolderEntryDetailModal(section, docs.find(d => d.id === el.dataset.view));
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
  wrap.querySelectorAll("[data-move]").forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); moveFolderEntry(section, docs, btn.dataset.id, btn.dataset.move); };
  });
}

async function moveFolderEntry(section, entries, id, direction) {
  const index = entries.findIndex(e => e.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= entries.length) return;
  // 두 항목의 order 값을 그냥 맞바꾸지 않고, 전체를 0,1,2...로 다시 매겨서
  // 예전 게시물처럼 order가 아예 없던 경우에도 클릭 즉시 확실히 반영되게 합니다.
  const reordered = [...entries];
  [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
  await Promise.all(reordered.map((e, i) => updateDoc(doc(db, section.collectionName, e.id), { order: i })));
  renderSection(section.key);
}

function openFolderEntryDetailModal(section, entry) {
  const root = document.getElementById("modalRoot");
  const canEdit = canEditDoc(section, entry);
  const uploadDate = (entry.createdAt || entry.updatedAt || "").slice(0, 10);
  const imageField = section.fields.find(f => f.type === "imageUpload");
  const images = (imageField && entry[imageField.key]) || [];

  const bodyHtml = section.fields
    .filter(f => f.key !== "title" && f.type !== "imageUpload" && f.type !== "branchSelect")
    .map(f => {
      const val = entry[f.key];
      if (f.type === "importanceSelect") {
        return val === "yes" ? `<p style="margin:0 0 12px;"><span class="pill important">중요</span></p>` : "";
      }
      if (!val) return "";
      if (f.type === "link") {
        return `<p style="margin-bottom:14px;"><a href="${escapeHtml(val)}" target="_blank" rel="noopener" style="color:var(--blue-deep);font-weight:700;">${escapeHtml(f.label)} 열기 ↗</a></p>`;
      }
      const display = f.type === "richtext" ? sanitizeRichHtml(val) : escapeHtml(val).replace(/\n/g, "<br>");
      return `<div style="margin-bottom:12px;"><div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:4px;">${f.label}</div><div class="rich-content">${display}</div></div>`;
    }).join("");

  root.innerHTML = `<div class="modal-bg" id="modalBg">
    <div class="modal" style="max-width:1280px;">
      <h3>${escapeHtml(entry.title || "")}</h3>
      ${uploadDate ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;">업로드: ${escapeHtml(uploadDate)}</div>` : ""}
      ${bodyHtml || `<p style="color:var(--text-muted);font-size:13px;">등록된 내용이 없습니다.</p>`}
      ${renderAttachmentGallery(images)}
      <div class="grid-2" style="margin-top:16px;">
        <button type="button" class="btn secondary" id="closeDetailBtn">닫기</button>
        ${canEdit ? `<button type="button" class="btn" id="editFromDetailBtn">수정</button>` : ""}
      </div>
    </div></div>`;
  document.getElementById("closeDetailBtn").onclick = () => root.innerHTML = "";
  document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") root.innerHTML = ""; });
  if (canEdit) {
    document.getElementById("editFromDetailBtn").onclick = () => openModal(section, entry);
  }
}
async function renderMeetingGrid(section) {
  const main = document.getElementById("mainContent");
  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}</h1>
        <p>${section.desc}</p>
      </div>
      ${canWriteSection(section) ? `<button class="btn small" id="addBtn">+ 새로 등록</button>` : ""}
    </div>
    <div class="card" style="overflow:auto;"><div id="meetingGridWrap">불러오는 중...</div></div>`;

  if (canWriteSection(section)) {
    document.getElementById("addBtn").onclick = () => openModal(section, null);
  }

  const docs = await fetchDocs(section);
  const filterBranchId = state.branchFilter[section.key];
  const branches = canViewAllRole()
    ? (filterBranchId ? state.branches.filter(b => b.id === filterBranchId) : state.branches)
    : state.branches.filter(b => b.id === state.profile.branchId);
  const branchesSorted = branches; // state.branches가 이미 팀장이 지정한 순서대로 정렬돼 있습니다.

  const wrap = document.getElementById("meetingGridWrap");
  if (!branchesSorted.length) { wrap.innerHTML = `<div class="empty-state">등록된 지점이 없습니다.</div>`; return; }

  // 세로축: title(예: "2026년 7월 2주차") 기준으로 한 줄. 같은 제목+지점에 여러 건이 있으면 최신 날짜만 표시.
  const rowMap = {};
  docs.forEach(d => {
    const key = d.title || "(제목 없음)";
    if (!rowMap[key]) rowMap[key] = { title: key, latestDate: d.date || "", rowOrder: d.rowOrder, cells: {} };
    if ((d.date || "") > rowMap[key].latestDate) rowMap[key].latestDate = d.date || "";
    if (d.rowOrder !== undefined && rowMap[key].rowOrder === undefined) rowMap[key].rowOrder = d.rowOrder;
    const cur = rowMap[key].cells[d.branchId];
    if (!cur || (d.date || "") > (cur.date || "")) rowMap[key].cells[d.branchId] = d;
  });
  const rows = Object.values(rowMap).sort((a, b) => {
    const oa = a.rowOrder !== undefined ? a.rowOrder : Infinity;
    const ob = b.rowOrder !== undefined ? b.rowOrder : Infinity;
    if (oa !== ob) return oa - ob;
    return (b.latestDate || "").localeCompare(a.latestDate || "");
  });

  if (!rows.length) { wrap.innerHTML = `<div class="empty-state">등록된 미팅 기록이 없습니다.</div>`; return; }

  const stripHtml = (html) => (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const extraKey = (section.headerFields || []).find(k => !["title", "date", "branchName"].includes(k));

  let html = `<table class="table-compact" style="border-collapse:separate;border-spacing:8px;"><thead><tr><th style="min-width:130px;font-size:15px;font-weight:800;color:var(--text-main);text-transform:none;letter-spacing:normal;">미팅</th>
    ${branchesSorted.map(b => `<th style="min-width:170px;font-size:15px;font-weight:800;color:var(--text-main);text-transform:none;letter-spacing:normal;">${escapeHtml(b.name)}</th>`).join("")}
  </tr></thead><tbody>`;

  rows.forEach((row, ri) => {
    const canEditRow = canWriteSection(section);
    html += `<tr><td style="font-weight:800;font-size:15px;vertical-align:top;white-space:nowrap;">
      <div style="display:flex;align-items:flex-start;gap:2px;">
        <span>${escapeHtml(row.title)}</span>
        ${canEditRow ? `
          <button class="icon-btn" style="padding:0 3px;font-size:11px;" data-row-edit="${ri}" title="제목 수정">✎</button>
          <span style="display:flex;flex-direction:column;">
            <button class="icon-btn" style="padding:0;line-height:1.1;font-size:10px;" data-row-move="up" data-row-index="${ri}" ${ri === 0 ? "disabled" : ""}>▲</button>
            <button class="icon-btn" style="padding:0;line-height:1.1;font-size:10px;" data-row-move="down" data-row-index="${ri}" ${ri === rows.length - 1 ? "disabled" : ""}>▼</button>
          </span>` : ""}
      </div>
    </td>`;
    branchesSorted.forEach(b => {
      const cell = row.cells[b.id];
      if (cell) {
        const preview = stripHtml(cell.content);
        const imgField = section.fields.find(f => f.type === "imageUpload");
        const hasAttachments = imgField && (cell[imgField.key] || []).length > 0;
        html += `<td style="padding:0;">
          <div class="meeting-grid-card" data-cell-row="${ri}" data-cell-branch="${b.id}">
            <div style="font-size:14px;color:var(--text-main);line-height:1.5;">${escapeHtml(preview.slice(0, 40))}${preview.length > 40 ? "…" : (preview ? "" : "(내용 없음)")}</div>
            <div style="font-size:12.5px;color:var(--text-muted);margin-top:4px;">${escapeHtml(cell.date || "")}${extraKey && cell[extraKey] ? " · " + escapeHtml(cell[extraKey]) : ""}${hasAttachments ? " · 📎" : ""}</div>
          </div>
        </td>`;
      } else if (canCreateForBranch(section, b.id)) {
        html += `<td style="padding:0;"><div class="meeting-grid-empty clickable" data-cell-new-row="${ri}" data-cell-new-branch="${b.id}">+</div></td>`;
      } else {
        html += `<td style="padding:0;"><div class="meeting-grid-empty">-</div></td>`;
      }
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll("[data-cell-row]").forEach(el => {
    el.onclick = () => {
      const row = rows[parseInt(el.dataset.cellRow, 10)];
      openMeetingDetailModal(section, row.cells[el.dataset.cellBranch]);
    };
  });
  wrap.querySelectorAll("[data-cell-new-row]").forEach(el => {
    el.onclick = () => {
      const row = rows[parseInt(el.dataset.cellNewRow, 10)];
      openModal(section, null, { title: row.title, branchId: el.dataset.cellNewBranch });
    };
  });
  wrap.querySelectorAll("[data-row-edit]").forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      openMeetingRowEditModal(section, rows[parseInt(el.dataset.rowEdit, 10)], docs);
    };
  });
  wrap.querySelectorAll("[data-row-move]").forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      moveMeetingRow(section, rows, docs, parseInt(el.dataset.rowIndex, 10), el.dataset.rowMove);
    };
  });
}

// "미팅" 줄(제목)을 눌러 이동할 때, 같은 제목으로 등록된 모든 지점의 글이 함께 순서가 매겨지도록
// rowOrder 값을 그 제목의 모든 문서에 동일하게 적용합니다.
async function moveMeetingRow(section, rows, docs, index, direction) {
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= rows.length) return;
  const reordered = [...rows];
  [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
  const updates = [];
  reordered.forEach((row, i) => {
    docs.filter(d => (d.title || "(제목 없음)") === row.title).forEach(d => {
      updates.push(updateDoc(doc(db, section.collectionName, d.id), { rowOrder: i }));
    });
  });
  await Promise.all(updates);
  renderSection(section.key);
}

function openMeetingRowEditModal(section, row, docs) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `<div class="modal-bg" id="modalBg">
    <div class="modal">
      <h3>미팅 제목 수정</h3>
      <form id="rowEditForm">
        <div class="field"><label>제목</label><input type="text" id="rowEditTitle" value="${escapeHtml(row.title)}" required></div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:-8px;">이 제목으로 등록된 모든 지점의 미팅이 한꺼번에 이름이 바뀌어요.</p>
        <div class="grid-2" style="margin-top:10px;">
          <button type="button" class="btn secondary" id="cancelBtn">취소</button>
          <button type="submit" class="btn">저장</button>
        </div>
      </form>
    </div></div>`;
  document.getElementById("cancelBtn").onclick = () => root.innerHTML = "";
  document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") root.innerHTML = ""; });
  document.getElementById("rowEditForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const newTitle = document.getElementById("rowEditTitle").value.trim();
    if (!newTitle || newTitle === row.title) { root.innerHTML = ""; return; }
    const affected = docs.filter(d => (d.title || "(제목 없음)") === row.title);
    await Promise.all(affected.map(d => updateDoc(doc(db, section.collectionName, d.id), { title: newTitle })));
    root.innerHTML = "";
    showToast("수정되었습니다.");
    renderSection(section.key);
  });
}

function openMeetingDetailModal(section, entry) {
  const root = document.getElementById("modalRoot");
  const canEdit = canEditDoc(section, entry);
  // 뷰어(대표님/이사님)는 원래 글을 못 고치지만, 읽으면서 밑줄·색으로 표시는 할 수 있게 허용합니다.
  const canAnnotate = canEdit || state.profile.role === "viewer";
  const imageField = section.fields.find(f => f.type === "imageUpload");
  const attachments = (imageField && entry[imageField.key]) || [];
  const annotatableFields = section.fields.filter(f => f.type !== "branchSelect" && f.type !== "imageUpload" && f.key !== "title" && f.key !== "date");
  const fieldRows = annotatableFields
    .map(f => {
      const val = entry[f.key];
      if (!val && !canAnnotate) return "";
      const display = f.type === "richtext" ? sanitizeRichHtml(val || "") : escapeHtml(val || "").replace(/\n/g, "<br>");
      if (canAnnotate) {
        return `<div style="margin-bottom:20px;">
          <div style="font-size:22px;font-weight:700;color:var(--text-muted);margin-bottom:6px;">${f.label}</div>
          ${richtextToolbarHtml(`detail_${f.key}`)}
          <div class="rich-content meeting-detail-rich has-toolbar" id="detail_${f.key}" contenteditable="true">${display}</div>
        </div>`;
      }
      return `<div style="margin-bottom:20px;"><div style="font-size:22px;font-weight:700;color:var(--text-muted);margin-bottom:6px;">${f.label}</div><div class="rich-content meeting-detail-rich">${display}</div></div>`;
    }).join("");

  root.innerHTML = `<div class="modal-bg" id="modalBg">
    <div class="modal" style="max-width:1440px;">
      <h3 style="font-size:32px;">${escapeHtml(entry.title || "")}${entry.branchName ? " · " + escapeHtml(entry.branchName) : ""}</h3>
      <div style="font-size:24px;color:var(--text-muted);margin-bottom:14px;">${escapeHtml(entry.date || "")}</div>
      ${canAnnotate ? `<p style="font-size:12px;color:var(--text-muted);margin:-6px 0 14px;">글자를 드래그해서 굵기·색·크기로 표시할 수 있어요. 표시한 내용은 "표시 저장"을 눌러야 남습니다.</p>` : ""}
      ${fieldRows || `<p style="color:var(--text-muted);font-size:13px;">등록된 내용이 없습니다.</p>`}
      ${renderAttachmentGallery(attachments)}
      <div class="grid-2" style="margin-top:10px;">
        <button type="button" class="btn secondary" id="closeDetailBtn">닫기</button>
        ${canAnnotate ? `<button type="button" class="btn" id="saveAnnotateBtn">표시 저장</button>` : ""}
      </div>
      <div class="grid-2" style="margin-top:10px;">
        ${canEdit ? `<button type="button" class="btn secondary" id="editFromDetailBtn">전체 수정</button>` : "<span></span>"}
        ${canEdit ? `<button type="button" class="icon-btn danger" id="deleteFromDetailBtn" style="text-align:center;">삭제</button>` : ""}
      </div>
    </div></div>`;

  document.getElementById("closeDetailBtn").onclick = () => root.innerHTML = "";
  document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") root.innerHTML = ""; });

  if (canAnnotate) {
    annotatableFields.forEach(f => {
      wireRichtextToolbarFor(document.getElementById(`detail_${f.key}`), document.querySelector(`.rt-toolbar[data-for="detail_${f.key}"]`));
    });
    document.getElementById("saveAnnotateBtn").onclick = async () => {
      const btn = document.getElementById("saveAnnotateBtn");
      btn.disabled = true;
      btn.textContent = "저장 중...";
      try {
        const data = {};
        annotatableFields.forEach(f => {
          const el = document.getElementById(`detail_${f.key}`);
          if (el) data[f.key] = sanitizeRichHtml(el.innerHTML);
        });
        await updateDoc(doc(db, section.collectionName, entry.id), data);
        Object.assign(entry, data);
        showToast("표시가 저장되었습니다.");
      } catch (err) {
        alert("저장 중 오류: " + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = "표시 저장";
      }
    };
  }
  if (canEdit) {
    document.getElementById("editFromDetailBtn").onclick = () => openModal(section, entry);
    document.getElementById("deleteFromDetailBtn").onclick = async () => {
      if (!confirm("정말 삭제하시겠습니까?")) return;
      await deleteDoc(doc(db, section.collectionName, entry.id));
      root.innerHTML = "";
      showToast("삭제되었습니다.");
      renderSection(section.key);
    };
  }
}
const EVAL_SPREADSHEET_ID = "1TA3ObFLBQGb9dmKlOEL4XxPmE308ifyOPhxzEzAe-I8";
// 처음 한 번은 이 기본 링크로 "고객지표" 버튼이 보이고, 팀장이 "수정"으로 바꾸면 그 뒤로는 Firestore에 저장된 링크를 사용합니다.
const CUSTOMER_INDEX_DEFAULT_URL = "https://docs.google.com/spreadsheets/d/1uequoelbdG3zLzo-FgqbDsPIlb7NGFIasS_82ZzE6iA/edit?gid=866382572#gid=866382572";

function openSimpleLinkModal(title, currentUrl, onSave) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `<div class="modal-bg" id="modalBg">
    <div class="modal">
      <h3>${escapeHtml(title)}</h3>
      <form id="simpleLinkForm">
        <div class="field"><label>URL</label><input type="url" id="simpleLinkUrl" placeholder="https://..." value="${escapeHtml(currentUrl || "")}"></div>
        <div class="grid-2" style="margin-top:10px;">
          <button type="button" class="btn secondary" id="cancelBtn">취소</button>
          <button type="submit" class="btn">저장</button>
        </div>
      </form>
    </div></div>`;
  document.getElementById("cancelBtn").onclick = () => root.innerHTML = "";
  document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") root.innerHTML = ""; });
  document.getElementById("simpleLinkForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = document.getElementById("simpleLinkUrl").value.trim();
    root.innerHTML = "";
    await onSave(url);
  });
}

async function renderEvalSheet(section) {
  const main = document.getElementById("mainContent");
  let plUrl = "";
  let customerUrl = "";
  try {
    const plDoc = await getDoc(doc(db, "siteLinks", "plStatement"));
    if (plDoc.exists()) plUrl = plDoc.data().url || "";
  } catch (err) { /* 무시 */ }
  try {
    const custDoc = await getDoc(doc(db, "siteLinks", "customerIndex"));
    customerUrl = custDoc.exists() && custDoc.data().url ? custDoc.data().url : CUSTOMER_INDEX_DEFAULT_URL;
  } catch (err) { customerUrl = CUSTOMER_INDEX_DEFAULT_URL; }

  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}</h1>
        <p>${section.desc}</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        ${customerUrl
          ? `<a href="${escapeHtml(customerUrl)}" target="_blank" rel="noopener" class="btn small secondary" style="text-decoration:none;display:inline-flex;align-items:center;">고객지표</a>${state.profile.role === "leader" ? `<button class="icon-btn" id="editCustomerLinkBtn" type="button">수정</button>` : ""}`
          : (state.profile.role === "leader" ? `<button class="btn small secondary" id="editCustomerLinkBtn" type="button">+ 고객지표 링크 설정</button>` : "")}
        ${plUrl
          ? `<a href="${escapeHtml(plUrl)}" target="_blank" rel="noopener" class="btn small secondary" style="text-decoration:none;display:inline-flex;align-items:center;">손익계산서</a>${state.profile.role === "leader" ? `<button class="icon-btn" id="editPlLinkBtn" type="button">수정</button>` : ""}`
          : (state.profile.role === "leader" ? `<button class="btn small secondary" id="editPlLinkBtn" type="button">+ 손익계산서 링크 설정</button>` : "")}
        <select id="evalYearSelect" style="padding:8px 12px;border-radius:8px;border:1.5px solid var(--border);font-family:var(--font-display);font-weight:700;"></select>
      </div>
    </div>
    ${state.profile.role === "leader" ? `
    <div class="card" id="evalSheetAdminCard">
      <h2>연도 탭 등록/관리</h2>
      <form id="evalSheetAddForm" class="grid-3" style="align-items:end;">
        <div class="field" style="margin:0;"><label>표시 이름 (예: 2026년)</label><input type="text" id="newEvalLabel" required></div>
        <div class="field" style="margin:0;"><label>엑셀 파일</label><input type="file" id="newEvalFile" accept=".xlsx,.xls" required></div>
        <button class="btn" type="submit">추가</button>
      </form>
      <p style="font-size:12px;color:var(--text-muted);margin:10px 0 0;">엑셀 파일을 올리면 그 파일의 첫 번째 탭을 그대로 표로 보여드려요. 나중에 데이터가 바뀌면 이 연도를 지우고 새 파일로 다시 등록해주세요.</p>
      <div id="evalSheetList" style="margin-top:14px;"></div>
    </div>` : ""}
    <div class="card" style="overflow:auto;max-height:calc(100vh - 210px);"><div id="evalSheetWrap">불러오는 중...</div></div>`;

  if (document.getElementById("editCustomerLinkBtn")) {
    document.getElementById("editCustomerLinkBtn").onclick = () => {
      openSimpleLinkModal("고객지표 링크 설정", customerUrl, async (url) => {
        try {
          await setDoc(doc(db, "siteLinks", "customerIndex"), { url, updatedAt: new Date().toISOString(), updatedBy: state.profile.name });
          showToast("저장되었습니다.");
          renderSection(section.key);
        } catch (err) {
          alert("저장 중 오류: " + err.message);
        }
      });
    };
  }

  if (document.getElementById("editPlLinkBtn")) {
    document.getElementById("editPlLinkBtn").onclick = () => {
      openSimpleLinkModal("손익계산서 링크 설정", plUrl, async (url) => {
        try {
          await setDoc(doc(db, "siteLinks", "plStatement"), { url, updatedAt: new Date().toISOString(), updatedBy: state.profile.name });
          showToast("저장되었습니다.");
          renderSection(section.key);
        } catch (err) {
          alert("저장 중 오류: " + err.message);
        }
      });
    };
  }

  const snap = await getDocs(collection(db, "evalSheets"));
  const tabs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.label || "").localeCompare(b.label || ""));

  const yearSelect = document.getElementById("evalYearSelect");
  const wrap = document.getElementById("evalSheetWrap");

  if (!tabs.length) {
    yearSelect.innerHTML = `<option value="">등록된 연도가 없습니다</option>`;
    wrap.innerHTML = `<div class="empty-state">등록된 연도가 없습니다. ${state.profile.role === "leader" ? "위에서 엑셀 파일을 먼저 올려주세요." : "팀장에게 문의해주세요."}</div>`;
  } else {
    yearSelect.innerHTML = tabs.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.label)}</option>`).join("");
    yearSelect.onchange = () => loadEvalTab(tabs.find(t => t.id === yearSelect.value));
    loadEvalTab(tabs[tabs.length - 1]);
  }

  if (state.profile.role === "leader") {
    renderEvalSheetList(tabs);
    document.getElementById("evalSheetAddForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const label = document.getElementById("newEvalLabel").value.trim();
      const fileInput = document.getElementById("newEvalFile");
      const file = fileInput.files[0];
      if (!label || !file) return;
      const addBtn = e.target.querySelector('button[type="submit"]');
      addBtn.disabled = true;
      addBtn.textContent = "읽는 중...";
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        const rows = trimSheetRows(XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "", raw: false }));
        await addDoc(collection(db, "evalSheets"), { label, rows: JSON.stringify(rows), fileName: file.name, createdAt: new Date().toISOString() });
        showToast("연도가 등록되었습니다.");
        renderSection(section.key);
      } catch (err) {
        alert("파일을 읽는 중 오류가 발생했습니다: " + err.message);
        addBtn.disabled = false;
        addBtn.textContent = "추가";
      }
    });
  }
}

function renderEvalSheetList(tabs) {
  const wrap = document.getElementById("evalSheetList");
  if (!tabs.length) { wrap.innerHTML = `<p style="font-size:13px;color:var(--text-muted);">아직 등록된 연도가 없습니다.</p>`; return; }
  wrap.innerHTML = `<table><thead><tr><th>표시 이름</th><th>파일</th><th></th></tr></thead><tbody>
    ${tabs.map(t => `<tr><td>${escapeHtml(t.label)}</td><td class="mono" style="font-size:12px;">${escapeHtml(t.fileName || "")}</td>
      <td class="actions"><button class="icon-btn danger" data-eid="${t.id}">삭제</button></td></tr>`).join("")}
  </tbody></table>`;
  wrap.querySelectorAll("[data-eid]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("이 연도 등록을 삭제할까요?")) return;
      await deleteDoc(doc(db, "evalSheets", btn.dataset.eid));
      showToast("삭제되었습니다.");
      renderSection(getSectionByKey("performance").key);
    };
  });
}

function loadEvalTab(tab) {
  const wrap = document.getElementById("evalSheetWrap");
  if (!tab) { wrap.innerHTML = `<div class="empty-state">표시할 연도를 선택해주세요.</div>`; return; }
  try {
    const rows = JSON.parse(tab.rows || "[]");
    renderPlainSheetTable(wrap, rows);
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state">파일 데이터를 읽을 수 없습니다: ${escapeHtml(err.message)}</div>`;
  }
}

function stripBranchSuffix(name) { return String(name || "").replace(/점$/, ""); }

function renderPlainSheetTable(container, rows) {
  if (rows.length < 2) { container.innerHTML = `<div class="empty-state">이 시트에 표시할 데이터가 없습니다.</div>`; return; }
  const dataRows = rows.slice(1);
  const colIndexes = [];
  for (let ci = 1; ci < dataRows[0].length; ci++) colIndexes.push(ci);

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
    Promise.resolve([...state.branches]) // state.branches가 이미 팀장이 지정한 순서대로 정렬돼 있습니다.
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

function renderOpsTable(categories, branchesSorted, linksMap) {
  const wrap = document.getElementById("opsGridWrap");
  if (!branchesSorted.length) { wrap.innerHTML = `<div class="empty-state">등록된 지점이 없습니다. "지점 · 팀원 관리"에서 지점을 먼저 추가해주세요.</div>`; return; }
  if (!categories.length) { wrap.innerHTML = `<div class="empty-state">${state.profile.role === "leader" ? "위에서 양식을 먼저 추가해주세요." : "아직 등록된 양식이 없습니다."}</div>`; return; }
  const isLeaderView = state.profile.role === "leader";

  let html = `<table style="min-width:700px;"><thead><tr>
    ${branchesSorted.map(b => `<th>${escapeHtml(b.name)}</th>`).join("")}${isLeaderView ? `<th>관리</th>` : ""}</tr></thead><tbody>`;
  categories.forEach((cat, i) => {
    html += `<tr>`;
    branchesSorted.forEach(b => {
      const cellId = `${b.id}_${cat.id}`;
      const link = linksMap[cellId];
      const editable = canEditOpsCell(b.id);
      const branchColor = matchLocationColor(b.name) || "var(--blue-deep)";
      const branchTextColor = matchLocationTextColor(b.name) || "#fff";
      if (link && link.url) {
        html += `<td style="white-space:nowrap;">
          <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" class="ops-open-btn" style="background:${branchColor};color:${branchTextColor};">${escapeHtml(link.title || cat.label)} ↗</a>
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
    btn.onclick = () => {
      const cat = categories.find(c => c.id === btn.dataset.cat);
      const link = linksMap[btn.dataset.editCell];
      openOpsLinkModal(btn.dataset.editCell, btn.dataset.branch, btn.dataset.cat, link?.url || "", link?.title || "", cat?.label || "");
    };
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

function openOpsLinkModal(cellId, branchId, categoryId, currentUrl, currentTitle, categoryLabel) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `<div class="modal-bg" id="modalBg">
    <div class="modal">
      <h3>링크 설정</h3>
      <form id="opsLinkForm">
        <div class="field"><label>버튼에 표시할 제목</label><input type="text" id="opsLinkTitle" placeholder="${escapeHtml(categoryLabel || "예: 링크")}" value="${escapeHtml(currentTitle || "")}"></div>
        <p style="font-size:11px;color:var(--text-muted);margin:-8px 0 14px;">비워두면 양식 이름(${escapeHtml(categoryLabel || "")})으로 표시돼요. 같은 행이어도 지점마다 다른 제목을 쓰셔도 됩니다.</p>
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
    const title = document.getElementById("opsLinkTitle").value.trim();
    if (!url) { root.innerHTML = ""; return; }
    await setDoc(doc(db, "opsLinks", cellId), {
      branchId, categoryId, url, title, updatedAt: new Date().toISOString(), updatedBy: state.profile.name
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

  const branchesSorted = [...state.branches]; // state.branches가 이미 팀장이 지정한 순서대로 정렬돼 있습니다.
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

function seedToFirestoreShape(seed) {
  return {
    years: [...seed.years],
    people: seed.people.map(row => ({ cells: row.map(c => ({ name: c.name || "", status: c.status || null })) }))
  };
}

async function renderRosterBranchCard(branch, data) {
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
        try {
          await setDoc(doc(db, "rosterEntries", branch.id), seedToFirestoreShape(seed));
          showToast("불러왔습니다.");
          loadAndRenderRosterBranch(branch);
        } catch (err) { alert("불러오는 중 오류: " + err.message); }
      };
    }
    if (isLeader) {
      document.getElementById(`newBtn_${branch.id}`).onclick = async () => {
        try {
          await setDoc(doc(db, "rosterEntries", branch.id), { years: [], people: [] });
          loadAndRenderRosterBranch(branch);
        } catch (err) { alert("오류: " + err.message); }
      };
    }
    return;
  }

  const years = data.years || [];
  const people = data.people || [];
  const seed = findSeedForBranch(branch);

  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;gap:8px;flex-wrap:wrap;">
    <h2 style="margin:0;">${escapeHtml(branch.name)}</h2>
    <div style="display:flex;gap:8px;">
      ${isLeader && seed ? `<button class="btn small secondary" id="reseedBtn_${branch.id}">기존 자료 다시 불러오기(덮어쓰기)</button>` : ""}
      ${isLeader ? `<button class="btn small" id="addYearBtn_${branch.id}">+ 연도 추가</button>` : ""}
    </div>
  </div>`;

  if (!years.length) {
    html += `<div class="empty-state">등록된 연도가 없습니다.</div>`;
  } else {
    html += `<table class="table-compact" style="width:max-content;min-width:100%;"><thead><tr>
      ${years.map((y, yi) => `<th>${escapeHtml(y)}${isLeader ? ` <button type="button" class="icon-btn danger" data-del-year="${yi}" style="padding:2px 4px;">✕</button>` : ""}</th>`).join("")}
      ${isLeader ? `<th></th>` : ""}
    </tr></thead><tbody>
      ${people.map((person, pi) => `<tr>
        ${years.map((y, yi) => {
          const cell = (person.cells && person.cells[yi]) || { name: "", status: null };
          const bg = cell.status ? ROSTER_STATUS_COLOR[cell.status] : null;
          const textColor = cell.status === "지점이동In" ? "#000" : textColorForBg(bg);
          const style = bg ? `background:${bg};color:${textColor};font-weight:700;border-radius:4px;` : "";
          return `<td style="${style}${isLeader ? "cursor:pointer;" : ""}" ${isLeader ? `data-cell-edit="${pi}_${yi}"` : ""}>${escapeHtml(cell.name || "")}</td>`;
        }).join("")}
        ${isLeader ? `<td><button type="button" class="icon-btn danger" data-del-row="${pi}">✕</button></td>` : ""}
      </tr>`).join("")}
    </tbody></table>`;
  }
  if (isLeader) html += `<button class="btn small secondary" id="addPersonBtn_${branch.id}" style="margin-top:10px;">+ 인원 추가</button>`;

  card.innerHTML = html;
  if (!isLeader) return;

  if (document.getElementById(`reseedBtn_${branch.id}`)) {
    document.getElementById(`reseedBtn_${branch.id}`).onclick = async () => {
      if (!confirm("지금 표를 지우고 2026년까지의 기존 자료로 덮어쓸까요? (지금까지 직접 수정한 내용이 있다면 사라집니다)")) return;
      try {
        await setDoc(doc(db, "rosterEntries", branch.id), seedToFirestoreShape(seed));
        showToast("불러왔습니다.");
        loadAndRenderRosterBranch(branch);
      } catch (err) { alert("불러오는 중 오류: " + err.message); }
    };
  }
  if (document.getElementById(`addYearBtn_${branch.id}`)) {
    document.getElementById(`addYearBtn_${branch.id}`).onclick = () => {
      const label = prompt("추가할 연도 이름을 입력하세요 (예: 2027년)");
      if (!label) return;
      data.years = data.years || [];
      data.people = data.people || [];
      data.years.push(label);
      data.people.forEach(person => { person.cells = person.cells || []; person.cells.push({ name: "", status: null }); });
      saveRosterBranch(branch, data);
    };
  }
  if (document.getElementById(`addPersonBtn_${branch.id}`)) {
    document.getElementById(`addPersonBtn_${branch.id}`).onclick = () => {
      data.people = data.people || [];
      data.people.push({ cells: (data.years || []).map(() => ({ name: "", status: null })) });
      saveRosterBranch(branch, data);
    };
  }
  card.querySelectorAll("[data-del-year]").forEach(btn => {
    btn.onclick = () => {
      const yi = parseInt(btn.dataset.delYear, 10);
      if (!confirm("이 연도 열을 삭제할까요?")) return;
      data.years.splice(yi, 1);
      data.people.forEach(person => person.cells && person.cells.splice(yi, 1));
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
  try {
    await setDoc(doc(db, "rosterEntries", branch.id), data);
    renderRosterBranchCard(branch, data);
  } catch (err) {
    alert("저장 중 오류: " + err.message);
  }
}

function openRosterCellModal(branch, data, personIdx, yearIdx) {
  const root = document.getElementById("modalRoot");
  const person = data.people[personIdx] || { cells: [] };
  const cell = person.cells[yearIdx] || { name: "", status: null };
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
    if (!data.people[personIdx].cells) data.people[personIdx].cells = [];
    data.people[personIdx].cells[yearIdx] = { name, status };
    root.innerHTML = "";
    await saveRosterBranch(branch, data);
  });
}

/* ===================== OKR 폴더 (시즌 · Objective · KR · KT) ===================== */
const SEASON_DEFS = [
  { n: 1, label: "1시즌 (3~5월)" },
  { n: 2, label: "2시즌 (6~8월)" },
  { n: 3, label: "3시즌 (9~11월)" },
  { n: 4, label: "4시즌 (12~2월)" }
];
function seasonLabel(year, seasonDef) { return `${year}년 ${seasonDef.label}`; }
function seasonOptions() {
  const thisYear = new Date().getFullYear();
  const opts = [];
  for (let y = thisYear - 1; y <= thisYear + 1; y++) {
    SEASON_DEFS.forEach(s => opts.push(seasonLabel(y, s)));
  }
  return opts;
}
function extractSeasonYear(season) {
  const m = String(season || "").match(/(\d{4})년/);
  return m ? parseInt(m[1], 10) : null;
}

function parseSeasonKey(season) {
  const m = String(season || "").match(/(\d{4})년\s*(\d)시즌/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 10 + parseInt(m[2], 10);
}

// KT(Key Task)는 예전엔 문자열만 저장했지만, 이제 { text, score(1~5) } 형태로 저장합니다.
// 예전 데이터(문자열)도 그대로 읽을 수 있도록 변환해줍니다.
function normalizeKts(kts) {
  return (kts || []).map(kt => typeof kt === "string" ? { text: kt, score: 0 } : (kt || { text: "", score: 0 }));
}
// KR 달성율 = 그 KR에 속한 KT들의 점수(1~5) 평균을 100점 만점으로 환산한 값
function krAchievement(kr) {
  const kts = normalizeKts(kr && kr.kts).filter(kt => !richTextIsEmpty(kt.text) && kt.score);
  if (!kts.length) return 0;
  const avg = kts.reduce((s, kt) => s + Number(kt.score || 0), 0) / kts.length;
  return Math.round((avg / 5) * 100);
}
// 종합 달성율 = KR들의 달성율 평균
function overallAchievement(krs) {
  if (!krs || !krs.length) return 0;
  return Math.round(krs.reduce((s, k) => s + krAchievement(k), 0) / krs.length);
}

/* ===================== 업무 트레킹 - 지점별 지시 체크리스트 · 완료율 · 마감기한 =====================
   문서 하나 = 업무 하나. branchDone: { [지점ID]: true } 형태로 지점별 지시 완료 여부를 저장합니다.
=========================================================== */
function taskDdayInfo(deadline) {
  if (!deadline) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dl = new Date(deadline + "T00:00:00");
  const diffDays = Math.round((dl - today) / 86400000);
  if (diffDays < 0) return { label: `기한 ${Math.abs(diffDays)}일 지남`, tone: "overdue" };
  if (diffDays === 0) return { label: "오늘 마감", tone: "soon" };
  if (diffDays <= 3) return { label: `D-${diffDays}`, tone: "soon" };
  return { label: `D-${diffDays}`, tone: "normal" };
}
const TASK_TONE_STYLE = {
  overdue: "background:#FDEAEA;color:#C0392B;",
  soon: "background:#FFF4DE;color:#B9770E;",
  normal: "background:#EEF3FA;color:var(--blue-deep);"
};
function taskDoneCount(task, branches) {
  const map = task.branchDone || {};
  return branches.reduce((n, b) => n + (map[b.id] ? 1 : 0), 0);
}
function taskCompletionRate(task, branches) {
  if (!branches.length) return 0;
  return Math.round((taskDoneCount(task, branches) / branches.length) * 100);
}
function sortTasksForTracking(docs, branches, sortState) {
  const { column, dir } = sortState || { column: "deadline", dir: "asc" };
  const factor = dir === "desc" ? -1 : 1;
  const sorted = [...docs].sort((a, b) => {
    let cmp = 0;
    if (column === "title") {
      cmp = (a.title || "").localeCompare(b.title || "", "ko");
    } else if (column === "rate") {
      cmp = taskCompletionRate(a, branches) - taskCompletionRate(b, branches);
    } else { // deadline (기본값)
      if (a.deadline && b.deadline) cmp = a.deadline < b.deadline ? -1 : (a.deadline > b.deadline ? 1 : 0);
      else if (a.deadline) cmp = -1;
      else if (b.deadline) cmp = 1;
    }
    if (cmp === 0) cmp = (b.createdAt || "").localeCompare(a.createdAt || "");
    return cmp * factor;
  });
  return sorted;
}
const taskSortState = {}; // section.key -> { column, dir }
function getTaskSortState(sectionKey) {
  return taskSortState[sectionKey] || { column: "deadline", dir: "asc" };
}
function sortArrow(sectionKey, column) {
  const s = getTaskSortState(sectionKey);
  if (s.column !== column) return `<span style="opacity:.25;">↕</span>`;
  return s.dir === "asc" ? "↑" : "↓";
}

async function renderTaskTracking(section) {
  const main = document.getElementById("mainContent");
  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}</h1>
        <p>${section.desc}</p>
      </div>
      ${canWriteSection(section) ? `<button class="btn small" id="addTaskBtn">+ 새 업무 등록</button>` : ""}
    </div>
    <div id="taskStatsWrap" style="margin-bottom:16px;"></div>
    <div class="card" style="overflow:auto;"><div id="taskGridWrap">불러오는 중...</div></div>`;

  if (canWriteSection(section)) {
    document.getElementById("addTaskBtn").onclick = () => openTaskModal(section, null);
  }

  const docs = await fetchDocs(section);
  renderTaskTrackingBody(section, docs);
}

function renderTaskStats(tasks, branches) {
  const wrap = document.getElementById("taskStatsWrap");
  if (!wrap) return;
  if (!tasks.length) { wrap.innerHTML = ""; return; }
  const avgRate = Math.round(tasks.reduce((sum, t) => sum + taskCompletionRate(t, branches), 0) / tasks.length);
  const overdueCount = tasks.filter(t => taskDdayInfo(t.deadline)?.tone === "overdue" && taskCompletionRate(t, branches) < 100).length;
  const doneCount = tasks.filter(t => taskCompletionRate(t, branches) === 100).length;

  const branchRates = branches.map(b => {
    const done = tasks.filter(t => t.branchDone && t.branchDone[b.id]).length;
    const rate = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    return { branch: b, done, rate };
  }).sort((a, b) => a.rate - b.rate); // 완료율이 낮은 지점을 먼저 보여줍니다.

  wrap.innerHTML = `<div class="stat-grid">
    <div class="stat-card"><div class="label">전체 업무</div><div class="value">${tasks.length}건</div></div>
    <div class="stat-card"><div class="label">지시 완료율(평균)</div><div class="value">${avgRate}%</div></div>
    <div class="stat-card"><div class="label">전 지점 완료</div><div class="value">${doneCount}건</div></div>
    <div class="stat-card"><div class="label">마감 지남(미완료)</div><div class="value" style="${overdueCount ? "color:#C0392B;" : ""}">${overdueCount}건</div></div>
  </div>
  <div class="card" style="margin-top:0;">
    <h2 style="margin:0 0 12px;">지점별 지시 완료율</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;">
      ${branchRates.map(({ branch, done, rate }) => `<div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
          <span style="font-weight:700;font-size:13.5px;">${escapeHtml(branch.name)}</span>
          <span class="mono" style="font-size:12.5px;font-weight:700;color:${rate < 50 ? "#C0392B" : "var(--blue-deep)"};">${rate}%</span>
        </div>
        <div style="background:var(--bg-soft,#EEF1EA);border-radius:6px;height:8px;overflow:hidden;">
          <div style="background:${rate === 100 ? "var(--green-bright)" : rate < 50 ? "#E8938C" : "var(--blue-bright)"};height:100%;width:${rate}%;"></div>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:3px;">${done}/${tasks.length}건 완료</div>
      </div>`).join("")}
    </div>
  </div>`;
}

function renderTaskTrackingBody(section, docs) {
  const wrap = document.getElementById("taskGridWrap");
  const branches = [...state.branches];
  const sortState = getTaskSortState(section.key);
  const tasks = sortTasksForTracking(docs, branches, sortState);
  renderTaskStats(tasks, branches);

  if (!branches.length) { wrap.innerHTML = `<div class="empty-state">등록된 지점이 없습니다. "지점 · 팀원 관리"에서 지점을 먼저 추가해주세요.</div>`; return; }
  if (!tasks.length) { wrap.innerHTML = `<div class="empty-state">아직 등록된 업무가 없습니다.${canWriteSection(section) ? " 위에서 새 업무를 등록해보세요." : ""}</div>`; return; }

  const editableGlobally = canWriteSection(section);
  const sortableTh = (col, label, extraStyle) => `<th data-sort-col="${col}" style="cursor:pointer;user-select:none;${extraStyle || ""}">${label} <span style="font-size:11px;">${sortArrow(section.key, col)}</span></th>`;

  let html = `<table style="min-width:${760 + branches.length * 90}px;"><thead><tr>
    ${sortableTh("title", "업무명", "min-width:220px;")}
    ${sortableTh("deadline", "마감기한", "min-width:110px;")}
    ${branches.map(b => `<th style="text-align:center;min-width:80px;">${escapeHtml(b.name)}</th>`).join("")}
    ${sortableTh("rate", "완료율", "min-width:130px;")}
    ${editableGlobally ? `<th style="min-width:80px;">관리</th>` : ""}
  </tr></thead><tbody>`;

  tasks.forEach(task => {
    const dday = taskDdayInfo(task.deadline);
    const rate = taskCompletionRate(task, branches);
    const rowTone = dday?.tone === "overdue" && rate < 100 ? "background:#FFFBF8;" : "";
    html += `<tr style="${rowTone}">
      <td>
        <div style="font-weight:700;">${escapeHtml(task.title || "")}</div>
        ${task.note ? `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;white-space:pre-wrap;">${escapeHtml(task.note)}</div>` : ""}
      </td>
      <td style="white-space:nowrap;">
        ${task.deadline ? `<div class="mono" style="font-size:12.5px;">${escapeHtml(task.deadline)}</div>` : ""}
        ${dday ? `<span class="pill" style="display:inline-block;margin-top:4px;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;${TASK_TONE_STYLE[dday.tone]}">${dday.label}</span>` : `<span style="font-size:12px;color:var(--text-muted);">-</span>`}
      </td>
      ${branches.map(b => {
        const checked = !!(task.branchDone && task.branchDone[b.id]);
        const canToggle = editableGlobally || canCreateForBranch(section, b.id);
        return `<td style="text-align:center;">
          <input type="checkbox" data-task-toggle="${task.id}" data-branch="${b.id}" ${checked ? "checked" : ""} ${canToggle ? "" : "disabled"} style="width:18px;height:18px;cursor:${canToggle ? "pointer" : "default"};">
        </td>`;
      }).join("")}
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="flex:1;background:var(--bg-soft,#EEF1EA);border-radius:6px;height:8px;overflow:hidden;min-width:50px;">
            <div style="background:${rate === 100 ? "var(--green-bright)" : "var(--blue-bright)"};height:100%;width:${rate}%;"></div>
          </div>
          <span class="mono" style="font-size:12.5px;font-weight:700;white-space:nowrap;">${taskDoneCount(task, branches)}/${branches.length}</span>
        </div>
      </td>
      ${editableGlobally ? `<td style="white-space:nowrap;">
        <button class="icon-btn" data-edit-task="${task.id}">수정</button>
        <button class="icon-btn danger" data-del-task="${task.id}">삭제</button>
      </td>` : ""}
    </tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll("[data-sort-col]").forEach(th => {
    th.onclick = () => {
      const col = th.dataset.sortCol;
      const cur = getTaskSortState(section.key);
      taskSortState[section.key] = cur.column === col
        ? { column: col, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { column: col, dir: "asc" };
      renderTaskTrackingBody(section, tasks);
    };
  });
  wrap.querySelectorAll("[data-task-toggle]").forEach(chk => {
    chk.onchange = async () => {
      const taskId = chk.dataset.taskToggle;
      const branchId = chk.dataset.branch;
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;
      const wasChecked = chk.checked;
      chk.disabled = true;
      try {
        await updateDoc(doc(db, "folderEntries", taskId), { [`branchDone.${branchId}`]: wasChecked });
        task.branchDone = { ...(task.branchDone || {}), [branchId]: wasChecked };
        renderTaskTrackingBody(section, tasks);
      } catch (err) {
        chk.checked = !wasChecked;
        chk.disabled = false;
        alert("저장 중 오류가 발생했습니다: " + err.message);
      }
    };
  });
  wrap.querySelectorAll("[data-edit-task]").forEach(btn => {
    btn.onclick = () => openTaskModal(section, tasks.find(t => t.id === btn.dataset.editTask));
  });
  wrap.querySelectorAll("[data-del-task]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("이 업무를 삭제할까요?")) return;
      await deleteDoc(doc(db, "folderEntries", btn.dataset.delTask));
      showToast("삭제되었습니다.");
      renderSection(section.key);
    };
  });
}

function openTaskModal(section, existing) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = `<div class="modal-bg" id="modalBg">
    <div class="modal">
      <h3>${existing ? "업무 수정" : "새 업무 등록"} · ${section.label}</h3>
      <form id="taskForm">
        <div class="field"><label>업무명</label><input type="text" id="taskTitle" value="${escapeHtml(existing?.title || "")}" placeholder="예: 8월 상담 매뉴얼 배포" required></div>
        <div class="field"><label>마감기한</label><input type="date" id="taskDeadline" value="${escapeHtml(existing?.deadline || "")}"></div>
        <div class="field"><label>지시 내용(선택)</label><textarea id="taskNote" rows="3" placeholder="원장님께 전달할 지시 내용을 적어두면 체크리스트 아래에 함께 표시됩니다.">${escapeHtml(existing?.note || "")}</textarea></div>
        <p style="font-size:11px;color:var(--text-muted);margin:-6px 0 10px;">등록 후 목록 표에서 지점별로 체크박스를 눌러 지시 완료 여부를 표시할 수 있어요.</p>
        <div class="grid-2" style="margin-top:10px;">
          <button type="button" class="btn secondary" id="cancelBtn">취소</button>
          <button type="submit" class="btn" id="saveTaskBtn">저장</button>
        </div>
      </form>
    </div></div>`;
  document.getElementById("cancelBtn").onclick = () => root.innerHTML = "";
  document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") root.innerHTML = ""; });
  document.getElementById("taskForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = document.getElementById("taskTitle").value.trim();
    if (!title) return;
    const deadline = document.getElementById("taskDeadline").value;
    const note = document.getElementById("taskNote").value.trim();
    const saveBtn = document.getElementById("saveTaskBtn");
    saveBtn.disabled = true;
    try {
      if (existing) {
        await updateDoc(doc(db, "folderEntries", existing.id), { title, deadline, note });
      } else {
        await addDoc(collection(db, "folderEntries"), {
          folderId: section.folderId, title, deadline, note,
          branchDone: {}, createdAt: new Date().toISOString(), createdBy: state.profile.name
        });
      }
      root.innerHTML = "";
      showToast("저장되었습니다.");
      renderSection(section.key);
    } catch (err) {
      saveBtn.disabled = false;
      alert("저장 중 오류가 발생했습니다: " + err.message);
    }
  });
}

/* ===================== 지표 분석 - 연결한 구글 시트 기반 다양한 분석 ===================== */
function extractSheetId(url) {
  const m = String(url || "").match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : String(url || "").trim();
}
function parseMetricNumber(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const s = String(raw).trim();
  if (/^#/.test(s)) return null; // #DIV/0! 같은 에러 셀
  const cleaned = s.replace(/[,\s원%₩]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}
async function fetchSheetTabNames(spreadsheetId) {
  if (!googleAccessToken) await requestGoogleAuth();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`;
  let res = await fetch(url, { headers: { Authorization: `Bearer ${googleAccessToken}` } });
  if (res.status === 401) {
    googleAccessToken = null;
    await requestGoogleAuth();
    res = await fetch(url, { headers: { Authorization: `Bearer ${googleAccessToken}` } });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `시트 목록을 불러오지 못했습니다 (${res.status})`);
  }
  const data = await res.json();
  return (data.sheets || []).map(s => s.properties.title);
}
// 이 조직의 시트 형식: A열=지표명(4줄에 한 번씩만 표시), B열=연도, C열부터=1월~12월(과 다음해 1~2월) 값.
// 같은 지표가 연도별로 4줄씩 반복되고, 빈 줄로 지표 사이가 구분됩니다.
function parseMetricSheet(rows) {
  if (!rows || !rows.length) return { months: [], years: [], metrics: {}, metricOrder: [] };
  const header = rows[0] || [];
  const months = header.slice(2).map(m => (m || "").toString().trim()).filter(Boolean);
  const metrics = {};
  const metricOrder = [];
  const yearSet = new Set();
  let currentMetric = null;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const label = (row[0] || "").toString().trim();
    const yearLabel = (row[1] || "").toString().trim();
    if (!yearLabel) { currentMetric = null; continue; } // 빈 구분 줄
    if (label) currentMetric = label;
    if (!currentMetric) continue;
    if (!metrics[currentMetric]) { metrics[currentMetric] = {}; metricOrder.push(currentMetric); }
    const monthVals = {};
    months.forEach((m, idx) => { monthVals[m] = parseMetricNumber(row[2 + idx]); });
    metrics[currentMetric][yearLabel] = monthVals;
    yearSet.add(yearLabel);
  }
  return { months, years: [...yearSet], metrics, metricOrder };
}
function aggregateMetric(parsed, metricName, yearLabel, monthLabels, mode) {
  const yearData = parsed.metrics[metricName] && parsed.metrics[metricName][yearLabel];
  if (!yearData) return null;
  const vals = monthLabels.map(m => yearData[m]).filter(v => v !== null && v !== undefined);
  if (!vals.length) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  return mode === "sum" ? sum : sum / vals.length;
}
function prevYearLabel(yearLabel) {
  const m = String(yearLabel || "").match(/(\d{4})/);
  return m ? (parseInt(m[1], 10) - 1) + "년" : null;
}
// 연도×월을 시간순으로 쭉 이어붙인 타임라인을 만듭니다. (다음해 예고용 칸인 "27년 1월" 같은 건 제외)
function buildTimeline(parsed, metricName) {
  const stdMonths = (parsed.months || []).filter(m => /^\d{1,2}월$/.test(m));
  const years = [...parsed.years].sort();
  // 오늘 이후의 미래 달은 당연히 값이 없거나 0으로 비어있을 뿐이라, 데이터 없음으로 처리해서
  // 추이 그래프·대시보드·이상치 탐지 어디서도 "미래에 0으로 뚝 떨어진 것"처럼 보이지 않게 합니다.
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth() + 1;
  const points = [];
  years.forEach(y => {
    const yNum = parseInt(y, 10);
    stdMonths.forEach(m => {
      const mNum = parseInt(m, 10);
      const isFuture = yNum > curY || (yNum === curY && mNum > curM);
      const raw = parsed.metrics[metricName] && parsed.metrics[metricName][y] ? parsed.metrics[metricName][y][m] : null;
      points.push({ label: `${y.replace("년", "")}.${m.replace("월", "")}`, year: y, month: m, value: isFuture ? null : raw });
    });
  });
  return points;
}
function meanOf(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stddevOf(arr) {
  const m = meanOf(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}
function fmtMetricNum(n) {
  return n === null || n === undefined ? "-" : (Math.abs(n) < 5 && Math.abs(n) > 0 ? n.toFixed(3) : n.toLocaleString(undefined, { maximumFractionDigits: 1 }));
}
function renderLineChartSVG(seriesList, opts) {
  opts = opts || {};
  const width = opts.width || 900, height = opts.height || 260;
  const padL = 54, padR = 16, padT = 26, padB = 28;
  const allVals = seriesList.flatMap(s => s.points.map(p => p.value)).filter(v => v !== null && v !== undefined);
  if (!allVals.length) return `<div class="empty-state">표시할 데이터가 없습니다.</div>`;
  const maxV = Math.max(...allVals);
  const minV = Math.min(0, ...allVals);
  const n = seriesList[0].points.length;
  const xStep = (width - padL - padR) / Math.max(1, n - 1);
  const range = (maxV - minV) || 1;
  const yScale = (v) => height - padB - ((v - minV) / range) * (height - padT - padB);
  const xScale = (i) => padL + i * xStep;

  let svg = `<svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;">`;
  for (let i = 0; i <= 4; i++) {
    const v = minV + (maxV - minV) * (i / 4);
    const y = yScale(v);
    svg += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#E5EDE0" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" font-size="10" fill="#8A9A82" text-anchor="end">${Math.round(v).toLocaleString()}</text>`;
  }
  seriesList.forEach(s => {
    const ptStr = s.points.map((p, i) => p.value === null ? null : `${xScale(i)},${yScale(p.value)}`).filter(Boolean).join(" ");
    svg += `<polyline points="${ptStr}" fill="none" stroke="${s.color}" stroke-width="2.5"/>`;
    s.points.forEach((p, i) => {
      if (p.value === null) return;
      const cx = xScale(i), cy = yScale(p.value);
      svg += `<circle cx="${cx}" cy="${cy}" r="2.4" fill="${s.color}"><title>${escapeHtml(p.label)}: ${fmtMetricNum(p.value)}</title></circle>`;
      svg += `<text x="${cx}" y="${cy - 7}" font-size="9" fill="${s.color}" text-anchor="middle">${escapeHtml(fmtMetricNum(p.value))}</text>`;
    });
  });
  const labelEvery = Math.max(1, Math.ceil(n / 12));
  seriesList[0].points.forEach((p, i) => {
    if (i % labelEvery === 0) svg += `<text x="${xScale(i)}" y="${height - 8}" font-size="9" fill="#8A9A82" text-anchor="middle">${escapeHtml(p.label)}</text>`;
  });
  svg += `</svg>`;
  if (seriesList.length > 1) {
    svg = `<div style="display:flex;gap:14px;margin-bottom:6px;flex-wrap:wrap;">${seriesList.map(s => `<span style="display:flex;align-items:center;gap:5px;font-size:12px;"><span style="width:10px;height:10px;border-radius:2px;background:${s.color};display:inline-block;"></span>${escapeHtml(s.name)}</span>`).join("")}</div>` + svg;
  }
  return svg;
}
function renderSparklineSVG(points, color) {
  const width = 130, height = 32;
  const vals = points.map(p => p.value).filter(v => v !== null && v !== undefined);
  if (!vals.length) return `<span style="font-size:11px;color:var(--text-muted);">데이터 없음</span>`;
  const maxV = Math.max(...vals), minV = Math.min(...vals);
  const range = (maxV - minV) || 1;
  const n = points.length;
  const xStep = width / Math.max(1, n - 1);
  const yScale = (v) => height - 3 - ((v - minV) / range) * (height - 6);
  const ptStr = points.map((p, i) => p.value === null ? null : `${i * xStep},${yScale(p.value)}`).filter(Boolean).join(" ");
  const dots = points.map((p, i) => {
    if (p.value === null) return "";
    // 투명하고 조금 큰 원을 점 위에 겹쳐서, 정확히 점을 안 짚어도 마우스만 가까이 가면 툴팁이 뜨게 합니다.
    return `<circle cx="${i * xStep}" cy="${yScale(p.value)}" r="6" fill="transparent" stroke="none">
      <title>${escapeHtml(p.label)}: ${fmtMetricNum(p.value)}</title>
    </circle><circle cx="${i * xStep}" cy="${yScale(p.value)}" r="1.6" fill="${color}"/>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" style="width:100%;height:${height}px;display:block;"><polyline points="${ptStr}" fill="none" stroke="${color}" stroke-width="2"/>${dots}</svg>`;
}

const GRADE_POINTS = { "S": 5, "A": 4, "B+": 3, "B-": 2, "C": 1, "F": 0 };
// 데이터 시트의 지표 이름 -> 점수표(신호등) 시트의 지표 이름. 이름 표기가 서로 달라서 직접 연결해둡니다.
const RUBRIC_METRIC_MAP = {
  "전체학생수": "전체 학생수",
  "상담관리이탈율": "상담 이탈율",
  "개별지도이탈율": "개별 이탈율",
  "프리미엄율": "프리미엄율",
  "수익율": "당기순이익률"
};
// "신호등" 탭 형식: [C열=그룹/지표명, D~I열=S,A,B+,B-,C,F] 헤더 아래로, "공통" 그룹은 각 줄이 지표(전 지점 공통 기준)이고
// 그 외 그룹(전체 학생수, 매출 등)은 각 줄이 지점별 기준입니다.
function parseRubricSheet(rows) {
  const rubric = {};
  let i = 0;
  while (i < rows.length) {
    const row = rows[i] || [];
    const label = (row[2] || "").toString().trim();
    const isHeaderRow = (row[3] || "").toString().trim() === "S" && (row[4] || "").toString().trim() === "A";
    if (isHeaderRow && label) {
      const groupLabel = label;
      const entry = { mode: groupLabel === "공통" ? "universal-group" : "perBranch", perBranch: {} };
      i++;
      while (i < rows.length) {
        const r2 = rows[i] || [];
        const label2 = (r2[2] || "").toString().trim();
        if (!label2) { i++; break; } // 빈 줄이면 이 블록 끝
        const v = [3, 4, 5, 6, 7].map(idx => parseMetricNumber(r2[idx]));
        const thresholds = { S: v[0], A: v[1], "B+": v[2], "B-": v[3], C: v[4] };
        if (groupLabel === "공통") {
          rubric[label2] = { mode: "universal", universal: thresholds };
        } else {
          entry.perBranch[label2] = thresholds;
        }
        i++;
      }
      if (groupLabel !== "공통") rubric[groupLabel] = entry;
    } else {
      i++;
    }
  }
  return rubric;
}
function getThresholdsFor(rubricEntry, branchName) {
  if (!rubricEntry) return null;
  if (rubricEntry.mode === "universal") return rubricEntry.universal;
  return rubricEntry.perBranch[branchName] || null;
}
function gradeForValue(thresholds, value) {
  if (value === null || value === undefined || !thresholds) return null;
  const S = thresholds.S, C = thresholds.C;
  if (typeof S !== "number" || typeof C !== "number") return null;
  const higherBetter = S >= C; // S~C가 내림차순이면 높을수록 좋은 지표, 오름차순이면 낮을수록 좋은 지표
  for (const g of ["S", "A", "B+", "B-", "C"]) {
    const t = thresholds[g];
    if (typeof t !== "number") continue;
    if (higherBetter ? value >= t : value <= t) return g;
  }
  return "F";
}

// 엑셀 파일에는 서식만 적용된 빈 줄/빈 칸이 수백~수천 개씩 딸려오는 경우가 많아서,
// 실제 데이터가 있는 범위까지만 잘라내 Firestore에 저장할 용량을 크게 줄입니다.
function trimSheetRows(rows) {
  const isEmptyCell = (c) => c === "" || c === null || c === undefined;
  while (rows.length && rows[rows.length - 1].every(isEmptyCell)) rows.pop();
  let maxCols = 0;
  rows.forEach(r => {
    let lastNonEmpty = -1;
    r.forEach((c, i) => { if (!isEmptyCell(c)) lastNonEmpty = i; });
    maxCols = Math.max(maxCols, lastNonEmpty + 1);
  });
  return rows.map(r => r.slice(0, maxCols));
}
async function renderMetricAnalysis(section) {
  const main = document.getElementById("mainContent");
  const folder = state.customFolders.find(f => f.id === section.folderId);
  const isLeader = state.profile.role === "leader";

  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}</h1>
        <p>${section.desc}</p>
      </div>
      <a href="https://docs.google.com/spreadsheets/d/10KwiAbBdzcP88BKHL2dzFzTN3yzPXuKTSxQRkPct9zo/edit?gid=1236409240#gid=1236409240" target="_blank" rel="noopener" class="btn small secondary" style="text-decoration:none;display:inline-flex;align-items:center;white-space:nowrap;">원본 파일 열기 ↗</a>
    </div>
    ${isLeader ? `
    <div class="card">
      <h2>엑셀 파일 업로드</h2>
      <p style="font-size:12px;color:var(--text-muted);margin:0 0 12px;">엑셀 파일(.xlsx)을 올리면 그 안의 모든 탭을 한 번에 읽어서 저장해요. 나중에 데이터가 바뀌면 새 파일을 다시 올려서 덮어쓰시면 돼요 (구글 계정 연결 없이 바로 반영돼요).</p>
      <input type="file" id="metricFileInput" accept=".xlsx,.xls">
      <p id="metricUploadStatus" style="font-size:12px;color:var(--text-muted);margin-top:8px;">${folder?.sheetFileName ? `현재 연결된 파일: <strong>${escapeHtml(folder.sheetFileName)}</strong> (${escapeHtml((folder.sheetUpdatedAt || "").slice(0, 16).replace("T", " "))} 업로드)` : ""}</p>
      <p style="font-size:11px;color:var(--text-muted);margin:6px 0 0;">각 탭은 A열=지표명, B열=연도, C열부터 1~12월 값 형식이어야 해요.</p>
    </div>` : (!folder?.sheetFileName ? `<div class="card"><div class="empty-state">아직 팀장이 연결한 파일이 없습니다.</div></div>` : "")}
    <div id="metricModeToggle" style="display:none;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
      <button class="btn small" id="modeDashBtn" type="button">요약 대시보드</button>
      <button class="btn small secondary" id="modeTrendBtn" type="button">시간 추이 그래프</button>
      <button class="btn small secondary" id="modeTwoBtn" type="button">두 기준 비교</button>
      ${canViewAllRole() ? `<button class="btn small secondary" id="modeAllBtn" type="button">지표별 전체 지점 비교</button>` : ""}
      <button class="btn small secondary" id="modeYoyBtn" type="button">전년 대비 증감률(YoY)</button>
      ${canViewAllRole() ? `<button class="btn small secondary" id="modeRankBtn" type="button">지점 순위</button>` : ""}
      <button class="btn small secondary" id="modeAnomalyBtn" type="button">이상치 탐지</button>
    </div>

    <div class="card" id="metricDashboardCard" style="display:none;">
      <h2>요약 대시보드</h2>
      <p style="font-size:12px;color:var(--text-muted);margin-top:-6px;">고른 지점·시점 기준으로 모든 지표의 현재값·전월 대비·최근 12개월 추이를 한 화면에 보여드려요.</p>
      <div class="grid-3" style="align-items:end;">
        <div class="field" style="margin:0;"><label>지점</label><select id="dashBranch"></select></div>
        <div class="field" style="margin:0;"><label>연도</label><select id="dashYear"></select></div>
        <div class="field" style="margin:0;"><label>월</label><select id="dashMonth"></select></div>
      </div>
      <button class="btn" id="dashRunBtn" type="button" style="width:auto;padding:10px 24px;margin-top:12px;">보기</button>
      <div id="metricDashboardWrap" style="margin-top:18px;"></div>
    </div>

    <div class="card" id="metricTrendCard" style="display:none;">
      <h2>시간 추이 그래프</h2>
      <p style="font-size:12px;color:var(--text-muted);margin-top:-6px;">지표 하나를 골라 2023년부터 지금까지 어떻게 변해왔는지 지점별로 겹쳐서 볼 수 있어요.</p>
      <div class="grid-2" style="align-items:end;">
        <div class="field" style="margin:0;"><label>지표</label><select id="trendMetric"></select></div>
        <div class="field" style="margin:0;">
          <label>지점 (여러 개 선택 가능)</label>
          <div id="trendBranchHolder" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;"></div>
        </div>
      </div>
      <button class="btn" id="trendRunBtn" type="button" style="width:auto;padding:10px 24px;margin-top:12px;">그래프 보기</button>
      <div id="metricTrendWrap" style="margin-top:18px;overflow-x:auto;"></div>
    </div>

    <div class="card" id="metricCompareCard" style="display:none;">
      <h2>비교할 두 기준 선택</h2>
      <p style="font-size:12px;color:var(--text-muted);margin-top:-6px;">지점을 다르게 고르면 지점끼리, 연도를 다르게 고르면 전년 동월 비교, 월을 1~3개 고르면 그 기간 합계/평균으로 비교돼요.</p>
      <div class="grid-2" style="align-items:start;gap:16px;">
        <div id="groupA-holder"></div>
        <div id="groupB-holder"></div>
      </div>
      <div style="display:flex;align-items:center;gap:16px;margin-top:16px;flex-wrap:wrap;">
        <div style="font-size:12.5px;font-weight:700;">여러 달을 골랐을 때:</div>
        <label style="font-size:12.5px;display:flex;align-items:center;gap:5px;"><input type="radio" name="metricAggMode" value="avg" checked> 평균</label>
        <label style="font-size:12.5px;display:flex;align-items:center;gap:5px;"><input type="radio" name="metricAggMode" value="sum"> 합계</label>
        <button class="btn" id="metricCompareBtn" type="button" style="width:auto;padding:10px 24px;margin-left:auto;">비교하기</button>
      </div>
    </div>

    <div class="card" id="metricAllCard" style="display:none;">
      <h2>지표 하나로 전체 지점 비교</h2>
      <p style="font-size:12px;color:var(--text-muted);margin-top:-6px;">지표 하나와 시점(연도·월 1~3개)을 고르면, 그 시점 기준으로 모든 지점을 나란히 보여드려요.</p>
      <div class="grid-3" style="align-items:end;">
        <div class="field" style="margin:0;"><label>지표</label><select id="allMetricSelect"></select></div>
        <div class="field" style="margin:0;"><label>연도</label><select id="allYearSelect"></select></div>
        <div class="field" style="margin:0;">
          <label>월 (1~3개 선택)</label>
          <div id="allMonthsHolder" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;"></div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:16px;margin-top:16px;flex-wrap:wrap;">
        <div style="font-size:12.5px;font-weight:700;">여러 달을 골랐을 때:</div>
        <label style="font-size:12.5px;display:flex;align-items:center;gap:5px;"><input type="radio" name="metricAllAggMode" value="avg" checked> 평균</label>
        <label style="font-size:12.5px;display:flex;align-items:center;gap:5px;"><input type="radio" name="metricAllAggMode" value="sum"> 합계</label>
        <button class="btn" id="metricAllCompareBtn" type="button" style="width:auto;padding:10px 24px;margin-left:auto;">비교하기</button>
      </div>
    </div>

    <div class="card" id="metricYoyCard" style="display:none;">
      <h2>전년 대비 증감률 (전체 지표)</h2>
      <p style="font-size:12px;color:var(--text-muted);margin-top:-6px;">지표를 하나하나 고를 필요 없이, 지점·연도·월만 고르면 모든 지표를 작년 같은 달과 한 번에 비교해요.</p>
      <div class="grid-3" style="align-items:end;">
        <div class="field" style="margin:0;"><label>지점</label><select id="yoyBranch"></select></div>
        <div class="field" style="margin:0;"><label>연도 (올해)</label><select id="yoyYear"></select></div>
        <div class="field" style="margin:0;"><label>월</label><select id="yoyMonth"></select></div>
      </div>
      <button class="btn" id="yoyRunBtn" type="button" style="width:auto;padding:10px 24px;margin-top:12px;">비교하기</button>
    </div>

    <div class="card" id="metricRankCard" style="display:none;">
      <h2>지점별 종합 순위 (가중치 점수화)</h2>
      <p style="font-size:12px;color:var(--text-muted);margin-top:-6px;">순위에 반영할 지표를 체크하고, 가중치와 "높을수록/낮을수록 좋음"을 정해주세요. (이탈율처럼 낮은 게 좋은 지표는 꼭 "낮을수록 좋음"으로 바꿔주세요)</p>
      <div class="grid-2" style="align-items:end;">
        <div class="field" style="margin:0;"><label>연도</label><select id="rankYear"></select></div>
        <div class="field" style="margin:0;">
          <label>월 (1~3개)</label>
          <div id="rankMonthsHolder" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;"></div>
        </div>
      </div>
      <div style="display:flex;gap:16px;margin-top:10px;">
        <label style="font-size:12.5px;"><input type="radio" name="rankAggMode" value="avg" checked> 평균</label>
        <label style="font-size:12.5px;"><input type="radio" name="rankAggMode" value="sum"> 합계</label>
      </div>
      <div id="rankMetricsHolder" style="margin-top:14px;"></div>
      <button class="btn" id="rankRunBtn" type="button" style="width:auto;padding:10px 24px;margin-top:12px;">순위 계산하기</button>
    </div>

    <div class="card" id="metricAnomalyCard" style="display:none;">
      <h2>이상치 탐지</h2>
      <p style="font-size:12px;color:var(--text-muted);margin-top:-6px;">2023년부터 지금까지의 흐름에서 평균과 크게 벗어난 달을 자동으로 찾아드려요.</p>
      <div class="grid-3" style="align-items:end;">
        <div class="field" style="margin:0;"><label>지점</label><select id="anomalyBranch"></select></div>
        <div class="field" style="margin:0;"><label>지표</label><select id="anomalyMetric"></select></div>
        <div class="field" style="margin:0;"><label>민감도</label>
          <select id="anomalySensitivity">
            <option value="2">둔감하게 (2표준편차 이상만)</option>
            <option value="1.5" selected>보통 (1.5표준편차 이상)</option>
            <option value="1">민감하게 (1표준편차 이상)</option>
          </select>
        </div>
      </div>
      <button class="btn" id="anomalyRunBtn" type="button" style="width:auto;padding:10px 24px;margin-top:12px;">찾기</button>
    </div>

    <div class="card" style="overflow:auto;"><div id="metricResultWrap"></div></div>`;

  let sheetData = null;
  try { sheetData = folder?.sheetData ? JSON.parse(folder.sheetData) : null; } catch (err) { sheetData = null; }

  if (isLeader) {
    document.getElementById("metricFileInput").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file || !folder) return;
      const statusEl = document.getElementById("metricUploadStatus");
      statusEl.textContent = "읽는 중...";
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const newSheetData = {};
        wb.SheetNames.forEach(name => {
          newSheetData[name] = trimSheetRows(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false }));
        });
        await updateDoc(doc(db, "customFolders", folder.id), {
          sheetData: JSON.stringify(newSheetData),
          sheetFileName: file.name,
          sheetUpdatedAt: new Date().toISOString()
        });
        await loadCustomFolders();
        showToast("파일이 저장되었습니다.");
        renderSection(section.key);
      } catch (err) {
        statusEl.textContent = "읽기 실패: " + err.message;
      }
    });
  }

  const tabCache = {}; // tabName -> parseMetricSheet 결과 (같은 탭 반복 파싱 방지)
  function getParsedTab(_unused, tabName) {
    if (tabCache[tabName]) return tabCache[tabName];
    const rows = (sheetData && sheetData[tabName]) || [];
    const parsed = parseMetricSheet(rows);
    tabCache[tabName] = parsed;
    return parsed;
  }

  function groupSelectorHtml(prefix, title, tabNames, years, months) {
    return `<div style="border:1.5px solid var(--border);border-radius:10px;padding:14px;">
      <div style="font-weight:800;font-size:13px;margin-bottom:10px;">${title}</div>
      <div class="field" style="margin:0 0 10px;"><label>지점</label>
        <select id="${prefix}Branch">${tabNames.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}</select>
      </div>
      <div class="field" style="margin:0 0 10px;"><label>연도</label>
        <select id="${prefix}Year">${years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("")}</select>
      </div>
      <div class="field" style="margin:0;"><label>월 (1~3개 선택)</label>
        <div id="${prefix}Months" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;">
          ${months.map(m => `<label style="font-size:12px;display:flex;align-items:center;gap:4px;background:#F4FAEF;border:1px solid var(--border);border-radius:6px;padding:4px 8px;cursor:pointer;">
            <input type="checkbox" class="${prefix}MonthChk" value="${escapeHtml(m)}">${escapeHtml(m)}
          </label>`).join("")}
        </div>
      </div>
    </div>`;
  }

  let tabNamesG = [], firstParsedG = null;

  function setCompareMode(mode) {
    const cards = { dash: "metricDashboardCard", trend: "metricTrendCard", two: "metricCompareCard", all: "metricAllCard", yoy: "metricYoyCard", rank: "metricRankCard", anomaly: "metricAnomalyCard" };
    const btns = { dash: "modeDashBtn", trend: "modeTrendBtn", two: "modeTwoBtn", all: "modeAllBtn", yoy: "modeYoyBtn", rank: "modeRankBtn", anomaly: "modeAnomalyBtn" };
    Object.keys(cards).forEach(k => {
      const cardEl = document.getElementById(cards[k]);
      const btnEl = document.getElementById(btns[k]);
      if (!cardEl || !btnEl) return; // 지점 순위처럼 권한이 없어 버튼/카드 자체가 안 그려진 경우
      cardEl.style.display = k === mode ? "block" : "none";
      btnEl.className = k === mode ? "btn small" : "btn small secondary";
    });
    document.getElementById("metricResultWrap").innerHTML = "";
  }
  document.getElementById("modeDashBtn").onclick = () => setCompareMode("dash");
  document.getElementById("modeTrendBtn").onclick = () => setCompareMode("trend");
  document.getElementById("modeTwoBtn").onclick = () => setCompareMode("two");
  if (document.getElementById("modeAllBtn")) document.getElementById("modeAllBtn").onclick = () => setCompareMode("all");
  document.getElementById("modeYoyBtn").onclick = () => setCompareMode("yoy");
  if (document.getElementById("modeRankBtn")) document.getElementById("modeRankBtn").onclick = () => setCompareMode("rank");
  document.getElementById("modeAnomalyBtn").onclick = () => setCompareMode("anomaly");

  async function initAllViews(tabNames, firstParsed, spreadsheetId) {
    tabNamesG = tabNames; firstParsedG = firstParsed;
    // 지점 소속 팀원(원장님)은 자기 지점만 볼 수 있게, 이 지표 분석 안의 모든 "지점" 선택란을 제한합니다.
    const restrictedBranch = canViewAllRole() ? null : (tabNames.includes(state.profile.branchName) ? state.profile.branchName : null);
    const branchOptionsFor = (allTabs) => restrictedBranch ? allTabs.filter(t => t === restrictedBranch) : allTabs;
    // 혹시 지표 형식이 아닌 탭이 섞여 있어도, 연도/월처럼 안 생긴 값은 걸러내서 선택란에 이상한 값이 안 뜨게 합니다.
    const years = [...firstParsed.years].filter(y => /^\d{4}년$/.test(y)).sort();
    const months = firstParsed.months.filter(m => /^\d{1,2}월$/.test(m) || /^\d{2}년\s*\d{1,2}월$/.test(m));
    const stdMonths = months.filter(m => /^\d{1,2}월$/.test(m));

    // 두 기준 비교
    document.getElementById("groupA-holder").innerHTML = groupSelectorHtml("gA", "기준 A", branchOptionsFor(tabNames), years, months);
    document.getElementById("groupB-holder").innerHTML = groupSelectorHtml("gB", "기준 B", branchOptionsFor(tabNames), years, months);
    if (years.length > 1) {
      document.getElementById("gAYear").value = years[years.length - 2];
      document.getElementById("gBYear").value = years[years.length - 1];
    }
    if (months.length) {
      document.querySelector(`.gAMonthChk[value="${CSS.escape(months[0])}"]`).checked = true;
      document.querySelector(`.gBMonthChk[value="${CSS.escape(months[0])}"]`).checked = true;
    }

    // 지표별 전체 지점 비교
    document.getElementById("allMetricSelect").innerHTML = firstParsed.metricOrder.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
    document.getElementById("allYearSelect").innerHTML = years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("");
    document.getElementById("allYearSelect").value = years[years.length - 1];
    document.getElementById("allMonthsHolder").innerHTML = months.map(m => `<label style="font-size:12px;display:flex;align-items:center;gap:4px;background:#F4FAEF;border:1px solid var(--border);border-radius:6px;padding:4px 8px;cursor:pointer;">
      <input type="checkbox" class="allMonthChk" value="${escapeHtml(m)}">${escapeHtml(m)}
    </label>`).join("");
    if (months.length) document.querySelector(`.allMonthChk[value="${CSS.escape(months[0])}"]`).checked = true;

    // 대시보드
    document.getElementById("dashBranch").innerHTML = branchOptionsFor(tabNames).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
    document.getElementById("dashYear").innerHTML = years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("");
    document.getElementById("dashYear").value = years[years.length - 1];
    document.getElementById("dashMonth").innerHTML = stdMonths.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");

    // 추이 그래프
    document.getElementById("trendMetric").innerHTML = firstParsed.metricOrder.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");
    document.getElementById("trendBranchHolder").innerHTML = branchOptionsFor(tabNames).map((t, i) => `<label style="font-size:12px;display:flex;align-items:center;gap:4px;background:#F4FAEF;border:1px solid var(--border);border-radius:6px;padding:4px 8px;cursor:pointer;">
      <input type="checkbox" class="trendBranchChk" value="${escapeHtml(t)}" ${i === 0 ? "checked" : ""}>${escapeHtml(t)}
    </label>`).join("");

    // YoY
    document.getElementById("yoyBranch").innerHTML = branchOptionsFor(tabNames).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
    document.getElementById("yoyYear").innerHTML = years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("");
    document.getElementById("yoyYear").value = years[years.length - 1];
    document.getElementById("yoyMonth").innerHTML = stdMonths.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");

    // 순위
    document.getElementById("rankYear").innerHTML = years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("");
    document.getElementById("rankYear").value = years[years.length - 1];
    document.getElementById("rankMonthsHolder").innerHTML = months.map(m => `<label style="font-size:12px;display:flex;align-items:center;gap:4px;background:#F4FAEF;border:1px solid var(--border);border-radius:6px;padding:4px 8px;cursor:pointer;">
      <input type="checkbox" class="rankMonthChk" value="${escapeHtml(m)}">${escapeHtml(m)}
    </label>`).join("");
    if (months.length) document.querySelector(`.rankMonthChk[value="${CSS.escape(months[0])}"]`).checked = true;
    document.getElementById("rankMetricsHolder").innerHTML = `<div style="display:grid;grid-template-columns:1fr 90px;gap:8px 10px;align-items:center;border:1px solid var(--border);border-radius:8px;padding:10px;">
      ${firstParsed.metricOrder.filter(m => RUBRIC_METRIC_MAP[m]).map(m => `
        <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;"><input type="checkbox" class="rankMetricChk" value="${escapeHtml(m)}" checked>${escapeHtml(m)}</label>
        <input type="number" class="rankMetricWeight" data-metric="${escapeHtml(m)}" value="1" min="0" step="0.5">
      `).join("")}
    </div>
    <p style="font-size:11px;color:var(--text-muted);margin:8px 0 0;">점수표(신호등 탭)에 기준이 있는 지표만 순위 계산에 쓸 수 있어요. 나머지 지표는 점수표가 없어서 자동으로 빠져요.</p>`;

    // 이상치
    document.getElementById("anomalyBranch").innerHTML = (restrictedBranch ? "" : `<option value="__all__">전체 지점</option>`) + branchOptionsFor(tabNames).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
    document.getElementById("anomalyMetric").innerHTML = firstParsed.metricOrder.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join("");

    document.getElementById("metricModeToggle").style.display = "flex";
    setCompareMode("dash");

    // ---------- 대시보드 실행 ----------
    document.getElementById("dashRunBtn").onclick = async () => {
      const wrap = document.getElementById("metricDashboardWrap");
      wrap.innerHTML = `<div class="empty-state">불러오는 중...</div>`;
      try {
        const branch = document.getElementById("dashBranch").value;
        const year = document.getElementById("dashYear").value;
        const month = document.getElementById("dashMonth").value;
        const parsed = await getParsedTab(spreadsheetId, branch);
        const timelineKeys = years.flatMap(y => stdMonths.map(m => ({ year: y, month: m })));
        const idx = timelineKeys.findIndex(k => k.year === year && k.month === month);
        wrap.innerHTML = `<div class="stat-grid">${parsed.metricOrder.map(name => {
          const full = buildTimeline(parsed, name);
          const cur = idx >= 0 ? full[idx].value : null;
          const prev = idx > 0 ? full[idx - 1].value : null;
          const diff = (cur !== null && prev !== null) ? cur - prev : null;
          const pct = (diff !== null && prev) ? (diff / Math.abs(prev)) * 100 : null;
          const up = diff !== null && diff > 0, down = diff !== null && diff < 0;
          const tone = up ? "#E03C3C" : down ? "#2979FF" : "var(--text-muted)";
          const arrow = up ? "▲" : down ? "▼" : "-";
          const spark = idx >= 0 ? full.slice(Math.max(0, idx - 11), idx + 1) : full.slice(-12);
          return `<div class="stat-card">
            <div class="label">${escapeHtml(name)}</div>
            <div class="value">${fmtMetricNum(cur)}</div>
            <div class="mono" style="font-size:12px;color:${tone};font-weight:700;margin-top:2px;">${pct !== null ? `${arrow} ${Math.abs(pct).toFixed(1)}% (전월비)` : "전월 비교 불가"}</div>
            <div style="margin-top:8px;">${renderSparklineSVG(spark, "#3B9BE8")}</div>
          </div>`;
        }).join("")}</div>`;
      } catch (err) {
        wrap.innerHTML = `<div class="empty-state">오류: ${escapeHtml(err.message)}</div>`;
      }
    };

    // ---------- 추이 그래프 실행 ----------
    document.getElementById("trendRunBtn").onclick = async () => {
      const wrap = document.getElementById("metricTrendWrap");
      wrap.innerHTML = `<div class="empty-state">불러오는 중...</div>`;
      try {
        const metricName = document.getElementById("trendMetric").value;
        const branches = [...document.querySelectorAll(".trendBranchChk:checked")].map(el => el.value);
        if (!branches.length) { wrap.innerHTML = `<div class="empty-state">지점을 최소 1개 선택해주세요.</div>`; return; }
        const palette = ["#2979FF", "#00C853", "#E03C3C", "#F5A623", "#8E1E5C", "#00B8D9"];
        const parsedList = await Promise.all(branches.map(b => getParsedTab(spreadsheetId, b)));
        const seriesList = branches.map((b, i) => ({ name: b, color: matchLocationColor(b) || palette[i % palette.length], points: buildTimeline(parsedList[i], metricName) }));
        wrap.innerHTML = `<div style="min-width:700px;">${renderLineChartSVG(seriesList, { width: 900, height: 280 })}</div>`;
      } catch (err) {
        wrap.innerHTML = `<div class="empty-state">오류: ${escapeHtml(err.message)}</div>`;
      }
    };

    // ---------- 두 기준 비교 실행 ----------
    document.getElementById("metricCompareBtn").onclick = async () => {
      const resultWrap = document.getElementById("metricResultWrap");
      const monthsA = [...document.querySelectorAll(".gAMonthChk:checked")].map(el => el.value);
      const monthsB = [...document.querySelectorAll(".gBMonthChk:checked")].map(el => el.value);
      if (!monthsA.length || !monthsB.length) { resultWrap.innerHTML = `<div class="empty-state">양쪽 다 월을 최소 1개 선택해주세요.</div>`; return; }
      if (monthsA.length > 3 || monthsB.length > 3) { resultWrap.innerHTML = `<div class="empty-state">월은 최대 3개까지 고를 수 있어요.</div>`; return; }
      const mode = document.querySelector('input[name="metricAggMode"]:checked').value;
      const branchA = document.getElementById("gABranch").value;
      const branchB = document.getElementById("gBBranch").value;
      const yearA = document.getElementById("gAYear").value;
      const yearB = document.getElementById("gBYear").value;

      resultWrap.innerHTML = `<div class="empty-state">불러오는 중...</div>`;
      try {
        const [parsedA, parsedB] = await Promise.all([getParsedTab(spreadsheetId, branchA), getParsedTab(spreadsheetId, branchB)]);
        const metricNames = [...new Set([...parsedA.metricOrder, ...parsedB.metricOrder])];
        const labelA = `${branchA} · ${yearA} · ${monthsA.join("·")}`;
        const labelB = `${branchB} · ${yearB} · ${monthsB.join("·")}`;
        const results = metricNames.map(name => {
          const valA = aggregateMetric(parsedA, name, yearA, monthsA, mode);
          const valB = aggregateMetric(parsedB, name, yearB, monthsB, mode);
          const diff = (valA !== null && valB !== null) ? valB - valA : null;
          const pct = (diff !== null && valA) ? (diff / Math.abs(valA)) * 100 : null;
          return { name, valA, valB, diff, pct };
        });
        resultWrap.innerHTML = renderDiffTable(["지표", labelA, labelB, "증감", "증감율"], results.map(r => [r.name, fmtMetricNum(r.valA), fmtMetricNum(r.valB), r.diff, r.pct]));
      } catch (err) {
        resultWrap.innerHTML = `<div class="empty-state">비교 중 오류: ${escapeHtml(err.message)}</div>`;
      }
    };

    // ---------- 지표별 전체 지점 비교 실행 ----------
    document.getElementById("metricAllCompareBtn").onclick = async () => {
      const resultWrap = document.getElementById("metricResultWrap");
      const metricName = document.getElementById("allMetricSelect").value;
      const year = document.getElementById("allYearSelect").value;
      const monthsSel = [...document.querySelectorAll(".allMonthChk:checked")].map(el => el.value);
      if (!monthsSel.length) { resultWrap.innerHTML = `<div class="empty-state">월을 최소 1개 선택해주세요.</div>`; return; }
      if (monthsSel.length > 3) { resultWrap.innerHTML = `<div class="empty-state">월은 최대 3개까지 고를 수 있어요.</div>`; return; }
      const mode = document.querySelector('input[name="metricAllAggMode"]:checked').value;

      resultWrap.innerHTML = `<div class="empty-state">불러오는 중...</div>`;
      try {
        const branchTabs = tabNames.filter(t => t !== "셀프팀");
        const parsedByBranch = {};
        await Promise.all(branchTabs.map(async t => { parsedByBranch[t] = await getParsedTab(spreadsheetId, t); }));
        const results = branchTabs.map(t => ({ branch: t, value: aggregateMetric(parsedByBranch[t], metricName, year, monthsSel, mode) }))
          .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
        // 음수가 있을 수 있는 지표(당기순이익, 수익율 등)를 위해 0을 기준으로 양쪽으로 뻗는 막대로 그립니다.
        const maxPos = Math.max(0, ...results.map(r => r.value ?? 0));
        const maxNegAbs = Math.max(0, ...results.map(r => r.value !== null ? Math.max(0, -r.value) : 0));
        const totalRange = Math.max(1, maxPos + maxNegAbs);
        const zeroPct = (maxNegAbs / totalRange) * 100;
        const periodLabel = `${year} · ${monthsSel.join("·")} (${mode === "sum" ? "합계" : "평균"})`;
        resultWrap.innerHTML = `<p style="font-size:12.5px;color:var(--text-muted);margin:0 0 12px;"><strong>${escapeHtml(metricName)}</strong> · ${escapeHtml(periodLabel)}</p>
          <table><thead><tr><th>지점</th><th>값</th><th style="width:40%;"></th></tr></thead><tbody>
          ${results.map(r => {
            const barColor = matchLocationColor(r.branch) || "var(--blue-deep)";
            let barInner = "";
            if (r.value !== null) {
              const widthPct = Math.max(1, (Math.abs(r.value) / totalRange) * 100);
              const leftPct = r.value >= 0 ? zeroPct : zeroPct - widthPct;
              barInner = `<div style="position:absolute;top:0;bottom:0;left:${leftPct}%;width:${widthPct}%;background:${barColor};border-radius:3px;"></div>`;
            }
            const zeroLine = (zeroPct > 0.5 && zeroPct < 99.5)
              ? `<div style="position:absolute;top:0;bottom:0;left:${zeroPct}%;width:1px;background:#AEC2A0;"></div>` : "";
            return `<tr>
              <td style="font-weight:700;">${escapeHtml(r.branch)}</td>
              <td class="mono" style="font-weight:700;">${fmtMetricNum(r.value)}</td>
              <td><div style="position:relative;background:#EAF3E3;border-radius:6px;height:16px;overflow:hidden;">${zeroLine}${barInner}</div></td>
            </tr>`;
          }).join("")}
        </tbody></table>`;
      } catch (err) {
        resultWrap.innerHTML = `<div class="empty-state">비교 중 오류: ${escapeHtml(err.message)}</div>`;
      }
    };

    // ---------- YoY 실행 ----------
    document.getElementById("yoyRunBtn").onclick = async () => {
      const resultWrap = document.getElementById("metricResultWrap");
      const branch = document.getElementById("yoyBranch").value;
      const year = document.getElementById("yoyYear").value;
      const month = document.getElementById("yoyMonth").value;
      const prevYear = prevYearLabel(year);
      resultWrap.innerHTML = `<div class="empty-state">불러오는 중...</div>`;
      try {
        const parsed = await getParsedTab(spreadsheetId, branch);
        if (!parsed.years.includes(prevYear)) {
          resultWrap.innerHTML = `<div class="empty-state">${escapeHtml(prevYear || "작년")} 데이터가 시트에 없어서 비교할 수 없어요.</div>`;
          return;
        }
        const results = parsed.metricOrder.map(name => {
          const valA = aggregateMetric(parsed, name, prevYear, [month], "avg");
          const valB = aggregateMetric(parsed, name, year, [month], "avg");
          const diff = (valA !== null && valB !== null) ? valB - valA : null;
          const pct = (diff !== null && valA) ? (diff / Math.abs(valA)) * 100 : null;
          return [name, fmtMetricNum(valA), fmtMetricNum(valB), diff, pct];
        });
        resultWrap.innerHTML = `<p style="font-size:12.5px;color:var(--text-muted);margin:0 0 12px;"><strong>${escapeHtml(branch)}</strong> · ${escapeHtml(month)} 기준</p>` +
          renderDiffTable(["지표", `${escapeHtml(prevYear)}`, `${escapeHtml(year)}`, "증감", "증감율"], results);
      } catch (err) {
        resultWrap.innerHTML = `<div class="empty-state">비교 중 오류: ${escapeHtml(err.message)}</div>`;
      }
    };

    // ---------- 순위 계산 실행 (신호등 점수표 기준) ----------
    let rubricCache = null;
    document.getElementById("rankRunBtn").onclick = async () => {
      const resultWrap = document.getElementById("metricResultWrap");
      const year = document.getElementById("rankYear").value;
      const monthsSel = [...document.querySelectorAll(".rankMonthChk:checked")].map(el => el.value);
      const mode = document.querySelector('input[name="rankAggMode"]:checked').value;
      const selectedMetrics = [...document.querySelectorAll(".rankMetricChk:checked")].map(el => el.value);
      if (!monthsSel.length) { resultWrap.innerHTML = `<div class="empty-state">월을 최소 1개 선택해주세요.</div>`; return; }
      if (!selectedMetrics.length) { resultWrap.innerHTML = `<div class="empty-state">순위에 반영할 지표를 최소 1개 체크해주세요.</div>`; return; }

      resultWrap.innerHTML = `<div class="empty-state">계산 중...</div>`;
      try {
        if (!rubricCache) {
          const rubricRows = (sheetData && sheetData["신호등"]) || [];
          rubricCache = parseRubricSheet(rubricRows);
        }
        const parsedByBranch = {};
        const branches = tabNamesG.filter(t => t !== "셀프팀");
        await Promise.all(branches.map(async t => { parsedByBranch[t] = await getParsedTab(spreadsheetId, t); }));

        const scores = {};
        branches.forEach(b => { scores[b] = { total: 0, totalWeight: 0, detail: [] }; });

        selectedMetrics.forEach(m => {
          const weight = parseFloat(document.querySelector(`.rankMetricWeight[data-metric="${CSS.escape(m)}"]`).value) || 0;
          if (weight <= 0) return;
          const rubricLabel = RUBRIC_METRIC_MAP[m];
          const rubricEntry = rubricLabel ? rubricCache[rubricLabel] : null;
          branches.forEach(b => {
            const raw = aggregateMetric(parsedByBranch[b], m, year, monthsSel, mode);
            const thresholds = getThresholdsFor(rubricEntry, b);
            const grade = gradeForValue(thresholds, raw);
            if (grade === null) return; // 점수표 기준이 없거나 값이 없으면 이 지표는 이 지점 점수에서 제외
            const points = GRADE_POINTS[grade];
            scores[b].total += points * weight;
            scores[b].totalWeight += weight;
            scores[b].detail.push(`${m} ${grade}(${points}점)`);
          });
        });

        const ranked = branches.map(b => ({
          branch: b,
          score: scores[b].totalWeight ? (scores[b].total / scores[b].totalWeight) * 20 : null, // 5점 만점 -> 100점 만점
          detail: scores[b].detail
        })).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

        resultWrap.innerHTML = `<table><thead><tr><th>순위</th><th>지점</th><th>종합 점수</th><th>세부</th></tr></thead><tbody>
          ${ranked.map((r, i) => `<tr>
            <td class="mono" style="font-weight:800;">${i + 1}</td>
            <td style="font-weight:700;">${escapeHtml(r.branch)}</td>
            <td class="mono" style="font-weight:800;color:var(--blue-deep);">${r.score !== null ? r.score.toFixed(1) : "-"}</td>
            <td style="font-size:11.5px;color:var(--text-muted);">${r.detail.map(escapeHtml).join(" · ") || "채점 가능한 지표 없음"}</td>
          </tr>`).join("")}
        </tbody></table>
        <p style="font-size:11px;color:var(--text-muted);margin-top:10px;">"신호등" 탭의 점수표(S=5점·A=4점·B+=3점·B-=2점·C=1점·F=0점) 기준으로 채점한 뒤, 가중치를 곱해 평균내고 100점 만점으로 환산한 값이에요. "셀프팀"(본사 합계) 탭은 순위 비교에서 제외했어요.</p>`;
      } catch (err) {
        resultWrap.innerHTML = `<div class="empty-state">계산 중 오류: ${escapeHtml(err.message)}</div>`;
      }
    };

    // ---------- 이상치 탐지 실행 ----------
    document.getElementById("anomalyRunBtn").onclick = async () => {
      const resultWrap = document.getElementById("metricResultWrap");
      const branchSel = document.getElementById("anomalyBranch").value;
      const metricName = document.getElementById("anomalyMetric").value;
      const threshold = parseFloat(document.getElementById("anomalySensitivity").value);
      const targetBranches = branchSel === "__all__" ? tabNamesG : [branchSel];

      resultWrap.innerHTML = `<div class="empty-state">찾는 중...</div>`;
      try {
        const allFlags = [];
        for (const b of targetBranches) {
          const parsed = await getParsedTab(spreadsheetId, b);
          const timeline = buildTimeline(parsed, metricName);
          const vals = timeline.map(p => p.value).filter(v => v !== null);
          if (vals.length < 4) continue;
          const m = meanOf(vals);
          const sd = stddevOf(vals);
          if (!sd) continue;
          timeline.forEach(p => {
            if (p.value === null) return;
            const z = (p.value - m) / sd;
            if (Math.abs(z) >= threshold) allFlags.push({ branch: b, label: p.label, value: p.value, z, mean: m });
          });
        }
        if (!allFlags.length) { resultWrap.innerHTML = `<div class="empty-state">선택한 기준으로는 눈에 띄는 이상치가 없어요.</div>`; return; }
        allFlags.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
        resultWrap.innerHTML = `<table><thead><tr><th>지점</th><th>시점</th><th>값</th><th>평균</th><th>편차</th></tr></thead><tbody>
          ${allFlags.map(f => {
            const tone = f.z > 0 ? "#E03C3C" : "#2979FF";
            return `<tr>
              <td style="font-weight:700;">${escapeHtml(f.branch)}</td>
              <td>${escapeHtml(f.label)}</td>
              <td class="mono" style="font-weight:700;color:${tone};">${fmtMetricNum(f.value)}</td>
              <td class="mono" style="color:var(--text-muted);">${fmtMetricNum(f.mean)}</td>
              <td class="mono" style="font-weight:700;color:${tone};">${f.z > 0 ? "+" : ""}${f.z.toFixed(2)}σ</td>
            </tr>`;
          }).join("")}
        </tbody></table>
        <p style="font-size:11px;color:var(--text-muted);margin-top:10px;">편차(σ)는 그 지표의 전체 기간 평균에서 표준편차 몇 배만큼 벗어났는지를 뜻해요. 파란색은 평균보다 높게, 빨간색은 낮게 튄 경우예요.</p>`;
      } catch (err) {
        resultWrap.innerHTML = `<div class="empty-state">탐지 중 오류: ${escapeHtml(err.message)}</div>`;
      }
    };
  }

  function renderDiffTable(headers, rows) {
    return `<table><thead><tr>${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>
      ${rows.map(r => {
        const [name, valAtext, valBtext, diff, pct] = r;
        const up = diff !== null && diff > 0, down = diff !== null && diff < 0;
        const arrow = up ? "▲" : down ? "▼" : "-";
        const tone = up ? "#E03C3C" : down ? "#2979FF" : "var(--text-muted)";
        return `<tr>
          <td style="font-weight:700;">${escapeHtml(name)}</td>
          <td>${valAtext}</td>
          <td>${valBtext}</td>
          <td class="mono" style="color:${tone};font-weight:700;">${diff !== null ? `${arrow} ${fmtMetricNum(Math.abs(diff))}` : "-"}</td>
          <td class="mono" style="color:${tone};font-weight:700;">${pct !== null ? `${arrow} ${Math.abs(pct).toFixed(1)}%` : "-"}</td>
        </tr>`;
      }).join("")}
    </tbody></table>`;
  }

  if (!sheetData) {
    const wrap = document.getElementById("metricResultWrap");
    if (wrap) wrap.innerHTML = isLeader ? "" : `<div class="empty-state">아직 팀장이 연결한 파일이 없습니다.</div>`;
    return;
  }

  const allTabNames = Object.keys(sheetData);
  // 지표 형식(A열=지표명, B열=연도)이 아닌 탭(예: 코드/참고용 시트)은 지점 목록에서 자동으로 빼드려요.
  const tabNames = [];
  let firstParsed = null;
  allTabNames.forEach(t => {
    const parsed = getParsedTab(null, t);
    if (parsed.years.some(y => /^\d{4}년$/.test(y)) && parsed.metricOrder.length) {
      tabNames.push(t);
      if (!firstParsed) firstParsed = parsed;
    }
  });
  if (!firstParsed) {
    document.getElementById("metricResultWrap").innerHTML = `<div class="empty-state">지표 형식(A열=지표명, B열=연도)에 맞는 탭을 찾지 못했어요. 파일 형식을 확인해주세요.</div>`;
    return;
  }
  await initAllViews(tabNames, firstParsed, null);
}

async function renderOkrFolder(section) {
  const main = document.getElementById("mainContent");
  const thisYear = new Date().getFullYear();
  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}</h1>
        <p>${section.desc}</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <select id="okrYearSelect" style="width:auto;padding:8px 10px;border:1.5px solid var(--border);border-radius:10px;font-family:var(--font-display);font-weight:700;"></select>
        ${canWriteSection(section) ? `<button class="btn small" id="addBtn">+ 새 OKR 등록</button>` : ""}
      </div>
    </div>
    <div class="card" style="overflow-x:auto;"><div id="okrGridWrap">불러오는 중...</div></div>`;

  if (canWriteSection(section)) {
    document.getElementById("addBtn").onclick = () => openOkrModal(section, null);
  }

  const docs = await fetchDocs(section);

  const docYears = docs.map(d => extractSeasonYear(d.season)).filter(Boolean);
  const years = [...new Set([thisYear - 1, thisYear, thisYear + 1, thisYear + 2, ...docYears])].sort((a, b) => b - a);
  const yearSelect = document.getElementById("okrYearSelect");
  yearSelect.innerHTML = years.map(y => `<option value="${y}" ${y === thisYear ? "selected" : ""}>${y}년</option>`).join("");
  yearSelect.onchange = () => renderOkrGridBody(section, docs, parseInt(yearSelect.value, 10));

  renderOkrGridBody(section, docs, thisYear);
}

function renderOkrGridBody(section, docs, year) {
  const wrap = document.getElementById("okrGridWrap");
  // 봄(연분홍) · 여름(하늘빛) · 가을(살구빛) · 겨울(차가운 회청빛) 느낌으로 시즌 배경색을 구분합니다.
  const SEASON_BG = ["#FCEEF3", "#E5F6FA", "#FBF0DE", "#EAEEF4"];
  const colStyle = (idx) => `background:${SEASON_BG[idx % SEASON_BG.length]};border-left:2px solid var(--border);`;

  const columns = SEASON_DEFS.map(sd => {
    const label = seasonLabel(year, sd);
    const matches = docs.filter(d => d.season === label).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return { label, sd, doc: matches[0] || null };
  });

  let html = `<table style="min-width:1200px;width:100%;border-collapse:collapse;table-layout:fixed;">
    <colgroup><col style="width:100px;">${columns.map(() => `<col>`).join("")}</colgroup>
    <thead><tr>
    <th style="border-right:2px solid var(--border);padding-left:6px;padding-right:6px;">구분</th>
    ${columns.map((c, idx) => `<th style="${colStyle(idx)}word-break:break-word;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-size:20px;font-weight:800;color:var(--text-main);text-transform:none;letter-spacing:normal;">${c.sd.label}</span>
        ${c.doc
          ? (canEditDoc(section, c.doc) ? `<span style="white-space:nowrap;"><button class="icon-btn" data-edit-okr="${c.doc.id}">수정</button><button class="icon-btn danger" data-del-okr="${c.doc.id}">삭제</button></span>` : "")
          : (canWriteSection(section) ? `<button class="icon-btn" data-new-okr="${escapeHtml(c.label)}">+ 등록</button>` : "")}
      </div>
    </th>`).join("")}
  </tr></thead><tbody>
    <tr><td style="font-weight:700;border-right:2px solid var(--border);padding:10px 6px;word-break:keep-all;font-size:16px;">Objective</td>
      ${columns.map((c, idx) => `<td style="${colStyle(idx)}word-break:break-word;font-size:16px;line-height:1.5;">${c.doc && !richTextIsEmpty(c.doc.objective) ? c.doc.objective : `<span style="color:var(--text-muted);">-</span>`}</td>`).join("")}
    </tr>
    ${[0, 1, 2].map(i => `<tr><td style="font-weight:700;vertical-align:top;border-right:2px solid var(--border);padding:10px 6px;word-break:keep-all;font-size:16px;">KR${i + 1}</td>
      ${columns.map((c, idx) => {
        const kr = c.doc && (c.doc.krs || [])[i];
        if (!kr || !kr.title) return `<td style="${colStyle(idx)}word-break:break-word;"><span style="color:var(--text-muted);">-</span></td>`;
        const ach = krAchievement(kr);
        const kts = normalizeKts(kr.kts).filter(kt => !richTextIsEmpty(kt.text));
        return `<td style="${colStyle(idx)}word-break:break-word;">
          <div style="font-size:17px;font-weight:700;margin-bottom:6px;line-height:1.4;">${escapeHtml(kr.title)}</div>
          <div style="background:#FFFFFFAA;border-radius:6px;height:8px;margin:6px 0;overflow:hidden;"><div style="background:var(--green-bright);height:100%;width:${ach}%;"></div></div>
          <div class="mono" style="font-size:16px;color:var(--green-deep);font-weight:700;">${ach}%</div>
          ${kts.length ? `<ul style="margin:6px 0 0 18px;font-size:15px;line-height:1.6;">${kts.map(kt => `<li>${kt.text} <span class="mono" style="color:var(--text-muted);">(${kt.score || 0}점)</span></li>`).join("")}</ul>` : ""}
        </td>`;
      }).join("")}
    </tr>`).join("")}
    <tr><td style="font-weight:700;border-right:2px solid var(--border);padding:10px 6px;word-break:keep-all;font-size:16px;">종합 달성율</td>
      ${columns.map((c, idx) => `<td class="mono" style="font-weight:800;color:var(--blue-deep);font-size:17px;${colStyle(idx)}">${c.doc ? overallAchievement(c.doc.krs || []) + "%" : "-"}</td>`).join("")}
    </tr>
  </tbody></table>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll("[data-edit-okr]").forEach(btn => {
    btn.onclick = () => openOkrModal(section, docs.find(d => d.id === btn.dataset.editOkr));
  });
  wrap.querySelectorAll("[data-del-okr]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("정말 삭제하시겠습니까?")) return;
      await deleteDoc(doc(db, "folderEntries", btn.dataset.delOkr));
      showToast("삭제되었습니다.");
      renderSection(section.key);
    };
  });
  wrap.querySelectorAll("[data-new-okr]").forEach(btn => {
    btn.onclick = () => openOkrModal(section, null, btn.dataset.newOkr);
  });
}

function krBlockHtml(i, kr) {
  const k = kr || { title: "", kts: [] };
  const kts = normalizeKts(k.kts);
  return `<div class="card" style="background:#FBFEFA;margin-bottom:12px;padding:16px;">
    <h2 style="font-size:14px;margin:0 0 12px;">Key Result ${i + 1}</h2>
    <div class="field"><label>KR${i + 1} 내용 (정량적 목표)</label><input type="text" id="krTitle_${i}" value="${escapeHtml(k.title || "")}"></div>
    <div class="field"><label>Key Task (최대 3개)</label>
      <p style="font-size:11px;color:var(--text-muted);margin:0 0 8px;">KT마다 1~5점으로 점수를 매기면, 평균을 100점 만점으로 환산해서 이 KR의 달성율이 자동 계산돼요. 도구모음으로 글자 굵기·색·크기도 바꿀 수 있어요.</p>
      ${[0, 1, 2].map(j => `<div style="display:flex;gap:8px;margin-bottom:12px;align-items:flex-start;">
        <div style="flex:1;">
          ${richtextToolbarHtml(`kt_${i}_${j}`)}
          <div class="richtext-edit has-toolbar kt-edit" id="kt_${i}_${j}" contenteditable="true">${sanitizeRichHtml(kts[j] ? kts[j].text || "" : "")}</div>
        </div>
        <select id="ktScore_${i}_${j}" style="width:90px;">
          <option value="">점수</option>
          ${[1, 2, 3, 4, 5].map(v => `<option value="${v}" ${kts[j] && Number(kts[j].score) === v ? "selected" : ""}>${v}점</option>`).join("")}
        </select>
      </div>`).join("")}
    </div>
    <p style="font-size:12px;color:var(--text-muted);margin:0;">이 KR 예상 달성율: <span id="krAchPreview_${i}" class="mono" style="font-weight:700;">${krAchievement(k)}%</span></p>
  </div>`;
}

function openOkrModal(section, existing, prefillSeason) {
  const root = document.getElementById("modalRoot");
  const seasons = seasonOptions();
  const krs = (existing && existing.krs) || [{}, {}, {}];
  const needsBranch = section.visibility === "branch";
  const selectedSeason = (existing && existing.season) || prefillSeason || "";
  const seasonOpts = seasons.includes(selectedSeason) || !selectedSeason ? seasons : [selectedSeason, ...seasons];

  root.innerHTML = `<div class="modal-bg" id="modalBg">
    <div class="modal" style="max-width:560px;">
      <h3>${existing ? "수정" : "새 OKR 등록"} · ${section.label}</h3>
      <form id="okrForm">
        <div class="field"><label>시즌</label>
          <select id="okrSeason">${seasonOpts.map(s => `<option value="${s}" ${selectedSeason === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        </div>
        ${needsBranch ? `<div class="field"><label>지점</label>${fieldInput({ key: "branchId", type: "branchSelect" }, existing ? existing.branchId : "")}</div>` : ""}
        <div class="field"><label>Objective (목적 · 정성적 서술)</label>
          ${richtextToolbarHtml("okrObjective")}
          <div class="richtext-edit has-toolbar" id="okrObjective" contenteditable="true" style="min-height:70px;">${sanitizeRichHtml((existing && existing.objective) || "")}</div>
        </div>
        ${[0, 1, 2].map(i => krBlockHtml(i, krs[i])).join("")}
        <div class="grid-2" style="margin-top:10px;">
          <button type="button" class="btn secondary" id="cancelBtn">취소</button>
          <button type="submit" class="btn" id="saveBtn">저장</button>
        </div>
      </form>
    </div></div>`;

  document.getElementById("cancelBtn").onclick = () => root.innerHTML = "";
  document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") root.innerHTML = ""; });

  // Objective와 KT는 여러 줄 입력칸이라 엔터를 누르면 그냥 줄바꿈이 되게 두고,
  // 한 줄짜리 칸(시즌/지점/KR 제목/KT 점수)에서만 엔터로 다음 칸으로 넘어가게 합니다.
  const enterOrder = ["okrSeason"];
  if (needsBranch) enterOrder.push("f_branchId");
  [0, 1, 2].forEach(i => {
    enterOrder.push(`krTitle_${i}`);
    [0, 1, 2].forEach(j => { enterOrder.push(`ktScore_${i}_${j}`); });
  });
  enterOrder.forEach((id, idx) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const nextEl = document.getElementById(enterOrder[idx + 1]);
      if (nextEl) { nextEl.focus(); if (nextEl.select) nextEl.select(); }
      else { document.getElementById("saveBtn").click(); }
    });
  });

  // KT 텍스트/점수를 바꿀 때마다 예상 달성율을 바로 다시 계산해서 보여줍니다.
  [0, 1, 2].forEach(i => {
    const updatePreview = () => {
      const kr = {
        kts: [0, 1, 2].map(j => ({
          text: document.getElementById(`kt_${i}_${j}`).innerHTML,
          score: document.getElementById(`ktScore_${i}_${j}`).value
        }))
      };
      const el = document.getElementById(`krAchPreview_${i}`);
      if (el) el.textContent = krAchievement(kr) + "%";
    };
    [0, 1, 2].forEach(j => {
      document.getElementById(`kt_${i}_${j}`).addEventListener("input", updatePreview);
      document.getElementById(`ktScore_${i}_${j}`).addEventListener("change", updatePreview);
    });
  });

  // Objective와 KT 입력칸의 글자 굵기·색·크기 도구모음을 연결합니다.
  wireRichtextToolbarFor(document.getElementById("okrObjective"), document.querySelector('.rt-toolbar[data-for="okrObjective"]'));
  [0, 1, 2].forEach(i => {
    [0, 1, 2].forEach(j => {
      wireRichtextToolbarFor(document.getElementById(`kt_${i}_${j}`), document.querySelector(`.rt-toolbar[data-for="kt_${i}_${j}"]`));
    });
  });

  document.getElementById("okrForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("saveBtn");
    saveBtn.disabled = true;
    saveBtn.textContent = "저장 중...";
    try {
      const season = document.getElementById("okrSeason").value;
      const objective = sanitizeRichHtml(document.getElementById("okrObjective").innerHTML);
      const krsData = [0, 1, 2].map(i => ({
        title: document.getElementById(`krTitle_${i}`).value.trim(),
        kts: [0, 1, 2].map(j => ({
          text: sanitizeRichHtml(document.getElementById(`kt_${i}_${j}`).innerHTML),
          score: parseInt(document.getElementById(`ktScore_${i}_${j}`).value, 10) || 0
        }))
      }));
      const data = {
        folderId: section.folderId, season, objective, krs: krsData,
        updatedAt: new Date().toISOString(), updatedBy: state.profile.name
      };
      if (needsBranch) {
        const branchEl = document.getElementById("f_branchId");
        const branchId = branchEl ? branchEl.value : "";
        data.branchId = branchId;
        if (state.profile.role !== "leader") {
          data.branchName = state.profile.branchName;
        } else {
          const b = state.branches.find(x => x.id === branchId);
          data.branchName = b ? b.name : "";
        }
      }
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

/* ===================== 등록/수정 모달 ===================== */
function richtextToolbarHtml(key) {
  const colors = ["#22301A", "#E03C3C", "#2979FF", "#00C853", "#F5A623", "#8E1E5C"];
  return `<div class="rt-toolbar" data-for="${key}">
    <button type="button" class="rt-btn" data-cmd="bold" title="굵게"><b>B</b></button>
    <span class="rt-sep"></span>
    <button type="button" class="rt-btn rt-size" data-size="rt-small" title="작게">S</button>
    <button type="button" class="rt-btn rt-size" data-size="" title="보통">M</button>
    <button type="button" class="rt-btn rt-size" data-size="rt-large" title="크게">L</button>
    <span class="rt-sep"></span>
    ${colors.map(c => `<button type="button" class="rt-btn rt-color" data-color="${c}" style="background:${c};" title="글자색"></button>`).join("")}
    <span class="rt-sep"></span>
    <button type="button" class="rt-btn" data-cmd="removeFormat" title="서식 지우기" style="width:auto;padding:0 8px;font-size:11px;">지우기</button>
  </div>`;
}
function wrapSelectionWithClass(editEl, className) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!editEl.contains(range.commonAncestorContainer)) return;
  const span = document.createElement("span");
  if (className) span.className = className;
  const finish = () => {
    // 이미 크기가 지정된 글자를 다시 선택해서 새 크기를 적용하면, 안쪽에 예전 크기 클래스가 그대로 남아있어서
    // 화면엔 예전 크기가 계속 이겨버리는 문제가 있었어요. 새로 감싼 범위 안의 예전 크기 지정은 지워줍니다.
    span.querySelectorAll(".rt-small, .rt-large").forEach(el => { el.classList.remove("rt-small", "rt-large"); });
  };
  try {
    range.surroundContents(span);
    finish();
  } catch (err) {
    try {
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
      finish();
    } catch (err2) { /* 선택 영역이 복잡하면 그냥 포기합니다 */ }
  }
}
function wrapSelectionWithStyle(editEl, styleText) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!editEl.contains(range.commonAncestorContainer)) return;
  const span = document.createElement("span");
  span.setAttribute("style", styleText);
  const propName = styleText.split(":")[0].trim();
  const finish = () => {
    // 이미 색이나 굵기가 지정된 글자를 다시 선택해서 새로 적용하면, 안쪽에 예전 지정이 남아있어서
    // 화면엔 예전 값이 계속 이겨버리는 문제가 있었어요. 새로 감싼 범위 안의 같은 속성은 지워줍니다.
    span.querySelectorAll("[style]").forEach(el => {
      el.style.removeProperty(propName);
      if (!el.getAttribute("style").trim()) el.removeAttribute("style");
    });
  };
  try {
    range.surroundContents(span);
    finish();
  } catch (err) {
    try {
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
      finish();
    } catch (err2) { /* 선택 영역이 복잡하면 그냥 포기합니다 */ }
  }
}
function clearSelectionFormatting(editEl) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  if (!editEl.contains(range.commonAncestorContainer)) return;
  const text = range.toString();
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
}
// 폼이 그려진 뒤, richtext 필드마다 도구모음 버튼에 실제 동작을 연결합니다.
function positionToolbarFloating(toolbar, rect) {
  if (!toolbar.dataset.staticTop) {
    // 원래 자리(에디터 바로 위)로 되돌릴 수 있도록 처음 한 번만 기억해둡니다.
    toolbar.dataset.staticTop = "1";
  }
  const top = Math.max(8, rect.top - toolbar.offsetHeight - 8);
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - toolbar.offsetWidth / 2),
    window.innerWidth - toolbar.offsetWidth - 8
  );
  toolbar.style.position = "fixed";
  toolbar.style.top = top + "px";
  toolbar.style.left = left + "px";
  toolbar.style.zIndex = "200";
  toolbar.classList.add("rt-toolbar-floating");
}
function resetToolbarPosition(toolbar) {
  toolbar.style.position = "";
  toolbar.style.top = "";
  toolbar.style.left = "";
  toolbar.style.zIndex = "";
  toolbar.classList.remove("rt-toolbar-floating");
}
function wireRichtextToolbarFor(editEl, toolbar) {
  if (!editEl || !toolbar) return;
  let savedRange = null;
  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editEl.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  };
  // 글자를 드래그해서 선택하면, 도구모음이 선택 영역 바로 위로 떠서 따라옵니다 (스크롤해서 위로 안 올라가도 돼요).
  const updateFloatingToolbar = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed && editEl.contains(sel.anchorNode) && editEl.contains(sel.focusNode)) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) { positionToolbarFloating(toolbar, rect); return; }
    }
    resetToolbarPosition(toolbar);
  };
  editEl.addEventListener("keyup", () => { saveSelection(); updateFloatingToolbar(); });
  editEl.addEventListener("mouseup", () => { saveSelection(); updateFloatingToolbar(); });
  document.addEventListener("mousedown", (e) => {
    if (e.target !== editEl && !editEl.contains(e.target) && e.target !== toolbar && !toolbar.contains(e.target)) {
      resetToolbarPosition(toolbar);
    }
  });
  toolbar.querySelectorAll(".rt-btn").forEach(btn => {
    // mousedown에서 기본 동작을 막아야 버튼을 눌러도 에디터의 선택 영역이 풀리지 않습니다.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      editEl.focus();
      if (savedRange) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
      // 브라우저마다 다르게 동작하고(예: <font> 태그) 저장 시 사라져버리는 execCommand 대신,
      // 항상 style 속성이 붙은 <span>으로 직접 감싸서 어디서나 똑같이 저장·표시되게 합니다.
      if (btn.dataset.cmd === "bold") {
        wrapSelectionWithStyle(editEl, "font-weight:700");
      } else if (btn.dataset.cmd === "removeFormat") {
        clearSelectionFormatting(editEl);
      } else if (btn.dataset.color) {
        wrapSelectionWithStyle(editEl, `color:${btn.dataset.color}`);
      } else if (btn.classList.contains("rt-size")) {
        wrapSelectionWithClass(editEl, btn.dataset.size);
      }
      saveSelection();
      resetToolbarPosition(toolbar);
    });
  });
}
function wireRichtextToolbars(formFields) {
  formFields.filter(f => f.type === "richtext").forEach(f => {
    wireRichtextToolbarFor(document.getElementById(`f_${f.key}`), document.querySelector(`.rt-toolbar[data-for="${f.key}"]`));
  });
}
function richTextIsEmpty(html) {
  return !String(html || "").replace(/<[^>]*>/g, "").trim();
}
const RICHTEXT_ALLOWED_TAGS = new Set([
  "P","BR","STRONG","B","EM","I","U","UL","OL","LI","TABLE","THEAD","TBODY","TR","TD","TH",
  "SPAN","DIV","A","H1","H2","H3","H4","BLOCKQUOTE","CODE","PRE","HR"
]);
const RICHTEXT_ALLOWED_ATTRS = new Set(["style","href","target","colspan","rowspan","class"]);
const RICHTEXT_ALLOWED_CLASSES = new Set(["rt-small","rt-large"]);

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
          if (name === "class") {
            // 굵기/색/글자크기 도구모음에서 쓰는 클래스만 허용하고, 그 외 붙여넣기로 딸려온 class는 다 지웁니다.
            const kept = attr.value.split(/\s+/).filter(c => RICHTEXT_ALLOWED_CLASSES.has(c));
            if (kept.length) child.setAttribute("class", kept.join(" ")); else child.removeAttribute("class");
          }
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

function openModal(section, existing, prefill) {
  const root = document.getElementById("modalRoot");
  const imageState = {}; // key -> { urls: [...기존 URL], files: [새로 추가한 File] }

  // "팀장은 전체 / 팀원은 자기 지점만 열람"으로 설정된 메뉴인데 원래 지점 필드가 없다면(팀 회의 일지, 공지사항, 사용자 정의 폴더 등)
  // 등록/수정 폼에 지점 선택 필드를 자동으로 추가합니다.
  const needsBranchField = section.visibility === "branch" && !section.fields.some(f => f.type === "branchSelect");
  const formFields = needsBranchField
    ? [{ key: "branchId", label: "지점", type: "branchSelect" }, ...section.fields]
    : section.fields;

  const fieldsHtml = formFields.map(f => {
    if (f.type === "imageUpload") {
      imageState[f.key] = { urls: [...((existing && existing[f.key]) || [])], files: [] };
      return `<div class="field">
        <label>${f.label}</label>
        <div class="image-thumbs" id="imgthumbs_${f.key}"></div>
        <input type="file" id="imginput_${f.key}" accept="image/*,.pdf,.ppt,.pptx,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation" multiple>
        <p style="font-size:12px;color:var(--text-muted);margin-top:4px;">이미지, PDF, PPT 파일을 여러 개 한 번에 올릴 수 있어요.</p>
      </div>`;
    }
    if (f.type === "richtext") {
      const initial = sanitizeRichHtml(existing ? existing[f.key] : "");
      const heightStyle = f.tall ? "min-height:480px;" : "";
      return `<div class="field">
        <label>${f.label}</label>
        ${richtextToolbarHtml(f.key)}
        <div class="richtext-edit has-toolbar" id="f_${f.key}" contenteditable="true" style="${heightStyle}">${initial}</div>
        <p style="font-size:11px;color:var(--text-muted);margin-top:4px;">위 도구모음으로 글자 굵기·색·크기를 바꿀 수 있고, Tiro 등에서 복사한 내용을 표까지 그대로 붙여넣기(Ctrl+V) 하실 수 있어요.</p>
      </div>`;
    }
    const currentVal = existing ? existing[f.key] : (prefill && prefill[f.key] !== undefined ? prefill[f.key] : "");
    return `<div class="field"><label>${f.label}</label>${fieldInput(f, currentVal)}</div>`;
  }).join("");

  root.innerHTML = `<div class="modal-bg" id="modalBg">
    <div class="modal" style="max-width:1440px;">
      <h3>${existing ? "수정" : "새로 등록"} · ${section.label}</h3>
      <form id="entryForm">${fieldsHtml}
        <div class="grid-2" style="margin-top:10px;">
          <button type="button" class="btn secondary" id="cancelBtn">취소</button>
          <button type="submit" class="btn" id="saveBtn">저장</button>
        </div>
      </form>
    </div></div>`;

  let savedOnce = false;
  document.getElementById("cancelBtn").onclick = () => { root.innerHTML = ""; if (savedOnce) renderSection(section.key); };
  document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") { root.innerHTML = ""; if (savedOnce) renderSection(section.key); } });

  function renderThumbs(key) {
    const wrap = document.getElementById(`imgthumbs_${key}`);
    if (!wrap) return;
    const st = imageState[key];
    const items = [
      ...st.urls.map((url, i) => ({ type: "url", src: url, i, isImage: isImageFile(url), name: fileNameFromUrl(url) })),
      ...st.files.map((file, i) => ({ type: "file", src: URL.createObjectURL(file), i, isImage: file.type.startsWith("image/"), name: file.name }))
    ];
    wrap.innerHTML = items.length
      ? items.map(it => `<div class="thumb-item">${it.isImage
          ? `<img src="${it.src}">`
          : `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:#F4FAEF;border-radius:8px;border:1px solid var(--border);overflow:hidden;padding:2px;"><span style="font-size:20px;">${fileIconFor(it.name)}</span><span style="font-size:8px;color:var(--text-muted);text-align:center;word-break:break-all;line-height:1.1;">${escapeHtml((it.name || "").slice(0, 14))}</span></div>`
        }<button type="button" class="thumb-remove" data-type="${it.type}" data-i="${it.i}">×</button></div>`).join("")
      : `<p style="font-size:12px;color:var(--text-muted);">등록된 파일이 없습니다.</p>`;
    wrap.querySelectorAll(".thumb-remove").forEach(btn => {
      btn.onclick = () => {
        const i = parseInt(btn.dataset.i, 10);
        if (btn.dataset.type === "url") st.urls.splice(i, 1); else st.files.splice(i, 1);
        renderThumbs(key);
      };
    });
  }

  formFields.filter(f => f.type === "imageUpload").forEach(f => {
    renderThumbs(f.key);
    document.getElementById(`imginput_${f.key}`).addEventListener("change", (e) => {
      imageState[f.key].files.push(...Array.from(e.target.files));
      renderThumbs(f.key);
      e.target.value = "";
    });
  });

  wireRichtextToolbars(formFields);

  document.getElementById("entryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("saveBtn");
    saveBtn.disabled = true;
    saveBtn.textContent = "저장 중...";
    try {
      const data = {};
      for (const f of formFields) {
        if (f.type === "imageUpload") continue;
        const el = document.getElementById(`f_${f.key}`);
        if (f.type === "richtext") {
          data[f.key] = el ? sanitizeRichHtml(el.innerHTML) : "";
        } else {
          data[f.key] = el ? el.value : "";
        }
      }
      for (const f of formFields) {
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
        st.urls = data[f.key];
        st.files = [];
        renderThumbs(f.key);
      }
      if (formFields.some(f => f.type === "branchSelect")) {
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
        if (!existing) data.order = Date.now();
      }
      data.updatedAt = new Date().toISOString();
      data.updatedBy = state.profile.name;

      if (existing) {
        await updateDoc(doc(db, section.collectionName, existing.id), data);
        Object.assign(existing, data);
      } else {
        data.createdAt = new Date().toISOString();
        data.createdBy = state.profile.name;
        const newRef = await addDoc(collection(db, section.collectionName), data);
        existing = { id: newRef.id, ...data };
        const titleEl = root.querySelector(".modal h3");
        if (titleEl) titleEl.textContent = `수정 · ${section.label}`;
      }
      savedOnce = true;
      showToast("저장되었습니다.");
      saveBtn.disabled = false;
      saveBtn.textContent = "저장";
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
  const allBuiltInRaw = SECTIONS.map((s, i) => ({ ...s, order: s.order ?? i })).map(withOverride).map(s => ({ ...s, isCustom: false }));
  const allFolders = state.customFolders.map(f => ({ ...withOverride(folderToSection(f)), isCustom: true, folderDocId: f.id }));
  const hiddenBuiltIn = allBuiltInRaw.filter(s => s.hidden);
  const allItems = [...allBuiltInRaw.filter(s => !s.hidden), ...allFolders].sort((a, b) => {
    const gi = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    return gi !== 0 ? gi : (a.order ?? 0) - (b.order ?? 0);
  });

  wrap.innerHTML = `<table><thead><tr><th></th><th>메뉴 이름</th><th>그룹</th><th>색상</th><th></th></tr></thead><tbody>
    ${allItems.map((it, i) => {
      const prevSameGroup = i > 0 && allItems[i - 1].group === it.group;
      const nextSameGroup = i < allItems.length - 1 && allItems[i + 1].group === it.group;
      return `<tr>
      <td style="white-space:nowrap;">
        <button class="icon-btn" data-move="up" data-key="${it.key}" ${prevSameGroup ? "" : "disabled style='opacity:.3;'"}>▲</button>
        <button class="icon-btn" data-move="down" data-key="${it.key}" ${nextSameGroup ? "" : "disabled style='opacity:.3;'"}>▼</button>
      </td>
      <td>${escapeHtml(it.label)}</td>
      <td>${escapeHtml(it.group)}</td>
      <td><span class="dot" style="display:inline-block;background:${COLOR_HEX[it.color]};"></span></td>
      <td class="actions">
        <button class="icon-btn" data-edit-menu="${it.key}">수정</button>
        ${it.isCustom
          ? `<button class="icon-btn danger" data-del-folder="${it.folderDocId}">삭제</button>`
          : `<button class="icon-btn danger" data-hide-menu="${it.key}">삭제</button>`}
      </td>
    </tr>`;
    }).join("")}
  </tbody></table>
  ${hiddenBuiltIn.length ? `
  <div style="margin-top:22px;">
    <p style="font-size:12px;font-weight:700;color:var(--text-muted);margin:0 0 8px;">삭제(숨김)한 기본 메뉴</p>
    <table><tbody>
      ${hiddenBuiltIn.map(it => `<tr>
        <td>${escapeHtml(it.label)}</td>
        <td>${escapeHtml(it.group)}</td>
        <td class="actions"><button class="icon-btn" data-restore-menu="${it.key}">복원</button></td>
      </tr>`).join("")}
    </tbody></table>
  </div>` : ""}`;

  wrap.querySelectorAll("[data-move]").forEach(btn => {
    btn.onclick = () => moveMenuItem(allItems, btn.dataset.key, btn.dataset.move);
  });
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
  wrap.querySelectorAll("[data-hide-menu]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("이 메뉴를 목록에서 삭제할까요?\n등록된 데이터는 삭제되지 않고, 아래 '삭제(숨김)한 기본 메뉴' 목록에서 언제든 다시 복원할 수 있습니다.")) return;
      await setDoc(doc(db, "menuOverrides", btn.dataset.hideMenu), { hidden: true }, { merge: true });
      await loadMenuOverrides();
      showToast("삭제되었습니다.");
      buildNav();
      markActiveNav("admin");
      renderAdmin();
    };
  });
  wrap.querySelectorAll("[data-restore-menu]").forEach(btn => {
    btn.onclick = async () => {
      await setDoc(doc(db, "menuOverrides", btn.dataset.restoreMenu), { hidden: false }, { merge: true });
      await loadMenuOverrides();
      showToast("복원되었습니다.");
      buildNav();
      markActiveNav("admin");
      renderAdmin();
    };
  });
}

async function persistItemOrder(item, newOrder) {
  if (item.isCustom) {
    await updateDoc(doc(db, "customFolders", item.folderDocId), { order: newOrder });
  } else {
    await setDoc(doc(db, "menuOverrides", item.key), { label: item.label, group: item.group, color: item.color, order: newOrder }, { merge: true });
  }
}

async function moveMenuItem(allItems, key, direction) {
  const index = allItems.findIndex(it => it.key === key);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= allItems.length) return;
  if (allItems[swapWith].group !== allItems[index].group) return;

  // 두 항목의 order 값을 그냥 맞바꾸면, 새로 만든 폴더처럼 여러 항목이 같은 기본값(1000)을
  // 가지고 있을 때 값을 바꿔도 여전히 똑같아서 아무 변화가 없어 보일 수 있습니다.
  // 그래서 같은 그룹 안의 모든 항목에 0,1,2...로 순서를 다시 매겨서 항상 확실히 반영되게 합니다.
  const reordered = [...allItems];
  [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
  const group = allItems[index].group;
  const groupItems = reordered.filter(it => it.group === group);

  await Promise.all(groupItems.map((it, i) => persistItemOrder(it, i)));
  await loadCustomFolders();
  await loadMenuOverrides();
  buildNav();
  markActiveNav("admin");
  renderAdmin();
}

function openMenuEditModal(item) {
  const root = document.getElementById("modalRoot");
  // 기본 제공 메뉴 중 작성/열람 권한을 조정할 수 있는 것은 팀 전체(team) 또는 지점별(branch) 데이터를 다루는 메뉴만.
  // (지점 성과 지표 / 지점 운영 자료 / 지점 인적 구성은 항상 팀장 전용으로 동작하는 별도 화면이라 대상에서 제외)
  const supportsPermission = item.isCustom || item.scope === "team" || item.scope === "branch";
  const isBranchScope = !item.isCustom && item.scope === "branch";
  const supportsBranchVisibility = item.isCustom || item.scope === "team";
  const currentWritable = item.writable || "leader";
  const currentVisibility = item.visibility || (item.leaderOnly ? "leader" : "all");

  const permissionHtml = supportsPermission ? `
        <div class="field"><label>작성 권한</label>
          <select id="menuEditWritable">
            <option value="leader" ${currentWritable === "leader" ? "selected" : ""}>팀장만 작성</option>
            ${isBranchScope ? `<option value="leader-and-branch" ${currentWritable === "leader-and-branch" ? "selected" : ""}>팀장은 전체 / 팀원은 자기 지점만 작성</option>` : ""}
            <option value="all" ${currentWritable === "all" ? "selected" : ""}>전원 작성 가능</option>
          </select>
        </div>
        <div class="field"><label>열람 권한</label>
          <select id="menuEditVisibility">
            <option value="all" ${currentVisibility === "all" ? "selected" : ""}>전체 열람 가능</option>
            ${supportsBranchVisibility ? `<option value="branch" ${currentVisibility === "branch" ? "selected" : ""}>팀장은 전체 / 팀원은 자기 지점만 열람</option>` : ""}
            <option value="leader" ${currentVisibility === "leader" ? "selected" : ""}>팀장만 열람 가능</option>
          </select>
          ${isBranchScope ? `<p style="font-size:11px;color:var(--text-muted);margin-top:4px;">이 메뉴는 원래부터 팀원에게는 자기 지점 데이터만 보여요. 여기서는 팀원에게 이 메뉴 자체를 아예 숨길지(팀장만 열람)만 정할 수 있습니다.</p>` : ""}
          ${supportsBranchVisibility ? `<p style="font-size:11px;color:var(--text-muted);margin-top:4px;">"팀원은 자기 지점만 열람"을 선택하면 등록/수정 화면에 지점 선택란이 자동으로 생겨요. 지점을 지정하지 않고 저장한 기존 글은 팀장에게만 보입니다.</p>` : ""}
        </div>` : `
        <p style="font-size:11px;color:var(--text-muted);margin:-4px 0 10px;">이 메뉴는 항상 팀장만 편집할 수 있는 전용 화면이라 작성/열람 권한 설정은 지원하지 않아요. 이름·그룹·색상 변경과 삭제(숨기기)만 가능합니다.</p>`;

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
        ${permissionHtml}
        ${item.isCustom ? `<div class="field"><label>양식 종류</label>
          <select id="menuEditTemplate">
            <option value="standard" ${item.template !== "okr" && item.template !== "metricAnalysis" && item.template !== "taskTracking" ? "selected" : ""}>일반 (제목 + 내용 + 이미지)</option>
            <option value="okr" ${item.template === "okr" ? "selected" : ""}>OKR (시즌 · Objective · KR · KT)</option>
            <option value="metricAnalysis" ${item.template === "metricAnalysis" ? "selected" : ""}>지표 분석 (연결된 구글 시트에서 두 시점 비교)</option>
            <option value="taskTracking" ${item.template === "taskTracking" ? "selected" : ""}>업무 트레킹 (지점별 지시 체크리스트 · 완료율 · 마감기한)</option>
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
    const writable = supportsPermission ? document.getElementById("menuEditWritable").value : undefined;
    const visibility = supportsPermission ? document.getElementById("menuEditVisibility").value : undefined;
    if (item.isCustom) {
      const template = document.getElementById("menuEditTemplate").value;
      await updateDoc(doc(db, "customFolders", item.folderDocId), { label, group, color, template, writable, visibility });
      await loadCustomFolders();
    } else {
      const payload = { label, group, color };
      if (supportsPermission) { payload.writable = writable; payload.visibility = visibility; }
      // merge:true로 저장해야 이름 수정 시 기존에 저장된 순서(order)·삭제(hidden) 상태가 지워지지 않습니다.
      await setDoc(doc(db, "menuOverrides", item.key), payload, { merge: true });
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
        <div class="field" style="margin:0;"><label>열람 권한</label>
          <select id="newFolderVisibility">
            <option value="all">전체 열람 가능</option>
            <option value="leader">팀장만 열람 가능</option>
          </select>
        </div>
        <div class="field" style="margin:0;"><label>양식 종류</label>
          <select id="newFolderTemplate">
            <option value="standard">일반 (제목 + 내용 + 이미지)</option>
            <option value="okr">OKR (시즌 · Objective · KR · KT)</option>
            <option value="metricAnalysis">지표 분석 (연결된 구글 시트에서 두 시점 비교)</option>
            <option value="taskTracking">업무 트레킹 (지점별 지시 체크리스트 · 완료율 · 마감기한)</option>
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
    await addDoc(collection(db, "branches"), { name, order: Date.now(), createdAt: new Date().toISOString() });
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
    branchWrap.innerHTML = `<table><thead><tr><th></th><th>지점명</th><th></th></tr></thead><tbody>
      ${state.branches.map((b, i) => `<tr>
        <td style="white-space:nowrap;">
          <button class="icon-btn" data-move="up" data-bid="${b.id}" ${i === 0 ? "disabled style='opacity:.3;'" : ""}>▲</button>
          <button class="icon-btn" data-move="down" data-bid="${b.id}" ${i === state.branches.length - 1 ? "disabled style='opacity:.3;'" : ""}>▼</button>
        </td>
        <td>${escapeHtml(b.name)}</td>
        <td class="actions"><button class="icon-btn danger" data-bid="${b.id}">삭제</button></td>
      </tr>`).join("")}
    </tbody></table>`;
    branchWrap.querySelectorAll("[data-move]").forEach(btn => {
      btn.onclick = () => moveBranch(btn.dataset.bid, btn.dataset.move);
    });
    branchWrap.querySelectorAll("button.icon-btn.danger[data-bid]").forEach(btn => {
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
    const visibility = document.getElementById("newFolderVisibility").value;
    const template = document.getElementById("newFolderTemplate").value;
    // 같은 그룹 안 항목들 중 가장 큰 order보다 1 큰 값을 줘서, 새 폴더가 기존 폴더와 순서값이
    // 겹치는 일 없이 항상 그룹 맨 끝에 확실히 놓이도록 합니다.
    const groupItems = [
      ...SECTIONS.map((s, i) => withOverride({ ...s, order: s.order ?? i })),
      ...state.customFolders.map(f => withOverride(folderToSection(f)))
    ].filter(s => s.group === group);
    const order = groupItems.length ? Math.max(...groupItems.map(s => s.order ?? 0)) + 1 : 0;
    await addDoc(collection(db, "customFolders"), { label, group, color, writable, visibility, template, order, createdAt: new Date().toISOString() });
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
