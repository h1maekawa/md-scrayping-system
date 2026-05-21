/**
 * content.js v4.0
 *
 * PR判定方法：
 *   各医院ブロック（.clinic_article）自身、またはその見出し（h2）にクラス名「pu」が付与されているか判定。
 *   「pu」クラスが付与されている → PR医院
 *   それ以外 → 通常掲載（スキップ）
 *
 * ※ IDの接頭辞が「clinic-2001」であることによる判定は不正確であるため（通常医院でも2001で始まるものがあり、
 *    通常IDのPR医院も存在するため）、CSS設計に基づく「pu」クラス判定に変更。
 */

// ──────────────────────────────────────────
// 一覧ページ → 記事URLを収集
// ──────────────────────────────────────────
function scrapeListPage() {
  const links = [];
  const seen  = new Set();

  // パターン1: アーカイブリスト
  document.querySelectorAll('a[href*="/recommend-m/"]').forEach(a => {
    const url = a.href.split('?')[0].split('#')[0];
    // /recommend-m/ 自体やページネーションは除外
    if (
      !url ||
      seen.has(url) ||
      url.endsWith('/recommend-m/') ||
      url.includes('/recommend-m/page/') ||
      url.includes('?') ||
      url.includes('#')
    ) return;
    seen.add(url);
    links.push(url);
  });

  return { links };
}

// ──────────────────────────────────────────
// 記事ページ → PR医院ブロックのみ抽出
// ──────────────────────────────────────────
function scrapeArticlePage() {
  const clinics      = [];
  const articleUrl   = location.href.split('?')[0];
  const articleTitle = document.querySelector('h1')?.innerText?.trim() || document.title;

  // 医院ブロック：id="clinic-XXXXXX" のセクション
  const clinicSections = document.querySelectorAll('[id^="clinic-"]');

  clinicSections.forEach(section => {
    const clinicId = section.id; // 例: "clinic-2001078774"

    // ── 医院名（直近のh2）の取得 ────────────────────
    let clinicName = '';
    let targetH2 = null;
    // sectionがh2より後にある場合、直前のh2を探す
    let el = section;
    while (el) {
      el = el.previousElementSibling;
      if (!el) break;
      if (el.tagName === 'H2') {
        targetH2 = el;
        break;
      }
    }
    // sectionがh2自体か、sectionの内側にh2がある場合
    if (!targetH2) {
      targetH2 = section.querySelector('h2')
        || section.closest('section, div')?.querySelector('h2');
    }

    if (targetH2) {
      // 見出しの中にある最初の span もしくは a タグのテキスト（地域名「（見沼区）」等を除いた純粋な医院名）を優先取得
      const nameEl = targetH2.querySelector('span, a');
      if (nameEl) {
        clinicName = nameEl.innerText.trim();
      } else {
        clinicName = targetH2.innerText.trim();
      }
      // 末尾のカッコ表記（例：「（箕面市桜ヶ丘）」や「(見沼区)」）が残っている場合は除去
      clinicName = clinicName.replace(/[（\(][^）\)]*[）\)]$/, '').trim();
    }

    // ── PR判定 ──────────────────────────────
    // .clinic_article（section）にクラス名「pu」があるか、
    // またはその見出し（targetH2）にクラス名「pu」がある場合のみPR医院とする
    const isPR = section.classList.contains('pu') || (targetH2 && targetH2.classList.contains('pu'));
    if (!isPR) return; // 通常掲載はスキップ

    // ── 以降、sectionの兄弟要素から情報取得 ────
    // sectionからh2（次の医院）まで集める
    const blocks = [section];
    let next = section.nextElementSibling;
    while (next && next.tagName !== 'H2' && !next.id?.startsWith('clinic-')) {
      blocks.push(next);
      next = next.nextElementSibling;
    }
    const blockText = blocks.map(b => b.innerText || '').join('\n');

    // 住所
    let address = '';
    const addressMatch = blockText.match(/[東西南北]?(?:東京都|北海道|(?:大阪|京都)府|.{2,3}県).{2,40}[0-9０-９\-－―]/);
    if (addressMatch) address = addressMatch[0].trim();

    // 電話番号
    const telEl = blocks.reduce((f, b) => f || b.querySelector('a[href^="tel:"]'), null);
    let tel = telEl ? telEl.href.replace('tel:', '').trim() : '';
    if (!tel) {
      const telMatch = blockText.match(/(\d{2,4}[-－]\d{2,4}[-－]\d{3,4})/);
      tel = telMatch ? telMatch[1] : '';
    }

    // アクセス（駅）
    const accessLines = blockText.split('\n').filter(l =>
      l.match(/(?:駅|バス停).{0,15}(?:徒歩|分|出口)/)
    );
    const access = accessLines.slice(0, 3).join(' / ').trim();

    // 診療時間（テーブル優先）
    let hours = '';
    const tblEl = blocks.reduce((f, b) => f || b.querySelector('table'), null);
    if (tblEl) hours = tblEl.innerText.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!hours) {
      const hoursMatch = blockText.match(/(?:診療時間|受付時間)[^\n]*/);
      hours = hoursMatch ? hoursMatch[0].trim() : '';
    }

    // ホームページ
    const hpEl = blocks.reduce((f, b) => {
      if (f) return f;
      return Array.from(b.querySelectorAll('a')).find(a =>
        a.innerText.includes('ホームページ') || a.innerText.includes('公式サイト')
      );
    }, null);
    const website = hpEl?.href || '';

    // 画像（最初のimg）
    const imgEl = blocks.reduce((f, b) => f || b.querySelector('img[src*="medicaldoc"]'), null);
    const image = imgEl?.src || '';

    // GoogleMap
    const mapEl = blocks.reduce((f, b) => f || b.querySelector('iframe[src*="google.com/maps"]'), null);
    const mapUrl = mapEl?.src || '';

    clinics.push({
      clinic_id:     clinicId,
      clinic_name:   clinicName,
      article_title: articleTitle,
      article_url:   articleUrl,
      address,
      tel,
      access,
      hours,
      website,
      image,
      map_url:       mapUrl,
      is_pr:         true,
    });
  });

  return clinics;
}

// ──────────────────────────────────────────
// メッセージリスナー
// ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scrapeList') {
    setTimeout(() => {
      try {
        sendResponse({ success: true, data: scrapeListPage() });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    }, 800);
    return true;
  }

  if (message.action === 'scrapeArticle') {
    setTimeout(() => {
      try {
        const clinics = scrapeArticlePage();
        sendResponse({ success: true, data: clinics });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    }, 1000);
    return true;
  }
});
