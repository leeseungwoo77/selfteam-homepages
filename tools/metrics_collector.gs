/**
 * 셀프팀 지표분석 수집기 (Google Apps Script)
 * --------------------------------------------------------------
 * 하는 일
 *  1) 고객지표 시트(지점_2026 탭, 2026/2025/2024 블록)  → branch_monthly 탭
 *  2) 등록현황 이전 양식(~26.06) + 신규 양식(26.07~)의
 *     '상담관리 분석' / '개별지도 분석' 블록           → member_monthly 탭
 *  3) 매일 06시 자동 갱신 (setupDailyTrigger 1회 실행)
 *  4) 웹앱(doGet)으로 JSON 제공 — 지점별 키로 "자기 지점만" 내려줌
 *
 * 설치: 새 구글 시트 → 확장 프로그램 > Apps Script → 이 파일 붙여넣기
 *       → collectAll 1회 실행(권한 승인) → setupDailyTrigger 1회 실행
 *       → setupKeys 1회 실행(키 생성) → 배포 > 웹앱(실행: 나, 액세스: 모든 사용자)
 */

// ===== 설정 =====================================================
const KPI_SHEET_ID = '1uequoelbdG3zLzo-FgqbDsPIlb7NGFIasS_82ZzE6iA';

// ※ 행당은 공유받은 링크의 '이전/새로운'이 서로 바뀌어 있어 파일 제목 기준으로 정정함
const BRANCHES = {
  '돈암': { kpiTab: '돈암_2026', oldId: '14ha3QilHd0wSc_KDmTcKasCxX-uAUKz3mdkOsNidBZA', newId: '1WDC6Gk_XCDxKKWOxsp7_hJvzFFFnwdnqgGoDXX5z1wo' },
  '행당': { kpiTab: '행당_2026', oldId: '1kvsSiC-caaJeN6-0qW3SZ9mmJUj-YgGrWxTRAcni8YA', newId: '1R3i1CuVJXDErfyA3FpuBpMbKStP6Jwh0Gr5_NvopYXI' },
  '별내': { kpiTab: '별내_2026', oldId: '1Mc51jTD7Y8S9PuhoVSZRtlczLMk-_G6BEYFRwALJA9Q', newId: '1lYnuSMV70V2jolyAb44yutq2CG91J8OZMdEOQzoKqAU' },
  '다산': { kpiTab: '다산_2026', oldId: '1pP-hKNrRZYeqf7cuPxidg2QsAGARJl_plEltA-fRjNQ', newId: '1H2xcODphqnD97xxo62dH0IOOgZMauZtTWR5_NmrtQ10' },
};
const NEW_FORMAT_FROM = '2026-07';   // 이 달부터는 신규 양식만 사용

// ===== 공통 유틸 ================================================
function num_(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s || s === '—' || s === '-' || s.startsWith('#')) return null;
  const pct = s.endsWith('%');
  s = s.replace(/[₩,명콤마개월\s%]/g, '').replace(/[()]/g, m => (m === '(' ? '-' : ''));
  if (s === '' || isNaN(Number(s))) return null;
  const n = Number(s);
  return pct ? Math.round(n * 100) / 10000 : n;
}
const clean_ = s => String(s || '').replace(/\s+/g, '').trim();
function tabToYm_(name) {
  const m = String(name).match(/^(\d{2})년\s*(\d{1,2})월$/);       // '26년9월' 만, 사본·이용X 제외
  return m ? `20${m[1]}-${String(m[2]).padStart(2, '0')}` : null;
}

// ===== 1) 고객지표 → branch_monthly ==============================
// 지표명 정규화: '월말(2026)' → '월말' (블록 연도와 다른 연도 표기 행·'비교' 행은 버림)
function normKpiLabel_(label, year) {
  const l = clean_(label);
  if (!l || l.includes('비교')) return null;
  const m = l.match(/^(.*)\((20\d\d)\)$/);
  if (m) return Number(m[2]) === year ? m[1] : null;
  return l.replace('이탈률', '이탈율').replace('프리미엄률', '프리미엄율');
}

function parseKpiTab_(branch, values) {
  const out = [];
  let year = null, lastGoalYear = 2026;
  for (let r = 0; r < values.length; r++) {
    const row = values[r];
    const a = String(row[0] || '').trim(), b = clean_(row[1]);
    const goal = a.match(/(20\d\d)년\s*목표/);
    if (goal) lastGoalYear = Number(goal[1]);
    if (b === '월' && clean_(row[2]) === '1월') {          // 블록 헤더
      year = /^20\d\d$/.test(a) ? Number(a) : lastGoalYear;
      continue;
    }
    if (!year || !b) continue;
    if (/^(성함|평균\/총합)$/.test(clean_(row[0]))) { year = null; continue; } // 하단 개인 목표표 진입
    const metric = normKpiLabel_(row[1], year);
    if (!metric) continue;
    for (let c = 0; c < 12; c++) {                          // C~N = 1~12월
      const v = num_(row[2 + c]);
      if (v === null) continue;
      out.push([branch, year, c + 1, metric, v]);
    }
  }
  return out;
}

// ===== 2) 등록현황 → member_monthly =============================
const ROW_KEYS = {
  '월초': 'start', '신규/복회/전환+': 'new', '리퍼+': 'refIn', '리퍼-': 'refOut',
  '종료': 'end', '보정': 'adj', '월말': 'finish', '주5회비율': 'w5', '주4회비율': 'w4', '주3회비율': 'w3',
  '상담비율': 'counsel', '프미율': 'premium', '콤마수': 'comma',
};
const SKIP_NAMES = /^(전체|프리미엄|온리|매니저\d+|)$/;

function findCell_(values, label, maxRow) {
  for (let r = 0; r < Math.min(values.length, maxRow); r++)
    for (let c = 0; c < values[r].length; c++)
      if (clean_(values[r][c]) === label) return { r, c };
  return null;
}

function parseBlock_(values, label, endLabel) {
  const pos = findCell_(values, label, 30);
  if (!pos) return [];
  const head = values[pos.r];
  const members = [];
  for (let c = pos.c + 1; c < head.length; c++) {
    const name = String(head[c] || '').trim();
    if (name === endLabel) break;
    members.push({ c, name });
  }
  const rows = {};
  for (let r = pos.r + 1; r < Math.min(values.length, pos.r + 18); r++) {
    const key = ROW_KEYS[clean_(values[r][pos.c])];
    if (key) rows[key] = values[r];
  }
  // 전체 열(합계) 위치 — 교실장 집계 판별용
  // 상담관리는 '전체' 열, 개별지도는 '프리미엄' 뒤의 '전체' 열(없으면 프리미엄+온리)
  const colOf = lbl => head.findIndex((h, i) => i > pos.c && String(h).trim() === lbl);
  let totalStart = null;
  if (rows.start) {
    const tc = colOf('전체');
    if (tc > 0) totalStart = num_(rows.start[tc]);
    else if (colOf('프리미엄') > 0) totalStart = (num_(rows.start[colOf('프리미엄')]) || 0) + (num_(rows.start[colOf('온리')]) || 0);
  }
  const pick = (key, c) => (rows[key] ? num_(rows[key][c]) : null);

  const recs = members
    .filter(m => !SKIP_NAMES.test(m.name))
    .map(m => {
      const rec = { name: m.name };
      Object.values(ROW_KEYS).forEach(k => (rec[k] = pick(k, m.c)));
      return rec;
    })
    .filter(rec => (rec.start || 0) + (rec.finish || 0) + (rec.new || 0) > 0);

  // 교실장 집계 열: 월초가 지점 전체와 같고 다른 구성원도 있으면 개인이 아닌 합계로 판단
  recs.forEach(rec => {
    rec.role = rec.name === '원장' ? '원장' : '매니저';
    if (recs.length > 1 && totalStart && rec.start === totalStart && label === '개별지도분석') rec.role = '교실장집계';
  });
  return recs;
}

function parseRegistrationFile_(branch, fileId, fmt) {
  const out = [];
  const ss = SpreadsheetApp.openById(fileId);
  ss.getSheets().forEach(sh => {
    const ym = tabToYm_(sh.getName());
    if (!ym) return;
    if (fmt === 'old' && ym >= NEW_FORMAT_FROM) return;
    if (fmt === 'new' && ym < NEW_FORMAT_FROM) return;
    const values = sh.getRange(1, 1, Math.min(30, sh.getMaxRows()), Math.min(45, sh.getMaxColumns())).getDisplayValues();
    [['상담관리분석', '상담관리', '전체'], ['개별지도분석', '개별지도', '프리미엄']].forEach(([label, area, end]) => {
      parseBlock_(values, label, end).forEach(rec => {
        const churn = rec.start ? (rec.end || 0) / rec.start : null;     // 이탈률 = 종료 ÷ 월초 (리퍼- 제외)
        const perComma = area === '개별지도' && rec.finish ? (rec.comma || 0) / rec.finish : null;
        out.push([branch, ym, area, rec.name, rec.role, rec.start, rec.new, rec.refIn, rec.refOut, rec.end,
                  rec.adj, rec.finish, churn, rec.premium, rec.comma, perComma, rec.w5, rec.w4, rec.w3, rec.counsel, fmt]);
      });
    });
  });
  return out;
}

// ===== 실행 =====================================================
function collectAll() {
  const kpi = SpreadsheetApp.openById(KPI_SHEET_ID);
  const branchRows = [], memberRows = [], log = [];
  Object.entries(BRANCHES).forEach(([branch, cfg]) => {
    try {
      const sh = kpi.getSheetByName(cfg.kpiTab);
      branchRows.push(...parseKpiTab_(branch, sh.getRange(1, 1, sh.getLastRow(), 16).getDisplayValues()));
    } catch (e) { log.push(`${branch} 고객지표 실패: ${e.message}`); }
    [['old', cfg.oldId], ['new', cfg.newId]].forEach(([fmt, id]) => {
      try { memberRows.push(...parseRegistrationFile_(branch, id, fmt)); }
      catch (e) { log.push(`${branch} 등록현황(${fmt}) 실패: ${e.message}`); }
    });
  });
  writeTab_('branch_monthly', ['지점', '연도', '월', '지표', '값'], branchRows);
  writeTab_('member_monthly', ['지점', '월', '영역', '구성원', '역할', '월초', '신규', '리퍼+', '리퍼-', '종료', '보정', '월말',
    '이탈률(재계산)', '프미율', '콤마수', '인당콤마', '주5회', '주4회', '주3회', '상담비율', '양식'], memberRows);
  writeTab_('collect_log', ['시각', '내용'], [[new Date(), log.length ? log.join(' / ') : `정상 (지점 ${branchRows.length}행, 구성원 ${memberRows.length}행)`]], true);
  CacheService.getScriptCache().remove('payload');
}

function writeTab_(name, header, rows, append) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (append) { if (sh.getLastRow() === 0) sh.appendRow(header); rows.forEach(r => sh.appendRow(r)); return; }
  sh.clearContents();
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, header.length).setValues(rows);
  sh.setFrozenRows(1);
}

function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'collectAll').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('collectAll').timeBased().atHour(6).everyDays(1).inTimezone('Asia/Seoul').create();
}

// 지점별 열람 키 생성 — 원장님께는 자기 지점 키만, 팀장은 ALL 키
function setupKeys() {
  const p = PropertiesService.getScriptProperties();
  const keys = {};
  [...Object.keys(BRANCHES), 'ALL'].forEach(b => { keys[b] = Utilities.getUuid().slice(0, 12); p.setProperty('KEY_' + b, keys[b]); });
  Logger.log(JSON.stringify(keys, null, 2));
}

// ===== 웹앱: ?key=xxxx → 해당 지점(또는 전체) JSON ===============
function doGet(e) {
  const key = (e.parameter.key || '').trim();
  const p = PropertiesService.getScriptProperties().getProperties();
  const scope = Object.keys(p).filter(k => k.startsWith('KEY_') && p[k] === key).map(k => k.slice(4))[0];
  if (!scope) return json_({ error: 'unauthorized' });
  const ss = SpreadsheetApp.getActive();
  const read = n => { const v = ss.getSheetByName(n).getDataRange().getValues(); return { header: v[0], rows: v.slice(1) }; };
  const b = read('branch_monthly'), m = read('member_monthly');
  const keep = r => scope === 'ALL' || r[0] === scope;
  return json_({
    scope, updatedAt: ss.getSheetByName('collect_log').getLastRow() > 1 ? ss.getSheetByName('collect_log').getRange(ss.getSheetByName('collect_log').getLastRow(), 1).getValue() : null,
    branch: { header: b.header, rows: b.rows.filter(keep) },
    member: { header: m.header, rows: m.rows.filter(keep) },
  });
}
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
