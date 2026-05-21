/**
 * popup.js  v2.1
 * - 起動時にストレージから直接データ読み込み → CSV/JSONボタン即時有効化
 * - Service Worker停止中でもダウンロード可能
 */

const statusBadge    = document.getElementById('statusBadge');
const statusText     = document.getElementById('statusText');
const clinicCountEl  = document.getElementById('clinicCount');
const articlesDoneEl = document.getElementById('articlesDone');
const articlesTotalEl= document.getElementById('articlesTotal');
const progressWrap   = document.getElementById('progressWrap');
const progressFill   = document.getElementById('progressFill');
const progressPct    = document.getElementById('progressPct');
const progressLabel  = document.getElementById('progressLabel');
const phaseText      = document.getElementById('phaseText');
const errorBox       = document.getElementById('errorBox');
const previewList    = document.getElementById('previewList');
const btnStart       = document.getElementById('btnStart');
const btnResume      = document.getElementById('btnResume');
const btnStop        = document.getElementById('btnStop');
const btnCsv         = document.getElementById('btnCsv');
const btnJson        = document.getElementById('btnJson');
const btnClear       = document.getElementById('btnClear');
const startGroup     = document.getElementById('startGroup');
const stopGroup      = document.getElementById('stopGroup');

// ──────────────────────────────────────────
// ストレージから直接読む（SW停止中も動く）
// ──────────────────────────────────────────
async function loadDataFromStorage() {
  const d = await chrome.storage.local.get(['clinics','articleUrls','articlesDone','phase','errors']);
  return {
    clinics:      d.clinics       || [],
    articleUrls:  d.articleUrls   || [],
    articlesDone: d.articlesDone  || 0,
    phase:        d.phase         || 'idle',
    errors:       d.errors        || [],
  };
}

// ──────────────────────────────────────────
// UI更新
// ──────────────────────────────────────────
function updateUI(s, clinics) {
  const running = s.running || false;
  const phase   = s.phase   || 'idle';
  const articlesTotal = s.articlesTotal || s.articleUrls?.length || 0;
  const articlesDone  = s.articlesDone  || 0;
  const clinicCount   = clinics?.length ?? s.clinicCount ?? 0;

  statusBadge.className = `status-badge ${running ? 'running' : phase === 'done' ? 'done' : 'idle'}`;
  statusText.textContent =
    running && phase === 'list'    ? '一覧URL収集中...' :
    running && phase === 'article' ? '記事解析中...'   :
    phase   === 'done'             ? '完了'            : '待機中';

  clinicCountEl.textContent   = clinicCount;
  articlesDoneEl.textContent  = articlesDone;
  articlesTotalEl.textContent = articlesTotal;

  if (running && articlesTotal > 0 && phase === 'article') {
    progressWrap.style.display = 'block';
    const pct = Math.min(100, Math.round((articlesDone / articlesTotal) * 100));
    progressFill.style.width = pct + '%';
    progressPct.textContent  = pct + '%';
    progressLabel.textContent= '記事解析進捗';
  } else if (running && phase === 'list') {
    progressWrap.style.display = 'block';
    progressFill.style.width = '5%';
    progressPct.textContent  = '-';
    progressLabel.textContent= '一覧URL収集中';
  } else {
    progressWrap.style.display = 'none';
  }

  phaseText.textContent =
    phase === 'list'    ? `📄 一覧ページ巡回中 (${s.currentPage || '-'} ページ目)` :
    phase === 'article' ? `🔍 記事解析中 ${articlesDone}/${articlesTotal} 件` :
    phase === 'done'    ? `✅ 完了 — ${clinicCount} 医院取得` : '';

  const errs = s.errors || [];
  if (errs.length > 0) {
    errorBox.innerHTML = errs.map(e => `<div>⚠ ${e}</div>`).join('');
    errorBox.classList.add('has-errors');
  } else {
    errorBox.classList.remove('has-errors');
  }

  startGroup.style.display = running ? 'none' : 'grid';
  stopGroup.style.display  = running ? 'grid' : 'none';
}

function updatePreview(clinics) {
  // データがあれば常にCSV/JSONを有効化
  const hasData = clinics && clinics.length > 0;
  btnCsv.disabled  = !hasData;
  btnJson.disabled = !hasData;

  if (!hasData) {
    previewList.innerHTML = '<div class="preview-empty">データがありません</div>';
    return;
  }
  const recent = clinics.slice(-5).reverse();
  previewList.innerHTML = recent.map(c => `
    <div class="preview-item">
      <div class="pname">${c.clinic_name || '(名称不明)'}</div>
      <div class="psub">${c.address || c.article_title || ''}</div>
    </div>
  `).join('');
}

// ──────────────────────────────────────────
// background通信（SW停止中は失敗してもOK）
// ──────────────────────────────────────────
const bg = (action, extra = {}) =>
  chrome.runtime.sendMessage({ action, ...extra }).catch(() => null);

// ──────────────────────────────────────────
// 定期リフレッシュ
// ──────────────────────────────────────────
async function refresh() {
  // まずストレージから直接読む（SW停止中でも機能する）
  const stored = await loadDataFromStorage();

  // SWが生きていればステータスも取得
  const swStatus = await bg('getStatus') || {};

  updateUI({ ...stored, ...swStatus }, stored.clinics);
  updatePreview(stored.clinics);
}

// ──────────────────────────────────────────
// CSV/JSON生成
// ──────────────────────────────────────────
function toCsv(clinics) {
  const headers = ['医院名','記事タイトル','記事URL','住所','電話番号','診療時間','アクセス','ホームページ','画像URL','GoogleMap'];
  const rows = clinics.map(c => [
    c.clinic_name   || '',
    c.article_title || '',
    c.article_url   || '',
    c.address       || '',
    c.tel           || '',
    c.hours         || '',
    c.access        || '',
    c.website       || '',
    c.image         || '',
    c.map_url       || '',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  return '\uFEFF' + [headers.join(','), ...rows].join('\n');
}

function download(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ──────────────────────────────────────────
// イベント
// ──────────────────────────────────────────
btnStart.addEventListener('click',  () => { bg('start');  refresh(); });
btnResume.addEventListener('click', () => { bg('resume'); refresh(); });
btnStop.addEventListener('click',   async () => { await bg('stop'); refresh(); });

btnCsv.addEventListener('click', async () => {
  // ストレージから直接取得（SWに依存しない）
  const { clinics } = await loadDataFromStorage();
  if (!clinics.length) return alert('データがありません');
  const date = new Date().toISOString().slice(0, 10);
  download(toCsv(clinics), `medicaldoc_clinics_${date}.csv`, 'text/csv;charset=utf-8');
});

btnJson.addEventListener('click', async () => {
  const { clinics } = await loadDataFromStorage();
  if (!clinics.length) return alert('データがありません');
  const date = new Date().toISOString().slice(0, 10);
  download(JSON.stringify(clinics, null, 2), `medicaldoc_clinics_${date}.json`, 'application/json');
});

btnClear.addEventListener('click', async () => {
  if (!confirm('取得済みデータをすべて削除しますか？')) return;
  await chrome.storage.local.clear();
  await bg('clearData');
  refresh();
});

chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === 'statusUpdate') refresh();
});

// 起動時：即座にストレージ読み込み
(async () => {
  await refresh();
  setInterval(refresh, 800);
})();
