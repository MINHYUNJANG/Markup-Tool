import * as cheerio from 'cheerio';
import Groq from 'groq-sdk';

let _groqClient = null;
const SUPPORTED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function getGroqClient() {
  if (!_groqClient) _groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _groqClient;
}

function mimeFromContentType(ct) {
  const t = (ct || '').split(';')[0].trim().toLowerCase();
  if (SUPPORTED_MIME.has(t)) return t;
  if (t.includes('png')) return 'image/png';
  if (t.includes('gif')) return 'image/gif';
  if (t.includes('webp')) return 'image/webp';
  return 'image/jpeg';
}

async function ocrImage(imageUrl) {
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return '';
    const mediaType = mimeFromContentType(res.headers.get('content-type'));
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString('base64');
    const result = await getGroqClient().chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${b64}` } },
          { type: 'text', text: '이 이미지에 텍스트가 있으면 모두 추출해주세요. 텍스트만 반환하고 설명은 생략하세요. 텍스트가 없으면 빈 문자열을 반환하세요.' },
        ],
      }],
    });
    const text = result.choices[0].message.content.trim();
    if (['빈 문자열', '텍스트가 없습니다', '없음', ''].includes(text)) return '';
    return text;
  } catch { return ''; }
}

const SEMANTIC_SELECTORS = ['main', 'article', '[role="main"]'];
const COMMON_SELECTORS = [
  '#content', '#main', '#article', '#post', '#body',
  '.content', '.main', '.article', '.post', '.view',
  '.view_content', '.view_con', '.board_view', '.board-view',
  '.article-body', '.article_body', '.news_body', '.news-body',
  '.cont_wrap', '.cont-wrap', '.sub_content', '.sub-content',
  '.inner_content', '.inner-content', '.page_content',
  '.bbs_content', '.bbs-content', '.detail_content',
];
const INNER_SELECTORS = [
  '.view_content', '.view_con', '.view-content', '.view-con',
  '.board_view', '.board-view', '.board_content', '.board-content',
  '.detail_content', '.detail-content', '.detail_wrap',
  '.article_body', '.article-body', '.article_content',
  '.cont_inner', '.cont-inner', '.cont_body',
  '.tbl_wrap', '.tblWrap', '.tblTy01', '.tbl_st',
  '.bbs_view', '.bbs-view',
  'td.content', 'td#content',
];
const NOISE_TAGS = ['header', 'nav', 'footer', 'aside'];
const NOISE_ID_CLASS = [
  'header', 'footer', 'gnb', 'lnb', 'snb', 'sidebar',
  'nav', 'navigation', 'menu', 'quick', 'banner', 'ad',
  'location', 'breadcrumb', 'sns', 'snsbox', 'share',
  'print', 'toolbar', 'util', 'floating', 'popup',
];
const SKIP_TAGS = new Set(['nav', 'header', 'footer', 'aside']);
const SKIP_CLASS_KEYWORDS = ['nav', 'header', 'footer', 'aside', 'gnb', 'lnb', 'snb', 'menu', 'sidebar'];
const TITLE_SELECTORS = [
  'h1', '#title_bar', '.title_bar', '.titleBar',
  '.tit', '.title', '.tit1',
  '.view_title', '.view-title', '.cont_title', '.cont-title',
  '.page_title', '.page-title', '.sub_title', '.sub-title',
  '.board_title', '.board-title', 'h2',
];

function elText($, el) {
  return $(el).text().replace(/\s+/g, ' ').trim();
}

function linkText($, el) {
  let t = '';
  $(el).find('a').each((_, a) => { t += $(a).text(); });
  return t;
}

function score($, el) {
  const ft = elText($, el);
  if (!ft) return 0;
  const lt = linkText($, el);
  const lr = lt.length / ft.length;
  const cc = Math.max($(el).find('*').length, 1);
  return ft.length * (1 - lr) / cc;
}

function getTagName($, el) {
  return (($(el).prop('tagName')) || '').toLowerCase();
}

function isSkipNode($, el) {
  if (SKIP_TAGS.has(getTagName($, el))) return true;
  const cls = ($(el).attr('class') || '').toLowerCase();
  return SKIP_CLASS_KEYWORDS.some(kw => cls.includes(kw));
}

function inSkipArea($, el) {
  let cur = $(el).parent()[0];
  while (cur) {
    const tn = getTagName($, cur);
    if (tn === 'body' || tn === 'html') break;
    if (isSkipNode($, cur)) return true;
    cur = $(cur).parent()[0];
  }
  return false;
}

function removeNoise($) {
  NOISE_TAGS.forEach(t => $(t).remove());
  ['div', 'section', 'nav', 'aside', 'ul', 'ol', 'header', 'footer'].forEach(t => {
    $(t).each((_, el) => {
      const id = ($(el).attr('id') || '').toLowerCase();
      const cls = ($(el).attr('class') || '').toLowerCase();
      if (NOISE_ID_CLASS.some(kw => id.includes(kw) || cls.includes(kw))) $(el).remove();
    });
  });
}

function drillDown($, el, depth = 3) {
  if (depth === 0) return el;
  const parentLen = elText($, el).length;
  for (const sel of INNER_SELECTORS) {
    const child = $(el).find(sel).first();
    if (!child.length) continue;
    if (elText($, child[0]).length >= parentLen * 0.4) return drillDown($, child[0], depth - 1);
  }
  let bestChild = null, bestScore = 0;
  $(el).children('div, section, article, td').each((_, child) => {
    const clen = elText($, child).length;
    if (clen < 200) return;
    const lr = linkText($, child).length / Math.max(clen, 1);
    if (lr > 0.5) return;
    const s = score($, child);
    if (s > bestScore) { bestScore = s; bestChild = child; }
  });
  if (bestChild) {
    const cov = elText($, bestChild).length / Math.max(parentLen, 1);
    if (cov >= 0.6) return drillDown($, bestChild, depth - 1);
  }
  return el;
}

function findByTitle($) {
  let titleEl = null;
  for (const sel of TITLE_SELECTORS) {
    $(sel).each((_, el) => {
      if (elText($, el).length < 2) return;
      if (inSkipArea($, el)) return;
      titleEl = el;
      return false;
    });
    if (titleEl) break;
  }
  if (!titleEl) return [null, null];

  const label = `(타이틀 기반: "${elText($, titleEl).slice(0, 20)}")`;

  let sibling = null;
  $(titleEl).siblings().each((_, sib) => {
    const st = elText($, sib);
    if (st.length < 100) return;
    const lr = linkText($, sib).length / Math.max(st.length, 1);
    if (lr < 0.5) { sibling = sib; return false; }
  });
  if (sibling) return [sibling, label];

  let node = $(titleEl).parent()[0];
  while (node) {
    const tn = getTagName($, node);
    if (tn === 'body' || tn === 'html') break;
    if (isSkipNode($, node)) { node = $(node).parent()[0]; continue; }
    const nt = elText($, node);
    const lt = linkText($, node);
    const lr = lt.length / Math.max(nt.length, 1);
    if (nt.length > 200 && lr < 0.4) return [node, label];
    if ($(node).find('img').length > 0 && nt.length - lt.length < 50) return [node, label];
    node = $(node).parent()[0];
  }
  return [$(titleEl).parent()[0], label];
}

function autoDetect($) {
  for (const sel of SEMANTIC_SELECTORS) {
    const el = $(sel).first();
    if (el.length && elText($, el[0]).length > 100) return [el[0], sel];
  }
  for (const sel of COMMON_SELECTORS) {
    const el = $(sel).first();
    if (el.length && elText($, el[0]).length > 100) return [el[0], sel];
  }
  const [el, label] = findByTitle($);
  if (el) return [el, label];

  let bestEl = null, bestScore = 0;
  $('div, section, td').each((_, tag) => {
    const ft = elText($, tag);
    if (ft.length < 200) return;
    const lr = linkText($, tag).length / Math.max(ft.length, 1);
    if (lr > 0.5) return;
    const cc = Math.max($(tag).find('*').length, 1);
    const s = ft.length * (1 - lr) / cc;
    if (s > bestScore) { bestScore = s; bestEl = tag; }
  });
  if (bestEl) return [bestEl, '(자동 감지)'];
  return [null, null];
}

async function getBrowser() {
  const puppeteer = (await import('puppeteer-core')).default;
  if (process.env.NODE_ENV === 'development') {
    const chromePath = process.env.CHROME_PATH ||
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    return puppeteer.launch({ headless: true, executablePath: chromePath });
  }
  const chromium = (await import('@sparticuz/chromium')).default;
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
}

export async function crawl(url, selector = '') {
  let html;
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    html = await page.content();
    await browser.close();
  } catch (e) {
    return { success: false, error: `페이지 로딩 실패: ${e.message}` };
  }

  const $ = cheerio.load(html);
  let element, detectedSelector;

  if (selector) {
    const el = $(selector).first();
    if (!el.length) return { success: false, error: `셀렉터 '${selector}'에 해당하는 요소를 찾을 수 없습니다.` };
    element = el;
    detectedSelector = selector;
  } else {
    removeNoise($);
    const [el, sel] = autoDetect($);
    if (!el) return { success: false, error: '본문 영역을 자동으로 감지하지 못했습니다. CSS 셀렉터를 직접 입력해주세요.' };

    const refined = drillDown($, el);
    element = $(refined);
    if (refined !== el) {
      const cls = $(refined).attr('class');
      const rid = $(refined).attr('id');
      const rlabel = cls
        ? '.' + cls.trim().split(/\s+/).join('.')
        : rid ? '#' + rid : getTagName($, refined);
      detectedSelector = `${sel} → ${rlabel}`;
    } else {
      detectedSelector = sel;
    }
  }

  const imgJobs = [];
  element.find('img').each((_, img) => {
    const src = $(img).attr('src') || $(img).attr('data-src') || '';
    if (!src || src.startsWith('data:')) return;
    try {
      imgJobs.push({ url: new URL(src, url).href, alt: $(img).attr('alt') || '' });
    } catch {}
  });

  const ocrResults = await Promise.all(imgJobs.map(j => ocrImage(j.url)));
  const images = imgJobs
    .map((j, i) => ({ src: j.url, alt: j.alt, ocr_text: ocrResults[i] }))
    .filter(img => img.ocr_text);

  const rawHtml = $.html(element);
  const text = element.text().split('\n').map(l => l.trim()).filter(Boolean).join('\n');

  return { success: true, html: rawHtml, text, images, detected_selector: detectedSelector };
}
