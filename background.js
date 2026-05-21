/**
 * background.js
 * Medical DOC PR Scraper - バックグラウンドサービスワーカー
 *
 * フロー：
 *  1. 一覧ページを全巡回して記事URLを収集
 *  2. 各記事ページに入り医院情報（h2ブロック）を取得
 *  3. chrome.storage.local に随時保存
 */

const BASE_URL   = 'https://medicaldoc.jp/m/recommend-m/';
const MAX_PAGES  = 250;
const LIST_SLEEP = 400;
const ART_SLEEP  = 500;

let state = {
  running: false,
  phase: 'idle',        // idle / list / article / done
  currentPage: 0,
  totalPages: 0,
  articleUrls: [],      // 収集した記事URL
  articlesDone: 0,      // 処理済み記事数
  clinics: [],          // 抽出した医院データ
  errors: [],
};

// ──────────────────────────────────────────
// ユーティリティ
// ──────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function broadcast() {
  chrome.runtime.sendMessage({
    action: 'statusUpdate',
    data: {
      running: state.running,
      phase: state.phase,
      currentPage: state.currentPage,
      totalPages: state.totalPages,
      clinicCount: state.clinics.length,
      articlesDone: state.articlesDone,
      articlesTotal: state.articleUrls.length,
      errors: state.errors.slice(-5),
    },
  }).catch(() => {});
}

function navigateTab(tabId, url) {
  return new Promise((resolve) => {
    chrome.tabs.update(tabId, { url });
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 12000);
  });
}

async function sendToTab(tabId, message, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, message);
      if (res) return res;
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(300);
    }
  }
}

// ──────────────────────────────────────────
// フェーズ1: 一覧ページ巡回 → 記事URL収集
// ──────────────────────────────────────────
async function runListPhase(tabId) {
  state.phase = 'list';
  const urlSet = new Set(state.articleUrls);
  let emptyStreak = 0;

  for (let page = state.currentPage || 1; page <= MAX_PAGES; page++) {
    if (!state.running) break;

    const url = page === 1 ? BASE_URL : `${BASE_URL}page/${page}/`;
    state.currentPage = page;
    broadcast();

    try {
      await navigateTab(tabId, url);
      await sleep(300);

      const res = await sendToTab(tabId, { action: 'scrapeList' });
      if (!res?.success) { emptyStreak++; continue; }

      const { links } = res.data;

      if (!links || links.length === 0) {
        emptyStreak++;
        if (emptyStreak >= 3) { state.totalPages = page - 1; break; }
        continue;
      }
      emptyStreak = 0;

      for (const link of links) {
        const clean = link.split('?')[0].replace(/\/$/, '') + '/';
        if (!urlSet.has(clean)) {
          urlSet.add(clean);
          state.articleUrls.push(clean);
        }
      }

      await saveToStorage();
      await sleep(LIST_SLEEP);

    } catch (e) {
      state.errors.push(`List p${page}: ${e.message}`);
      emptyStreak++;
      await sleep(LIST_SLEEP * 3);
    }
  }
}

// ──────────────────────────────────────────
// フェーズ2: 記事ページ巡回 → 医院情報取得
// ──────────────────────────────────────────
async function runArticlePhase(tabId) {
  state.phase = 'article';
  state.totalPages = state.articleUrls.length;
  const doneUrls = new Set(state.clinics.map(c => c.article_url?.split('?')[0].replace(/\/$/, '') + '/'));

  for (let i = 0; i < state.articleUrls.length; i++) {
    if (!state.running) break;

    const artUrl = state.articleUrls[i];
    if (doneUrls.has(artUrl)) { state.articlesDone = i + 1; continue; }

    state.currentPage = i + 1;
    state.articlesDone = i + 1;
    broadcast();

    try {
      await navigateTab(tabId, artUrl);
      await sleep(300);

      const res = await sendToTab(tabId, { action: 'scrapeArticle' });
      if (res?.success && res.data?.length > 0) {
        state.clinics.push(...res.data);
        doneUrls.add(artUrl);
      } else {
        state.errors.push(`Article: ${artUrl.replace(BASE_URL, '')} - 医院ブロック0件`);
      }

      await saveToStorage();
      await sleep(ART_SLEEP);

    } catch (e) {
      state.errors.push(`Article: ${artUrl.replace(BASE_URL, '')} - ${e.message}`);
      await sleep(ART_SLEEP * 3);
    }
  }
}

// ──────────────────────────────────────────
// メイン
// ──────────────────────────────────────────
async function startScraping(resume = false) {
  if (state.running) return;
  state.running = true;

  if (!resume) {
    await clearStorage();
  } else {
    await loadFromStorage();
  }

  let tab;
  try {
    tab = await chrome.tabs.create({ url: BASE_URL, active: false });
    await sleep(1000);

    // 記事URLがまだない or 再開でない場合は一覧フェーズから
    if (!resume || state.articleUrls.length === 0) {
      await runListPhase(tab.id);
    }

    if (state.running) {
      await runArticlePhase(tab.id);
    }

    state.phase = state.running ? 'done' : 'idle';
    state.running = false;
    await saveToStorage();
    broadcast();

  } catch (e) {
    state.errors.push(`Fatal: ${e.message}`);
    state.running = false;
    state.phase = 'idle';
    broadcast();
  } finally {
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// ──────────────────────────────────────────
// ストレージ
// ──────────────────────────────────────────
async function saveToStorage() {
  await chrome.storage.local.set({
    clinics: state.clinics,
    articleUrls: state.articleUrls,
    articlesDone: state.articlesDone,
    currentPage: state.currentPage,
    phase: state.phase,
    errors: state.errors,
  });
}

async function loadFromStorage() {
  const d = await chrome.storage.local.get(['clinics','articleUrls','articlesDone','currentPage','phase','errors']);
  if (d.clinics)      state.clinics      = d.clinics;
  if (d.articleUrls)  state.articleUrls  = d.articleUrls;
  if (d.articlesDone) state.articlesDone = d.articlesDone;
  if (d.currentPage)  state.currentPage  = d.currentPage;
  if (d.errors)       state.errors       = d.errors;
}

async function clearStorage() {
  await chrome.storage.local.clear();
  state = { running: true, phase: 'idle', currentPage: 0, totalPages: 0,
            articleUrls: [], articlesDone: 0, clinics: [], errors: [] };
}

// ──────────────────────────────────────────
// メッセージハンドラ
// ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.action) {

      case 'start':
        startScraping(false);
        sendResponse({ ok: true });
        break;

      case 'resume':
        startScraping(true);
        sendResponse({ ok: true });
        break;

      case 'stop':
        state.running = false;
        state.phase = 'idle';
        await saveToStorage();
        broadcast();
        sendResponse({ ok: true });
        break;

      case 'getStatus':
        sendResponse({
          running: state.running,
          phase: state.phase,
          currentPage: state.currentPage,
          totalPages: state.totalPages,
          clinicCount: state.clinics.length,
          articlesDone: state.articlesDone,
          articlesTotal: state.articleUrls.length,
          errors: state.errors.slice(-5),
        });
        break;

      case 'getData': {
        if (state.clinics.length > 0) {
          sendResponse({ data: state.clinics });
        } else {
          const saved = await chrome.storage.local.get(['clinics']);
          sendResponse({ data: saved.clinics || [] });
        }
        break;
      }

      case 'loadFromStorage':
        await loadFromStorage();
        sendResponse({ data: state.clinics, articleUrls: state.articleUrls, phase: state.phase });
        break;

      case 'clearData':
        state.running = false;
        await clearStorage();
        state.running = false;
        broadcast();
        sendResponse({ ok: true });
        break;
    }
  })();
  return true;
});
