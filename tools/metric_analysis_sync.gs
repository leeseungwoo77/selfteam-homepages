/**
 * "지표 분석" 구글시트 자동 동기화 (Google Apps Script)
 * --------------------------------------------------------------
 * 하는 일
 *  1) 지정한 구글시트(손익계산서/고객지표 등을 모아둔 "지표 분석" 원본 파일)의
 *     모든 탭을 읽어서, 홈페이지가 엑셀 업로드할 때 저장하는 것과 똑같은 형태로 변환
 *  2) Firebase(Firestore) customFolders/{FOLDER_DOC_ID} 문서의
 *     sheetData / sheetFileName / sheetUpdatedAt 세 필드만 덮어씁니다.
 *     (updateMask로 이 세 필드만 바꾸므로, 메뉴 이름·권한 등 다른 설정은 그대로 유지됩니다)
 *  3) 매일 자동 갱신 (setupMetricAnalysisDailyTrigger 1회 실행)
 *
 * 설치 (팀장, 1회)
 *  1. 기존 "지점·구성원 지표분석" 수집기(metrics_collector.gs)를 넣어둔 Apps Script
 *     프로젝트를 엽니다. (왼쪽 ⚙ 프로젝트 설정에서 appsscript.json에 이미 필요한 권한이 들어있어요)
 *  2. 왼쪽 파일 목록에서 + → 스크립트 추가, 이름은 아무거나(예: metric_analysis_sync) →
 *     이 파일 내용을 통째로 붙여넣고 저장
 *  3. 아래 FOLDER_DOC_ID 값을 채워 넣습니다.
 *     → 홈페이지 "홈페이지 관리 → 전체 메뉴 관리"에서 "지표 분석" 항목의 "수정"을 누르면
 *       맨 아래쪽에 "폴더 ID"가 보여요. 그 값을 그대로 복사해서 넣으면 됩니다.
 *  4. 위쪽 함수 선택에서 syncMetricAnalysisSheet → 실행 → 권한 승인(처음 한 번)
 *     - 성공하면 홈페이지 "지표 분석"에 들어가서 Ctrl+F5로 새로고침 → 엑셀 업로드 카드 아래
 *       "현재 연결된 데이터: 구글시트 자동 동기화 (...자동 갱신)"로 바뀐 걸 확인
 *     - 403 오류가 나면 metrics_collector.gs의 "권한 오류(403)"와 똑같은 원인입니다.
 *       (이 스크립트를 실행하는 구글 계정이 Firebase 프로젝트 "편집자"로 등록돼 있어야 함)
 *  5. 함수 setupMetricAnalysisDailyTrigger 실행 (매일 자동 동기화 등록)
 *
 * 참고: 이 스크립트는 시트를 "링크 공개"로 바꿀 필요가 전혀 없습니다. 이 스크립트를
 * 실행하는 구글 계정이 평소 그 시트를 볼 수 있으면(공유돼 있으면) 그대로 동작해요.
 */

// ===== 설정 =====================================================
// "지표 분석"에서 올리는 바로 그 원본 구글시트 (원본 파일 열기 링크의 /d/ 와 /edit 사이 값)
const METRIC_ANALYSIS_SHEET_ID = '10KwiAbBdzcP88BKHL2dzFzTN3yzPXuKTSxQRkPct9zo';
// 홈페이지 "전체 메뉴 관리 → 지표 분석 → 수정"에서 보이는 "폴더 ID" 값을 넣어주세요.
const FOLDER_DOC_ID = '여기에_폴더_ID를_넣어주세요';
const METRIC_ANALYSIS_FIREBASE_PROJECT_ID = 'selfteam-homepage-91564'; // metrics_collector.gs와 같은 프로젝트

// 엑셀 파일에 서식만 있는 빈 줄/빈 칸이 딸려오는 걸 걸러내서, 실제 데이터가 있는 범위까지만 남깁니다.
// (js/app.js의 trimSheetRows와 동일한 로직)
function trimSheetRows_(rows) {
  const isEmptyCell = c => c === '' || c === null || c === undefined;
  while (rows.length && rows[rows.length - 1].every(isEmptyCell)) rows.pop();
  let maxCols = 0;
  rows.forEach(r => {
    let lastNonEmpty = -1;
    r.forEach((c, i) => { if (!isEmptyCell(c)) lastNonEmpty = i; });
    maxCols = Math.max(maxCols, lastNonEmpty + 1);
  });
  return rows.map(r => r.slice(0, maxCols));
}

function syncMetricAnalysisSheet() {
  if (!FOLDER_DOC_ID || FOLDER_DOC_ID.indexOf('여기에') === 0) {
    throw new Error('FOLDER_DOC_ID를 먼저 채워주세요. (홈페이지 전체 메뉴 관리 → 지표 분석 → 수정 에서 "폴더 ID" 확인)');
  }
  const ss = SpreadsheetApp.openById(METRIC_ANALYSIS_SHEET_ID);
  const newSheetData = {};
  ss.getSheets().forEach(sh => {
    if (sh.getLastRow() === 0 || sh.getLastColumn() === 0) return; // 빈 탭은 건너뜀
    const values = sh.getDataRange().getDisplayValues(); // 화면에 보이는 그대로(서식 적용된 문자열)의 값
    newSheetData[sh.getName()] = trimSheetRows_(values);
  });
  pushMetricAnalysisToFirestore_(newSheetData);
}

// Firestore REST로 저장 — sheetData/sheetFileName/sheetUpdatedAt 세 필드만 바꾸고(updateMask),
// label·writable·visibility 같은 다른 설정 필드는 절대 건드리지 않습니다.
function pushMetricAnalysisToFirestore_(newSheetData) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + METRIC_ANALYSIS_FIREBASE_PROJECT_ID +
    '/databases/(default)/documents/customFolders/' + encodeURIComponent(FOLDER_DOC_ID) +
    '?updateMask.fieldPaths=sheetData&updateMask.fieldPaths=sheetFileName&updateMask.fieldPaths=sheetUpdatedAt';
  const body = {
    fields: {
      sheetData: { stringValue: JSON.stringify(newSheetData) },
      sheetFileName: { stringValue: '구글시트 자동 동기화' },
      // 홈페이지의 수동 업로드 코드도 이 값을 일반 문자열(ISO 날짜 텍스트)로 저장하므로,
      // Firestore 전용 타임스탬프 타입(timestampValue)이 아니라 반드시 문자열(stringValue)로 저장해야
      // 화면에서 .slice()로 날짜를 잘라 보여주는 부분이 깨지지 않습니다.
      sheetUpdatedAt: { stringValue: new Date().toISOString() },
    }
  };
  const res = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) {
    throw new Error(res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
  }
}

function setupMetricAnalysisDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncMetricAnalysisSheet')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncMetricAnalysisSheet').timeBased().atHour(7).everyDays(1).inTimezone('Asia/Seoul').create();
}
