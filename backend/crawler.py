from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
from urllib.parse import urljoin
import asyncio
import base64
import httpx
import os
from groq import Groq

_client = None
_SUPPORTED_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp"}


def _get_client():
    global _client
    if _client is None:
        _client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    return _client


def _mime_from_content_type(content_type: str) -> str:
    ct = content_type.split(";")[0].strip().lower()
    if ct in _SUPPORTED_MIME:
        return ct
    if "png" in ct:
        return "image/png"
    if "gif" in ct:
        return "image/gif"
    if "webp" in ct:
        return "image/webp"
    return "image/jpeg"


async def _ocr_image(image_url: str) -> str:
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as http:
            response = await http.get(image_url)
            if response.status_code != 200:
                return ""
            media_type = _mime_from_content_type(
                response.headers.get("content-type", "image/jpeg")
            )
            image_data = base64.standard_b64encode(response.content).decode("utf-8")
    except Exception:
        return ""

    try:
        result = _get_client().chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{media_type};base64,{image_data}"},
                    },
                    {
                        "type": "text",
                        "text": "이 이미지에 텍스트가 있으면 모두 추출해주세요. 텍스트만 반환하고 설명은 생략하세요. 텍스트가 없으면 빈 문자열을 반환하세요.",
                    },
                ],
            }],
        )
        text = result.choices[0].message.content.strip()
        if text in ("빈 문자열", "텍스트가 없습니다", "없음", ""):
            return ""
        return text
    except Exception:
        return ""


_SEMANTIC_SELECTORS = [
    "main",
    "article",
    '[role="main"]',
]

_COMMON_SELECTORS = [
    "#content", "#main", "#article", "#post", "#body",
    ".content", ".main", ".article", ".post", ".view",
    ".view_content", ".view_con", ".board_view", ".board-view",
    ".article-body", ".article_body", ".news_body", ".news-body",
    ".cont_wrap", ".cont-wrap", ".sub_content", ".sub-content",
    ".inner_content", ".inner-content", ".page_content",
    ".bbs_content", ".bbs-content", ".detail_content",
]

# 외부 컨테이너 안에서 더 정밀하게 찾는 내부 셀렉터 (우선순위 순)
_INNER_SELECTORS = [
    ".view_content", ".view_con", ".view-content", ".view-con",
    ".board_view", ".board-view", ".board_content", ".board-content",
    ".detail_content", ".detail-content", ".detail_wrap",
    ".article_body", ".article-body", ".article_content",
    ".cont_inner", ".cont-inner", ".cont_body",
    ".tbl_wrap", ".tblWrap", ".tblTy01", ".tbl_st",
    ".bbs_view", ".bbs-view",
    "td.content", "td#content",
]


def _score(el) -> float:
    """링크 비율을 제거한 텍스트 밀도 점수."""
    full_text = el.get_text(strip=True)
    if not full_text:
        return 0
    link_text = "".join(a.get_text(strip=True) for a in el.find_all("a"))
    link_ratio = len(link_text) / len(full_text)
    child_count = max(len(el.find_all(True)), 1)
    return len(full_text) * (1 - link_ratio) / child_count


def _drill_down(el, depth: int = 3):
    """감지된 컨테이너 안에서 더 정확한 본문 영역으로 내려간다."""
    if depth == 0:
        return el

    parent_text_len = len(el.get_text(strip=True))

    # 1) 내부 관용 셀렉터 먼저 시도
    for sel in _INNER_SELECTORS:
        child = el.select_one(sel)
        if not child:
            continue
        child_text_len = len(child.get_text(strip=True))
        # 부모 텍스트의 40% 이상을 담고 있어야 본문으로 인정
        if child_text_len >= parent_text_len * 0.4:
            return _drill_down(child, depth - 1)

    # 2) 텍스트 밀도 재스코어링으로 최적 자식 선택
    best_child, best_score = None, 0
    for child in el.find_all(["div", "section", "article", "td"], recursive=False):
        child_text_len = len(child.get_text(strip=True))
        if child_text_len < 200:
            continue
        link_text = "".join(a.get_text(strip=True) for a in child.find_all("a"))
        link_ratio = len(link_text) / max(child_text_len, 1)
        if link_ratio > 0.5:
            continue
        s = _score(child)
        if s > best_score:
            best_score, best_child = s, child

    # 자식이 부모 텍스트의 60% 이상을 커버하면 내려가기
    if best_child:
        coverage = len(best_child.get_text(strip=True)) / max(parent_text_len, 1)
        if coverage >= 0.6:
            return _drill_down(best_child, depth - 1)

    return el


_TITLE_SELECTORS = [
    "h1",
    "#title_bar", ".title_bar", ".titleBar",
    ".tit", ".title", ".tit1",
    ".view_title", ".view-title", ".cont_title", ".cont-title",
    ".page_title", ".page-title", ".sub_title", ".sub-title",
    ".board_title", ".board-title",
    "h2",
]

_SKIP_TAGS = {"nav", "header", "footer", "aside"}
_SKIP_CLASS_KEYWORDS = {"nav", "header", "footer", "aside", "gnb", "lnb", "snb", "menu", "sidebar"}


def _is_skip_node(node) -> bool:
    if node.name in _SKIP_TAGS:
        return True
    classes = " ".join(node.get("class", []))
    return any(kw in classes.lower() for kw in _SKIP_CLASS_KEYWORDS)


def _in_skip_area(el) -> bool:
    """요소가 nav/menu 등 건너뛸 영역 안에 있는지 확인."""
    for ancestor in el.parents:
        if ancestor.name in ("body", "html"):
            break
        if _is_skip_node(ancestor):
            return True
    return False


def _find_by_title(soup: BeautifulSoup):
    """페이지 타이틀을 찾고, DOM을 위로 올라가며 본문 컨테이너를 추정."""
    title_el = None
    for sel in _TITLE_SELECTORS:
        for el in soup.select(sel):
            if len(el.get_text(strip=True)) < 2:
                continue
            # nav/menu 내부 타이틀은 건너뜀
            if _in_skip_area(el):
                continue
            title_el = el
            break
        if title_el:
            break

    if not title_el:
        return None, None

    label = f"(타이틀 기반: \"{title_el.get_text(strip=True)[:20]}\")"

    # 타이틀의 형제 노드 중 본문 컨테이너 먼저 탐색
    for sibling in title_el.parent.children if title_el.parent else []:
        if not hasattr(sibling, "get_text") or sibling is title_el:
            continue
        sib_text = sibling.get_text(strip=True)
        if len(sib_text) < 100:
            continue
        link_text = "".join(a.get_text(strip=True) for a in sibling.find_all("a"))
        link_ratio = len(link_text) / max(len(sib_text), 1)
        if link_ratio < 0.5:
            return sibling, label

    # 타이틀에서 위로 올라가며 적합한 컨테이너 탐색
    node = title_el.parent
    while node and node.name not in ("body", "html", "[document]"):
        if _is_skip_node(node):
            node = node.parent
            continue

        node_text = node.get_text(strip=True)
        node_imgs = len(node.find_all("img"))
        link_text = "".join(a.get_text(strip=True) for a in node.find_all("a"))
        link_ratio = len(link_text) / max(len(node_text), 1)

        # 텍스트 기반 본문
        if len(node_text) > 200 and link_ratio < 0.4:
            return node, label

        # 이미지 기반 본문 (텍스트는 거의 없고 이미지가 존재)
        non_link_text_len = len(node_text) - len(link_text)
        if node_imgs > 0 and non_link_text_len < 50:
            return node, label

        node = node.parent

    return title_el.parent, label


_NOISE_TAGS = ["header", "nav", "footer", "aside"]
_NOISE_ID_CLASS = {"header", "footer", "gnb", "lnb", "snb", "sidebar",
                   "nav", "navigation", "menu", "quick", "banner", "ad",
                   "location", "breadcrumb", "sns", "snsbox", "share",
                   "print", "toolbar", "util", "floating", "popup"}


def _remove_noise(soup: BeautifulSoup):
    """자동 감지 전 header/nav/footer/aside 등 불필요 영역을 제거."""
    # 시맨틱 태그 제거
    for tag in soup.find_all(_NOISE_TAGS):
        tag.decompose()

    # ID/클래스 패턴 제거 — 구조적 컨테이너에만 적용 (h1~h6, p 등 콘텐츠 태그는 제외)
    _CONTAINER_TAGS = {"div", "section", "nav", "aside", "ul", "ol", "header", "footer"}
    for tag in soup.find_all(_CONTAINER_TAGS):
        if tag.parent is None:
            continue
        el_id = tag.get("id", "").lower()
        el_cls = " ".join(tag.get("class", [])).lower()
        if any(kw in el_id or kw in el_cls for kw in _NOISE_ID_CLASS):
            tag.decompose()


def _auto_detect(soup: BeautifulSoup):
    """본문 영역을 4단계 휴리스틱으로 자동 탐지합니다."""

    # 1단계: 시맨틱 태그
    for sel in _SEMANTIC_SELECTORS:
        el = soup.select_one(sel)
        if el and len(el.get_text(strip=True)) > 100:
            return el, sel

    # 2단계: 관용적 ID/클래스 패턴
    for sel in _COMMON_SELECTORS:
        el = soup.select_one(sel)
        if el and len(el.get_text(strip=True)) > 100:
            return el, sel

    # 3단계: 타이틀 기반 탐지 (텍스트 밀도보다 정확)
    el, label = _find_by_title(soup)
    if el:
        return el, label

    # 4단계: 텍스트 밀도 스코어링 (최후 수단)
    best_el, best_score = None, 0
    for tag in soup.find_all(["div", "section", "td"]):
        full_text = tag.get_text(strip=True)
        if len(full_text) < 200:
            continue
        link_text = "".join(a.get_text(strip=True) for a in tag.find_all("a"))
        link_ratio = len(link_text) / max(len(full_text), 1)
        if link_ratio > 0.5:
            continue
        child_count = max(len(tag.find_all(True)), 1)
        score = len(full_text) * (1 - link_ratio) / child_count
        if score > best_score:
            best_score, best_el = score, tag

    if best_el:
        return best_el, "(자동 감지)"

    return None, None


async def crawl(url: str, selector: str = "") -> dict:
    """
    url: 크롤링할 페이지 URL
    selector: CSS 셀렉터 (비워두면 자동 감지)
    """
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            context = await browser.new_context(ignore_https_errors=True)
            page = await context.new_page()
            await page.goto(url, wait_until="networkidle")
            html = await page.content()
            await browser.close()
    except Exception as e:
        return {"success": False, "error": f"페이지 로딩 실패: {str(e)}"}

    soup = BeautifulSoup(html, "html.parser")

    if selector:
        element = soup.select_one(selector)
        if not element:
            return {"success": False, "error": f"셀렉터 '{selector}'에 해당하는 요소를 찾을 수 없습니다."}
        detected_selector = selector
    else:
        _remove_noise(soup)
        element, detected_selector = _auto_detect(soup)
        if not element:
            return {"success": False, "error": "본문 영역을 자동으로 감지하지 못했습니다. CSS 셀렉터를 직접 입력해주세요."}
        refined = _drill_down(element)
        if refined is not element:
            cls = refined.get("class", [])
            rid = refined.get("id", "")
            label = ("." + ".".join(cls)) if cls else (("#" + rid) if rid else refined.name)
            detected_selector = f"{detected_selector} → {label}"
            element = refined

    img_tags = element.find_all("img")

    img_jobs = []
    for img in img_tags:
        src = img.get("src") or img.get("data-src") or ""
        if not src or src.startswith("data:"):
            continue
        abs_url = urljoin(url, src)
        img_jobs.append((abs_url, img.get("alt", "")))

    ocr_results = await asyncio.gather(*[_ocr_image(u) for u, _ in img_jobs])

    images = [
        {"src": u, "alt": alt, "ocr_text": text}
        for (u, alt), text in zip(img_jobs, ocr_results)
        if text
    ]

    return {
        "success": True,
        "html": str(element),
        "text": element.get_text(separator="\n", strip=True),
        "images": images,
        "detected_selector": detected_selector,
    }
