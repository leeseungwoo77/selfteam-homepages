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
    collectionName:"scheduleEntries", scope:"team", writable:"leader",
    desc:"팀장 일정을 월 단위로 직접 입력하고 관리합니다.",
    isMonthlySchedule:true },

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
const GROUP_ORDER = ["일정 · 미팅", "성과·전략", "소통·협업", "자료실"];
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
const SCHEDULE_NOTE_ROWS = ["에듀본사", "전농", "돈암", "행당", "별내", "다산"];

const scheduleViewState = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };

async function renderMonthlySchedule(section) {
  const main = document.getElementById("mainContent");
  const canEdit = canWriteSection(section);
  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}</h1>
        <p>${section.desc}${canEdit ? " · 날짜를 클릭하면 그 날 일정을 수정할 수 있어요." : ""}</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="icon-btn" id="prevMonthBtn" style="font-size:18px;">‹</button>
        <span id="monthLabel" style="font-weight:800;font-size:15px;min-width:110px;text-align:center;"></span>
        <button class="icon-btn" id="nextMonthBtn" style="font-size:18px;">›</button>
      </div>
    </div>
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

  const cellStyle = "white-space:nowrap;padding:5px 10px;";
  const leftLabelStyle = "position:sticky;left:0;background:#fff;z-index:1;white-space:nowrap;font-weight:700;";

  let html = `<table class="table-compact" style="width:max-content;"><thead>
    <tr>
      <th style="position:sticky;left:0;top:0;background:#F4FAEF;z-index:3;">날짜</th>
      ${dates.map(d => {
        const wd = weekdayLabel(year, month, d);
        const wdColor = wd === "토" ? "var(--blue-deep)" : wd === "일" ? "var(--danger)" : "var(--text-main)";
        const clickable = canEdit ? `cursor:pointer;text-decoration:underline;` : "";
        return `<th style="position:sticky;top:0;background:#F4FAEF;z-index:2;color:${wdColor};${clickable}" ${canEdit ? `data-edit-day="${ymd(year, month, d)}"` : ""}>${month}.${pad2(d)}(${wd})</th>`;
      }).join("")}
    </tr>
  </thead><tbody>`;

  // 근무장소 행
  html += `<tr><td style="${leftLabelStyle}">근무장소</td>`;
  dates.forEach(d => {
    const entry = byDate[ymd(year, month, d)];
    const loc = entry?.location || "";
    const bg = loc ? matchLocationColor(loc) : null;
    html += `<td style="${cellStyle}${bg ? `background:${bg};color:#fff;font-weight:700;border-radius:4px;` : ""}">${escapeHtml(loc)}</td>`;
  });
  html += `</tr>`;

  // 지점별 특이사항 행 (에듀본사/전농/돈암/행당/별내/다산)
  SCHEDULE_NOTE_ROWS.forEach(rowLabel => {
    const rowColor = LOCATION_COLORS[rowLabel] || "#9CA88F";
    html += `<tr><td style="${leftLabelStyle}background:${rowColor};color:#fff;">${escapeHtml(rowLabel)}</td>`;
    dates.forEach(d => {
      const entry = byDate[ymd(year, month, d)];
      const note = (entry?.notes && entry.notes[rowLabel]) || "";
      html += `<td style="${cellStyle}">${escapeHtml(note)}</td>`;
    });
    html += `</tr>`;
  });

  // 30분 단위 시간표 행
  SCHEDULE_TIME_SLOTS.forEach(slot => {
    html += `<tr><td style="${leftLabelStyle}">${slot}</td>`;
    dates.forEach(d => {
      const entry = byDate[ymd(year, month, d)];
      const items = entry?.items || [];
      const item = items.find(it => it.startTime && it.endTime && slot >= it.startTime && slot < it.endTime);
      const bg = item ? matchLocationColor(item.title || "") : null;
      const style = item
        ? (bg ? `background:${bg};color:#fff;font-weight:700;border-radius:4px;` : `background:#EDEDED;`)
        : "";
      html += `<td style="${cellStyle}${style}">${item ? escapeHtml(item.title || "") : ""}</td>`;
    });
    html += `</tr>`;
  });

  html += `</tbody></table>`;
  document.getElementById("scheduleCalendar").innerHTML = html;

  if (canEdit) {
    document.querySelectorAll("[data-edit-day]").forEach(th => {
      th.onclick = () => openScheduleDayModal(section, th.dataset.editDay, byDate[th.dataset.editDay]);
    });
  }
}

function openScheduleDayModal(section, dateStr, existing) {
  const root = document.getElementById("modalRoot");
  const state_ = {
    location: (existing && existing.location) || "",
    notes: (existing && existing.notes) ? { ...existing.notes } : {},
    items: (existing && existing.items) ? existing.items.map(i => ({ ...i })) : []
  };

  function render() {
    root.innerHTML = `<div class="modal-bg" id="modalBg">
      <div class="modal" style="max-width:560px;">
        <h3>${dateStr} 일정</h3>
        <div class="field"><label>근무 장소</label><input type="text" id="dayLocation" placeholder="예: 상상, 상상 전능" value="${escapeHtml(state_.location)}"></div>
        <div class="field"><label>지점별 특이사항</label>
          <div class="grid-2">
            ${SCHEDULE_NOTE_ROWS.map(label => `<div>
              <label style="font-size:11px;">${escapeHtml(label)}</label>
              <input type="text" id="note_${label}" value="${escapeHtml(state_.notes[label] || "")}">
            </div>`).join("")}
          </div>
        </div>
        <div class="field"><label>일정 목록 (30분 단위)</label>
          <div id="dayItems"></div>
          <button type="button" class="btn small secondary" id="addItemBtn" style="margin-top:6px;">+ 일정 추가</button>
        </div>
        <div class="grid-2" style="margin-top:14px;">
          <button type="button" class="btn secondary" id="cancelBtn">취소</button>
          <button type="button" class="btn" id="saveDayBtn">저장</button>
        </div>
      </div></div>`;
    renderItems();
    document.getElementById("cancelBtn").onclick = () => root.innerHTML = "";
    document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") root.innerHTML = ""; });
    document.getElementById("addItemBtn").onclick = () => { syncItemsFromInputs(); state_.items.push({ startTime: "", endTime: "", title: "" }); renderItems(); };
    document.getElementById("saveDayBtn").onclick = async () => {
      syncItemsFromInputs();
      const location = document.getElementById("dayLocation").value.trim();
      const notes = {};
      SCHEDULE_NOTE_ROWS.forEach(label => {
        const v = document.getElementById(`note_${label}`).value.trim();
        if (v) notes[label] = v;
      });
      const cleanItems = state_.items.filter(it => it.startTime && it.endTime && it.title);
      try {
        await setDoc(doc(db, "scheduleEntries", dateStr), { date: dateStr, location, notes, items: cleanItems });
        root.innerHTML = "";
        showToast("저장되었습니다.");
        renderSection(section.key);
      } catch (err) {
        alert("저장 중 오류: " + err.message);
      }
    };
  }

  function syncItemsFromInputs() {
    state_.items = state_.items.map((it, i) => ({
      startTime: document.getElementById(`itemStart_${i}`)?.value || it.startTime || "",
      endTime: document.getElementById(`itemEnd_${i}`)?.value || it.endTime || "",
      title: document.getElementById(`itemTitle_${i}`)?.value || it.title || ""
    }));
  }

  function renderItems() {
    const wrap = document.getElementById("dayItems");
    wrap.innerHTML = state_.items.map((it, i) => `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
        <input type="time" id="itemStart_${i}" value="${escapeHtml(it.startTime || "")}" step="1800" style="width:110px;">
        <span style="color:var(--text-muted);">~</span>
        <input type="time" id="itemEnd_${i}" value="${escapeHtml(it.endTime || "")}" step="1800" style="width:110px;">
        <input type="text" id="itemTitle_${i}" placeholder="일정 제목" value="${escapeHtml(it.title || "")}" style="flex:1;">
        <button type="button" class="icon-btn danger" data-rm="${i}">✕</button>
      </div>`).join("") || `<p style="font-size:12px;color:var(--text-muted);">등록된 일정이 없습니다.</p>`;
    wrap.querySelectorAll("[data-rm]").forEach(btn => {
      btn.onclick = () => {
        syncItemsFromInputs();
        state_.items.splice(parseInt(btn.dataset.rm, 10), 1);
        renderItems();
      };
    });
  }

  render();
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
