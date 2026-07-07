import {
  auth, db,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, doc, setDoc, getDocs, collection
} from "./firebase-init.js";

// 이미 로그인되어 있으면 대시보드로 이동
onAuthStateChanged(auth, (user) => {
  if (user) window.location.href = "dashboard.html";
});

// 탭 전환
const tabLogin = document.getElementById("tabLogin");
const tabSignup = document.getElementById("tabSignup");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");

tabLogin.onclick = () => {
  tabLogin.classList.add("active");
  tabSignup.classList.remove("active");
  loginForm.style.display = "block";
  signupForm.style.display = "none";
};
tabSignup.onclick = () => {
  tabSignup.classList.add("active");
  tabLogin.classList.remove("active");
  signupForm.style.display = "block";
  loginForm.style.display = "none";
  loadBranches();
};

// 지점 목록 불러오기 (회원가입 시 선택용)
async function loadBranches() {
  const select = document.getElementById("suBranch");
  try {
    const snap = await getDocs(collection(db, "branches"));
    if (snap.empty) {
      select.innerHTML = `<option value="">등록된 지점이 없습니다 (팀장 문의)</option>`;
      return;
    }
    select.innerHTML = snap.docs
      .map(d => `<option value="${d.id}" data-name="${d.data().name}">${d.data().name}</option>`)
      .join("");
  } catch (e) {
    select.innerHTML = `<option value="">지점 목록을 불러올 수 없습니다</option>`;
  }
}

// 로그인
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "dashboard.html";
  } catch (err) {
    errEl.textContent = "이메일 또는 비밀번호가 올바르지 않습니다.";
  }
});

// 회원가입
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("suName").value.trim();
  const branchSelect = document.getElementById("suBranch");
  const branchId = branchSelect.value;
  const branchName = branchSelect.selectedOptions[0]?.dataset.name || "";
  const email = document.getElementById("suEmail").value.trim();
  const password = document.getElementById("suPassword").value;
  const errEl = document.getElementById("signupError");
  errEl.textContent = "";

  if (!branchId) { errEl.textContent = "담당 지점을 선택해주세요."; return; }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    // 기본 role은 'member'. 팀장 계정은 Firebase 콘솔에서 role 값을 'leader'로 수동 변경합니다.
    await setDoc(doc(db, "users", cred.user.uid), {
      name, email, branchId, branchName, role: "member",
      createdAt: new Date().toISOString()
    });
    window.location.href = "dashboard.html";
  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      errEl.textContent = "이미 가입된 이메일입니다.";
    } else if (err.code === "auth/weak-password") {
      errEl.textContent = "비밀번호는 6자 이상이어야 합니다.";
    } else {
      errEl.textContent = "회원가입 중 오류가 발생했습니다: " + err.message;
    }
  }
});
