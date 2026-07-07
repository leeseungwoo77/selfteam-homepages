# 셀프팀 홈페이지

상상플렉스 브랜드 컬러(파랑·초록·마젠타)를 적용한 셀프팀 전용 관리 홈페이지입니다.
GitHub Pages(무료 호스팅) + Firebase(로그인/데이터베이스)로 동작합니다.

## 담긴 내용
- 팀장 일정 · 팀 회의 일지 · 지점 원장 미팅 일지 · 지점 팀원 개별 미팅 일지
- 지점 성과 지표 · 팀 공지사항 · 지점 운영 자료 · 리더십 자료 · 팀 스터디 자료
- 팀장 / 팀원 로그인 및 권한 분리 (팀장: 전체 열람·수정, 팀원: 자기 담당 지점 자료만 열람·수정)
- 회원가입 화면에서 팀원이 직접 계정 생성

---

## 1단계. Firebase 프로젝트 만들기

1. https://console.firebase.google.com 접속 → 구글 계정 로그인
2. **프로젝트 추가** → 이름 입력 (예: `selfteam-homepage`) → Analytics는 꺼도 무방
3. 왼쪽 메뉴 **Authentication** → 시작하기 → **Sign-in method** 탭 → **이메일/비밀번호** 사용 설정
4. 왼쪽 메뉴 **Firestore Database** → 데이터베이스 만들기 → **프로덕션 모드** → 위치 `asia-northeast3(서울)`
5. 왼쪽 상단 톱니바퀴 → **프로젝트 설정** → 아래 "내 앱" → 웹 아이콘(`</>`) 클릭 → 앱 닉네임 입력 → Firebase Hosting 체크는 안 해도 됨
6. 화면에 나오는 `firebaseConfig` 객체를 복사해서 `js/firebase-config.js` 파일 안의 값을 교체하세요.

## 2단계. 보안 규칙 적용

Firebase 콘솔 → **Firestore Database → 규칙(Rules)** 탭 → 이 프로젝트의 `firestore.rules` 파일 내용을 그대로 붙여넣고 **게시**하세요.

## 3단계. 팀장 계정 만들기 (가장 먼저!)

1. 배포된 사이트에서 **회원가입** 진행 (담당 지점이 아직 없을 수 있으니, 먼저 아래 4단계로 지점을 1개 이상 등록한 뒤 가입하거나, 임시로 아무 지점명이나 넣고 가입 후 나중에 관리자 화면에서 수정하셔도 됩니다)
2. Firebase 콘솔 → **Firestore Database → 데이터** → `users` 컬렉션 → 방금 가입한 본인 문서 클릭
3. `role` 필드 값을 `"member"` → **`"leader"`** 로 수정
4. 다시 로그인하면 사이드바에 **"지점 · 팀원 관리"** 메뉴가 나타납니다. 여기서 지점을 추가하고, 이후 가입하는 팀원에게 팀장 권한을 부여할 수도 있습니다.

## 4단계. GitHub Pages로 배포하기

1. https://github.com 에서 새 저장소(Repository) 생성 (예: `selfteam-homepage`), Public으로 설정
2. 이 폴더 안의 모든 파일(index.html, dashboard.html, css/, js/, assets/)을 저장소에 업로드 (GitHub 웹사이트의 "Add file → Upload files" 사용 가능, 또는 git 명령어 사용)
3. 저장소 **Settings → Pages** 이동
4. **Source**를 `Deploy from a branch`로, **Branch**를 `main` / `(root)`로 설정 후 저장
5. 몇 분 후 `https://[깃허브아이디].github.io/selfteam-homepage/` 주소로 접속 가능

## 파일 구조
```
index.html          로그인 / 회원가입
dashboard.html      메인 대시보드 (로그인 후 화면)
css/style.css        스타일 (브랜드 컬러 토큰)
js/firebase-config.js   ← Firebase 값 입력하는 곳
js/firebase-init.js     Firebase 초기화
js/auth.js              로그인/회원가입 로직
js/app.js               대시보드 전체 로직 (9개 메뉴 + 관리자 화면)
firestore.rules      Firestore 보안 규칙 (콘솔에 붙여넣기)
assets/logo.jpg      로고 이미지
```

## 데이터 구조 참고
| 메뉴 | 범위 | 작성 권한 |
|---|---|---|
| 팀장 일정 | 팀 전체 | 팀장만 |
| 팀 회의 일지 | 팀 전체 | 전원 |
| 지점 원장 미팅 일지 | 지점별 | 팀장 전체 / 팀원은 자기 지점 |
| 지점 팀원 개별 미팅 일지 | 지점별 | 팀장 전체 / 팀원은 자기 지점 |
| 지점 성과 지표 | 지점별 | 팀장 전체 / 팀원은 자기 지점 |
| 팀 공지사항 | 팀 전체 | 팀장만 |
| 지점 운영 자료 | 지점별 | 팀장 전체 / 팀원은 자기 지점 |
| 리더십 자료 | 팀 전체 | 팀장만 |
| 팀 스터디 자료 | 팀 전체 | 전원 |

필요에 따라 `js/app.js` 상단의 `SECTIONS` 배열에서 필드나 권한(`writable`)을 자유롭게 조정할 수 있습니다.

## 나중에 고려하면 좋은 것들
- 파일 첨부: 지금은 "링크(URL)"만 저장됩니다. 실제 파일 업로드가 필요하면 Firebase Storage 연동이 추가로 필요합니다 (원하시면 이어서 만들어 드릴 수 있어요).
- 성과 지표 그래프: 현재는 숫자 요약 카드만 있습니다. 월별 추이 그래프가 필요하면 알려주세요.
- 커스텀 도메인 연결 (예: team.sangsangplex.com)
