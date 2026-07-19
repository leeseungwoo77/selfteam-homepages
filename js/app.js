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
      { key:"agenda", label:"안건", type:"textarea" },
      { key:"decisions", label:"결정사항", type:"textarea" },
      { key:"followUp", label:"후속조치", type:"textarea" },
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
      { key:"followUp", label:"후속조치", type:"textarea" }
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
      { key:"followUp", label:"후속조치", type:"textarea" }
    ], columns:["date","branchName","memberName"] },

  { key:"performance", label:"지점 성과 지표", group:"성과·전략", color:"blue",
    desc:"손익계산서 · 인사평가 등 평가지표 시트를 그대로 보여줍니다.",
    isEvalSheet:true },

  { key:"notice", label:"팀 공지사항", group:"소통·협업", color:"magenta",
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
  "에듀본사": "#E03C3C", "상상": "#F5A623", "전능": "#3B9BE8", "전농": "#3B9BE8",
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
  if (explicitColor || explicitTextColor) {
    return { bg: explicitColor || null, color: explicitTextColor || (explicitColor ? "#fff" : "inherit") };
  }
  if (text) {
    for (const rule of SCHEDULE_KEYWORD_RULES) {
      if (text.includes(rule.word)) return { bg: rule.bg, color: rule.color };
    }
  }
  const bg = text ? matchLocationColor(text) : null;
  return { bg, color: bg ? "#fff" : "inherit" };
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
    <div class="card" style="overflow:auto;max-height:calc(100vh - 190px);"><div id="scheduleCalendar">불러오는 중...</div></div>`;

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

  const cellBase = "white-space:nowrap;min-width:80px;text-align:center;border-right:1px solid var(--border);";
  const leftLabelStyle = "position:sticky;left:0;background:#fff;z-index:1;white-space:nowrap;font-weight:700;padding:5px 10px;border-right:1px solid var(--border);";

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
          style="width:80px;box-sizing:border-box;border:none;background:transparent;color:inherit;font-weight:inherit;text-align:center;outline:none;padding:0;font-family:inherit;font-size:inherit;" size="1"></td>`;
    }
    return `<td style="${cellBase}${bgStyle}${extra}padding:5px 10px;border-radius:4px;">${escapeHtml(cell.text)}</td>`;
  }

  let html = `<table class="table-compact" style="width:max-content;"><thead>
    <tr>
      <th style="position:sticky;left:0;top:0;background:#F4FAEF;z-index:3;border-right:1px solid var(--border);">날짜</th>
      ${dates.map(d => {
        const wd = weekdayLabel(year, month, d);
        const wdColor = wd === "토" ? "var(--blue-deep)" : wd === "일" ? "var(--danger)" : "var(--text-main)";
        return `<th style="position:sticky;top:0;background:#F4FAEF;z-index:2;color:${wdColor};border-right:1px solid var(--border);">${month}.${pad2(d)}(${wd})</th>`;
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
    html += `<tr><td style="${leftLabelStyle}background:${rowColor};color:#fff;">${escapeHtml(rowLabel)}</td>`;
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

  let activeCellInput = null;

  if (canEdit) {
    document.querySelectorAll(".sched-cell").forEach(input => {
      input.addEventListener("focus", () => {
        activeCellInput = input;
        document.getElementById("activeCellHint").textContent = `${input.dataset.date} 칸 선택됨`;
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); return; }
        const arrowMap = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
        if (arrowMap[e.key]) {
          const target = findAdjacentCell(input, arrowMap[e.key]);
          if (target) { e.preventDefault(); target.focus(); target.select(); }
        }
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
  const allBuiltIn = SECTIONS
    .map((s, i) => ({ ...s, order: s.order ?? i }))
    .map(withOverride)
    .filter(s => !s.hidden)
    .filter(s => !s.leaderOnly || canViewAllRole());
  const allFolders = state.customFolders.map(f => withOverride(folderToSection(f))).filter(s => !s.leaderOnly || canViewAllRole());
  const allItems = [...allBuiltIn, ...allFolders];
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
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.key === key));
  document.querySelectorAll(".nav-subitem").forEach(el => el.classList.toggle("active", el.dataset.key === key && (el.dataset.branch || "") === branchId));
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
  if (section.isRosterGrid) { renderRosterGrid(section); return; }
  if (section.isMeetingGrid) { renderMeetingGrid(section); return; }
  if (section.cardView) { renderLogCards(section); return; }

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

/* ===================== 지점 x 미팅 그리드 (가로: 지점, 세로: 제목/주차별 미팅) ===================== */
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
  const branchesSorted = [...branches].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const wrap = document.getElementById("meetingGridWrap");
  if (!branchesSorted.length) { wrap.innerHTML = `<div class="empty-state">등록된 지점이 없습니다.</div>`; return; }

  // 세로축: title(예: "2026년 7월 2주차") 기준으로 한 줄. 같은 제목+지점에 여러 건이 있으면 최신 날짜만 표시.
  const rowMap = {};
  docs.forEach(d => {
    const key = d.title || "(제목 없음)";
    if (!rowMap[key]) rowMap[key] = { title: key, latestDate: d.date || "", cells: {} };
    if ((d.date || "") > rowMap[key].latestDate) rowMap[key].latestDate = d.date || "";
    const cur = rowMap[key].cells[d.branchId];
    if (!cur || (d.date || "") > (cur.date || "")) rowMap[key].cells[d.branchId] = d;
  });
  const rows = Object.values(rowMap).sort((a, b) => (b.latestDate || "").localeCompare(a.latestDate || ""));

  if (!rows.length) { wrap.innerHTML = `<div class="empty-state">등록된 미팅 기록이 없습니다.</div>`; return; }

  const stripHtml = (html) => (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const extraKey = (section.headerFields || []).find(k => !["title", "date", "branchName"].includes(k));

  let html = `<table class="table-compact"><thead><tr><th style="min-width:130px;">미팅</th>
    ${branchesSorted.map(b => `<th style="min-width:150px;">${escapeHtml(b.name)}</th>`).join("")}
  </tr></thead><tbody>`;

  rows.forEach((row, ri) => {
    html += `<tr><td style="font-weight:700;white-space:nowrap;">${escapeHtml(row.title)}</td>`;
    branchesSorted.forEach(b => {
      const cell = row.cells[b.id];
      if (cell) {
        const preview = stripHtml(cell.content);
        html += `<td style="cursor:pointer;" data-cell-row="${ri}" data-cell-branch="${b.id}">
          <div style="font-size:12px;color:var(--text-main);">${escapeHtml(preview.slice(0, 40))}${preview.length > 40 ? "…" : (preview ? "" : "(내용 없음)")}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${escapeHtml(cell.date || "")}${extraKey && cell[extraKey] ? " · " + escapeHtml(cell[extraKey]) : ""}</div>
        </td>`;
      } else if (canCreateForBranch(section, b.id)) {
        html += `<td style="cursor:pointer;text-align:center;color:var(--text-muted);" data-cell-new-row="${ri}" data-cell-new-branch="${b.id}">+</td>`;
      } else {
        html += `<td style="text-align:center;color:var(--text-muted);">-</td>`;
      }
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll("[data-cell-row]").forEach(td => {
    td.onclick = () => {
      const row = rows[parseInt(td.dataset.cellRow, 10)];
      openMeetingDetailModal(section, row.cells[td.dataset.cellBranch]);
    };
  });
  wrap.querySelectorAll("[data-cell-new-row]").forEach(td => {
    td.onclick = () => {
      const row = rows[parseInt(td.dataset.cellNewRow, 10)];
      openModal(section, null, { title: row.title, branchId: td.dataset.cellNewBranch });
    };
  });
}

function openMeetingDetailModal(section, entry) {
  const root = document.getElementById("modalRoot");
  const canEdit = canEditDoc(section, entry);
  const fieldRows = section.fields
    .filter(f => f.type !== "branchSelect" && f.key !== "title" && f.key !== "date")
    .map(f => {
      const val = entry[f.key];
      if (!val) return "";
      const display = f.type === "richtext" ? sanitizeRichHtml(val) : escapeHtml(val).replace(/\n/g, "<br>");
      return `<div style="margin-bottom:12px;"><div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:4px;">${f.label}</div><div class="rich-content">${display}</div></div>`;
    }).join("");

  root.innerHTML = `<div class="modal-bg" id="modalBg">
    <div class="modal">
      <h3>${escapeHtml(entry.title || "")}${entry.branchName ? " · " + escapeHtml(entry.branchName) : ""}</h3>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px;">${escapeHtml(entry.date || "")}</div>
      ${fieldRows || `<p style="color:var(--text-muted);font-size:13px;">등록된 내용이 없습니다.</p>`}
      <div class="grid-2" style="margin-top:10px;">
        <button type="button" class="btn secondary" id="closeDetailBtn">닫기</button>
        ${canEdit ? `<button type="button" class="btn" id="editFromDetailBtn">수정</button>` : ""}
      </div>
      ${canEdit ? `<button type="button" class="icon-btn danger" id="deleteFromDetailBtn" style="margin-top:10px;width:100%;text-align:center;">삭제</button>` : ""}
    </div></div>`;

  document.getElementById("closeDetailBtn").onclick = () => root.innerHTML = "";
  document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") root.innerHTML = ""; });
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
  try {
    const plDoc = await getDoc(doc(db, "siteLinks", "plStatement"));
    if (plDoc.exists()) plUrl = plDoc.data().url || "";
  } catch (err) { /* 무시 */ }

  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}</h1>
        <p>${section.desc}</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        ${plUrl
          ? `<a href="${escapeHtml(plUrl)}" target="_blank" rel="noopener" class="btn small secondary" style="text-decoration:none;display:inline-flex;align-items:center;">손익계산서</a>${state.profile.role === "leader" ? `<button class="icon-btn" id="editPlLinkBtn" type="button">수정</button>` : ""}`
          : (state.profile.role === "leader" ? `<button class="btn small secondary" id="editPlLinkBtn" type="button">+ 손익계산서 링크 설정</button>` : "")}
        ${state.profile.role === "leader" ? `<a href="https://docs.google.com/spreadsheets/d/${EVAL_SPREADSHEET_ID}/edit" target="_blank" rel="noopener" class="btn small secondary" style="text-decoration:none;display:inline-flex;align-items:center;">원본 시트 열기</a>` : ""}
        <button class="btn small" id="googleAuthBtn" type="button">${googleAccessToken ? "다시 연결" : "구글 계정으로 연결"}</button>
        <select id="evalYearSelect" style="padding:8px 12px;border-radius:8px;border:1.5px solid var(--border);font-family:var(--font-display);font-weight:700;"></select>
      </div>
    </div>
    ${state.profile.role === "leader" ? `
    <div class="card" id="evalSheetAdminCard">
      <h2>연도 탭 등록/관리</h2>
      <form id="evalSheetAddForm" class="grid-3" style="align-items:end;">
        <div class="field" style="margin:0;"><label>표시 이름 (예: 2026년)</label><input type="text" id="newEvalLabel" required></div>
        <div class="field" style="margin:0;"><label>구글 시트 탭 이름</label><input type="text" id="newEvalTab" placeholder="예: 평가지표_2026" required></div>
        <button class="btn" type="submit">추가</button>
      </form>
      <p style="font-size:12px;color:var(--text-muted);margin:10px 0 0;">시트 아래쪽 탭에 표시된 이름을 그대로 입력하세요 (예: 평가지표_2026).</p>
      <div id="evalSheetList" style="margin-top:14px;"></div>
    </div>` : ""}
    <div class="card" style="overflow:auto;max-height:calc(100vh - 210px);"><div id="evalSheetWrap">불러오는 중...</div></div>`;

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

  document.getElementById("googleAuthBtn").onclick = async () => {
    try { await requestGoogleAuth(); showToast("구글 계정이 연결되었습니다."); renderSection(section.key); }
    catch (err) { alert(err.message); }
  };

  const snap = await getDocs(collection(db, "evalSheets"));
  const tabs = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.label || "").localeCompare(b.label || ""));

  const yearSelect = document.getElementById("evalYearSelect");
  const wrap = document.getElementById("evalSheetWrap");

  if (!tabs.length) {
    yearSelect.innerHTML = `<option value="">등록된 연도가 없습니다</option>`;
    wrap.innerHTML = `<div class="empty-state">등록된 연도가 없습니다. ${state.profile.role === "leader" ? "위에서 연도를 먼저 등록해주세요." : "팀장에게 문의해주세요."}</div>`;
  } else {
    yearSelect.innerHTML = tabs.map(t => `<option value="${escapeHtml(t.tabName)}">${escapeHtml(t.label)}</option>`).join("");
    yearSelect.onchange = () => loadEvalTab(yearSelect.value);
    if (googleAccessToken) await loadEvalTab(tabs[tabs.length - 1].tabName);
    else wrap.innerHTML = '오른쪽 위 "구글 계정으로 연결" 버튼을 눌러 상상플렉스 계정으로 로그인해주세요.';
  }

  if (state.profile.role === "leader") {
    renderEvalSheetList(tabs);
    document.getElementById("evalSheetAddForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const label = document.getElementById("newEvalLabel").value.trim();
      const tabName = document.getElementById("newEvalTab").value.trim();
      if (!label || !tabName) return;
      await addDoc(collection(db, "evalSheets"), { label, tabName, createdAt: new Date().toISOString() });
      showToast("연도가 등록되었습니다.");
      renderSection(section.key);
    });
  }
}

function renderEvalSheetList(tabs) {
  const wrap = document.getElementById("evalSheetList");
  if (!tabs.length) { wrap.innerHTML = `<p style="font-size:13px;color:var(--text-muted);">아직 등록된 연도가 없습니다.</p>`; return; }
  wrap.innerHTML = `<table><thead><tr><th>표시 이름</th><th>탭 이름</th><th></th></tr></thead><tbody>
    ${tabs.map(t => `<tr><td>${escapeHtml(t.label)}</td><td class="mono">${escapeHtml(t.tabName)}</td>
      <td class="actions"><button class="icon-btn danger" data-eid="${t.id}">삭제</button></td></tr>`).join("")}
  </tbody></table>`;
  wrap.querySelectorAll("[data-eid]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("이 연도 등록을 삭제할까요? (구글 시트 자체는 삭제되지 않습니다)")) return;
      await deleteDoc(doc(db, "evalSheets", btn.dataset.eid));
      showToast("삭제되었습니다.");
      renderSection(getSectionByKey("performance").key);
    };
  });
}

async function loadEvalTab(tabName) {
  const wrap = document.getElementById("evalSheetWrap");
  if (!tabName) { wrap.innerHTML = `<div class="empty-state">표시할 연도를 선택해주세요.</div>`; return; }
  wrap.innerHTML = `<div class="empty-state"><div class="shape"></div>불러오는 중...</div>`;
  try {
    const rows = await fetchSheetValues(EVAL_SPREADSHEET_ID, tabName);
    renderPlainSheetTable(wrap, rows);
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}<br><span style="font-size:12px;">시트에 "${escapeHtml(tabName)}" 이름의 탭이 있는지 확인해주세요.</span></div>`;
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
  const kts = normalizeKts(kr && kr.kts).filter(kt => (kt.text || "").trim() && kt.score);
  if (!kts.length) return 0;
  const avg = kts.reduce((s, kt) => s + Number(kt.score || 0), 0) / kts.length;
  return Math.round((avg / 5) * 100);
}
// 종합 달성율 = KR들의 달성율 평균
function overallAchievement(krs) {
  if (!krs || !krs.length) return 0;
  return Math.round(krs.reduce((s, k) => s + krAchievement(k), 0) / krs.length);
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
  const escapeMultiline = (s) => escapeHtml(s || "").replace(/\n/g, "<br>");
  // 봄(연분홍) · 여름(하늘빛) · 가을(살구빛) · 겨울(차가운 회청빛) 느낌으로 시즌 배경색을 구분합니다.
  const SEASON_BG = ["#FCEEF3", "#E5F6FA", "#FBF0DE", "#EAEEF4"];
  const colStyle = (idx) => `background:${SEASON_BG[idx % SEASON_BG.length]};border-left:2px solid var(--border);`;

  const columns = SEASON_DEFS.map(sd => {
    const label = seasonLabel(year, sd);
    const matches = docs.filter(d => d.season === label).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return { label, sd, doc: matches[0] || null };
  });

  let html = `<table style="min-width:900px;width:100%;border-collapse:collapse;table-layout:fixed;">
    <colgroup><col style="width:110px;">${columns.map(() => `<col style="width:22%;">`).join("")}</colgroup>
    <thead><tr>
    <th style="border-right:2px solid var(--border);">구분</th>
    ${columns.map((c, idx) => `<th style="${colStyle(idx)}word-break:break-word;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
        <span>${c.sd.label}</span>
        ${c.doc
          ? (canEditDoc(section, c.doc) ? `<span style="white-space:nowrap;"><button class="icon-btn" data-edit-okr="${c.doc.id}">수정</button><button class="icon-btn danger" data-del-okr="${c.doc.id}">삭제</button></span>` : "")
          : (canWriteSection(section) ? `<button class="icon-btn" data-new-okr="${escapeHtml(c.label)}">+ 등록</button>` : "")}
      </div>
    </th>`).join("")}
  </tr></thead><tbody>
    <tr><td style="font-weight:700;border-right:2px solid var(--border);">Objective</td>
      ${columns.map((c, idx) => `<td style="${colStyle(idx)}word-break:break-word;">${c.doc && c.doc.objective ? escapeMultiline(c.doc.objective) : `<span style="color:var(--text-muted);">-</span>`}</td>`).join("")}
    </tr>
    ${[0, 1, 2].map(i => `<tr><td style="font-weight:700;vertical-align:top;border-right:2px solid var(--border);">KR${i + 1}</td>
      ${columns.map((c, idx) => {
        const kr = c.doc && (c.doc.krs || [])[i];
        if (!kr || !kr.title) return `<td style="${colStyle(idx)}word-break:break-word;"><span style="color:var(--text-muted);">-</span></td>`;
        const ach = krAchievement(kr);
        const kts = normalizeKts(kr.kts).filter(kt => (kt.text || "").trim());
        return `<td style="${colStyle(idx)}word-break:break-word;">
          <div style="font-size:13px;font-weight:700;margin-bottom:4px;">${escapeHtml(kr.title)}</div>
          <div style="background:#FFFFFFAA;border-radius:6px;height:8px;margin:6px 0;overflow:hidden;"><div style="background:var(--green-bright);height:100%;width:${ach}%;"></div></div>
          <div class="mono" style="font-size:12px;color:var(--green-deep);font-weight:700;">${ach}%</div>
          ${kts.length ? `<ul style="margin:6px 0 0 16px;font-size:12px;line-height:1.6;">${kts.map(kt => `<li>${escapeHtml(kt.text)} <span class="mono" style="color:var(--text-muted);">(${kt.score || 0}점)</span></li>`).join("")}</ul>` : ""}
        </td>`;
      }).join("")}
    </tr>`).join("")}
    <tr><td style="font-weight:700;border-right:2px solid var(--border);">종합 달성율</td>
      ${columns.map((c, idx) => `<td class="mono" style="font-weight:800;color:var(--blue-deep);${colStyle(idx)}">${c.doc ? overallAchievement(c.doc.krs || []) + "%" : "-"}</td>`).join("")}
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
      <p style="font-size:11px;color:var(--text-muted);margin:0 0 8px;">KT마다 1~5점으로 점수를 매기면, 평균을 100점 만점으로 환산해서 이 KR의 달성율이 자동 계산돼요.</p>
      ${[0, 1, 2].map(j => `<div style="display:flex;gap:8px;margin-bottom:6px;">
        <input type="text" id="kt_${i}_${j}" placeholder="KT ${j + 1}" value="${escapeHtml(kts[j] ? kts[j].text || "" : "")}" style="flex:1;">
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

  // KT 텍스트/점수를 바꿀 때마다 예상 달성율을 바로 다시 계산해서 보여줍니다.
  [0, 1, 2].forEach(i => {
    const updatePreview = () => {
      const kr = {
        kts: [0, 1, 2].map(j => ({
          text: document.getElementById(`kt_${i}_${j}`).value,
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
        kts: [0, 1, 2].map(j => ({
          text: document.getElementById(`kt_${i}_${j}`).value.trim(),
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
    const currentVal = existing ? existing[f.key] : (prefill && prefill[f.key] !== undefined ? prefill[f.key] : "");
    return `<div class="field"><label>${f.label}</label>${fieldInput(f, currentVal)}</div>`;
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

  formFields.filter(f => f.type === "imageUpload").forEach(f => {
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
