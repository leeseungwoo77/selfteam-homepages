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
  { key:"schedule", label:"팀장 일정", group:"일정 · 미팅", color:"blue",
    collectionName:"schedules", scope:"team", writable:"leader",
    desc:"팀장의 일정을 등록하고 관리합니다.",
    fields:[
      { key:"date", label:"날짜", type:"date" },
      { key:"time", label:"시간", type:"time" },
      { key:"title", label:"일정 제목", type:"text" },
      { key:"memo", label:"메모", type:"textarea" }
    ], columns:["date","time","title"] },

  { key:"teamMeeting", label:"팀 회의 일지", group:"일정 · 미팅", color:"blue",
    collectionName:"teamMeetings", scope:"team", writable:"all",
    desc:"팀 전체 회의 내용을 기록합니다.",
    fields:[
      { key:"date", label:"날짜", type:"date" },
      { key:"attendees", label:"참석자", type:"text" },
      { key:"agenda", label:"안건", type:"textarea" },
      { key:"decisions", label:"결정사항", type:"textarea" },
      { key:"followUp", label:"후속조치", type:"textarea" }
    ], columns:["date","attendees","agenda"] },

  { key:"directorMeeting", label:"지점 원장 미팅 일지", group:"일정 · 미팅", color:"blue",
    collectionName:"directorMeetings", scope:"branch", writable:"leader-and-branch",
    desc:"지점 원장님과의 미팅 내용을 기록합니다.",
    fields:[
      { key:"date", label:"날짜", type:"date" },
      { key:"branchId", label:"지점", type:"branchSelect" },
      { key:"director", label:"원장 이름", type:"text" },
      { key:"content", label:"미팅 내용", type:"textarea" },
      { key:"followUp", label:"후속조치", type:"textarea" }
    ], columns:["date","branchName","director"] },

  { key:"memberMeeting", label:"지점 팀원 개별 미팅 일지", group:"일정 · 미팅", color:"blue",
    collectionName:"memberMeetings", scope:"branch", writable:"leader-and-branch",
    desc:"지점 팀원과의 개별 미팅 내용을 기록합니다.",
    fields:[
      { key:"date", label:"날짜", type:"date" },
      { key:"branchId", label:"지점", type:"branchSelect" },
      { key:"memberName", label:"팀원 이름", type:"text" },
      { key:"content", label:"미팅 내용", type:"textarea" },
      { key:"followUp", label:"후속조치", type:"textarea" }
    ], columns:["date","branchName","memberName"] },

  { key:"performance", label:"지점 성과 지표", group:"성과", color:"green",
    collectionName:"performance", scope:"branch", writable:"leader-and-branch",
    desc:"지점별 매출·등록 등 성과 지표를 관리합니다.",
    fields:[
      { key:"period", label:"기간 (예: 2026-07)", type:"text" },
      { key:"branchId", label:"지점", type:"branchSelect" },
      { key:"revenue", label:"매출(만원)", type:"number" },
      { key:"newRegistrations", label:"신규 등록 수", type:"number" },
      { key:"renewalRate", label:"재등록률(%)", type:"number" },
      { key:"consultationConversion", label:"상담 전환율(%)", type:"number" },
      { key:"memo", label:"메모", type:"textarea" }
    ], columns:["period","branchName","revenue","newRegistrations","renewalRate"], isPerformance:true },

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

/* ===================== 전역 상태 ===================== */
const state = { user:null, profile:null, branches:[], currentSection:"schedule" };

/* ===================== 인증 확인 ===================== */
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  state.user = user;
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) { window.location.href = "index.html"; return; }
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
    const items = SECTIONS.filter(s => s.group === group);
    html += `<div class="nav-group"><div class="nav-group-label">${group}</div>`;
    items.forEach(s => {
      html += `<div class="nav-item" data-key="${s.key}" style="--nav-color:${COLOR_HEX[s.color]}">
        <span class="dot" style="background:${COLOR_HEX[s.color]}"></span>${s.label}
      </div>`;
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
    el.onclick = () => { state.currentSection = el.dataset.key; renderSection(el.dataset.key); };
  });
}

function markActiveNav(key) {
  document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.key === key));
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
  main.innerHTML = `<div class="page-header">
      <div>
        <h1><span class="badge" style="background:${COLOR_HEX[section.color]}"></span>${section.label}</h1>
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

/* ===================== 등록/수정 모달 ===================== */
function fieldInput(field, value) {
  const v = value ?? "";
  if (field.type === "textarea") {
    return `<textarea id="f_${field.key}" rows="3">${escapeHtml(String(v))}</textarea>`;
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
          <button type="submit" class="btn">저장</button>
        </div>
      </form>
    </div></div>`;

  document.getElementById("cancelBtn").onclick = () => root.innerHTML = "";
  document.getElementById("modalBg").addEventListener("click", (e) => { if (e.target.id === "modalBg") root.innerHTML = ""; });

  document.getElementById("entryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {};
    section.fields.forEach(f => {
      const el = document.getElementById(`f_${f.key}`);
      data[f.key] = el ? el.value : "";
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

    try {
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
