import os
import httpx
from groq import Groq, APIStatusError

_client = None

# TPM 높은 순으로 정렬
_MODELS = [
    "llama-3.3-70b-versatile",  # 품질 우선
    "llama3-70b-8192",          # 폴백 1순위
    "llama-3.1-8b-instant",     # 폴백 2순위
]

_CEREBRAS_MODELS = [
    "llama-3.3-70b",
    "llama3.1-8b",
]

_MAX_CHARS = 12000  # 안전한 입력 길이 상한 (~3000 tokens)


def _truncate_messages(messages: list, max_chars: int) -> list:
    """마지막 user 메시지가 너무 길면 잘라냅니다."""
    result = []
    for msg in messages:
        if msg["role"] == "user" and len(msg["content"]) > max_chars:
            result.append({**msg, "content": msg["content"][:max_chars] + "\n\n[내용이 너무 길어 일부 생략됨]"})
        else:
            result.append(msg)
    return result


def _cerebras_chat(messages: list, max_tokens: int = 8192) -> str:
    """Cerebras API로 요청. Groq 쿼터 소진 시 폴백."""
    api_key = os.getenv("CEREBRAS_API_KEY")
    if not api_key:
        raise RuntimeError("CEREBRAS_API_KEY가 설정되지 않았습니다.")

    last_error = None
    for model in _CEREBRAS_MODELS:
        for msgs in [messages, _truncate_messages(messages, _MAX_CHARS)]:
            try:
                resp = httpx.post(
                    "https://api.cerebras.ai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={"model": model, "messages": msgs, "max_tokens": max_tokens},
                    timeout=120,
                )
                resp.raise_for_status()
                return resp.json()["choices"][0]["message"]["content"]
            except httpx.HTTPStatusError as e:
                last_error = e
                if e.response.status_code in (429, 413):
                    break
                raise

    raise RuntimeError(f"Cerebras 모든 모델에서 실패했습니다.\n({last_error})")


def _chat(messages: list, max_tokens: int = 8192) -> str:
    """Groq API를 사용하여 메시지를 처리합니다."""
    client = _get_client()
    last_error = None

    for model in _MODELS:
        for msgs in [messages, _truncate_messages(messages, _MAX_CHARS)]:
            try:
                result = client.chat.completions.create(
                    model=model,
                    max_tokens=max_tokens,
                    messages=msgs,
                )
                return result.choices[0].message.content
            except APIStatusError as e:
                last_error = e
                if e.status_code in (429, 413):
                    break  # 이 모델은 포기, 다음 모델로
                if e.status_code == 400 and "decommissioned" in str(e):
                    break  # 폐기된 모델, 다음 모델로
                raise

    raise RuntimeError(f"모든 모델에서 실패했습니다. 잠시 후 다시 시도해주세요.\n({last_error})")

_SYSTEM_TEMPLATE = "당신은 HTML 마크업 전문가입니다. 사용자가 제공하는 HTML 템플릿에 크롤링된 데이터를 적절히 배치하여 완성된 HTML을 반환합니다. 반드시 완성된 HTML 코드만 반환하고, 설명은 생략하세요."

_SYSTEM_AUTO = """당신은 HTML 마크업 전문가입니다.
원문 텍스트를 아래 규칙에 따라 정확히 마크업하여 HTML 소스만 반환합니다. 설명·주석·코드블록 없이 HTML만 출력하세요.

[마크업 규칙]
1. 타이틀은 레벨에 따라 순서대로:
   <h2 class="tit1"></h2>
   <h3 class="tit2"></h3>
   <h4 class="tit3"></h4>

2. 타이틀 하위 내용은 <div class="indent"></div>로 감싸서 들여쓰기

3. 일반 텍스트는 <p></p>

4. 일반 리스트(순서 없음)는 레벨에 따라:
   <ul class="list_st1"></ul>
   <ul class="list_st2"></ul>
   <ul class="list_st3"></ul>
   하위 리스트는 상위 <li> 안에 넣기

5. 숫자가 있는 순서 리스트는:
   <ol class="list_ol1"></ol>
   <ol class="list_ol2"></ol>
   숫자는 <span class="num">1</span> 형식으로 작성
   ①②③ 같은 원문자는 1, 2, 3으로 변환
   숫자 뒤 '.', ',' 등 구두점 제거

6. ○, -, ※ 등 특수문자로 시작하는 리스트 항목은 해당 특수문자 제거 후 <li>에 넣기

7. 테이블:
   - 원본 테이블 HTML이 제공된 경우 그 구조(thead/tbody/th/td/colspan/rowspan 등)를 그대로 유지
   - 반드시 아래 래퍼로 감싸기:
   <div class="tbl_st scroll_gr" tabindex="0">
     <table>
       <caption>테이블 제목</caption>
       <colgroup><col><col>...</colgroup>
       <thead>...</thead>
       <tbody>...</tbody>
     </table>
   </div>
   - td 안에 리스트가 들어가는 경우 해당 td에 class="al" 추가
   - 기존 table 태그의 불필요한 속성(border, cellpadding, style 등)은 제거

8. 개인정보 처리절차 내용은:
   <div class="box_st2"><p class="rsp_img ac"><img src="/00_common/images/sub_com/img_personal1.png" alt=""></p></div>

9. 첫 부분에 "~바랍니다.", "~해주세요" 형태의 공지 문구가 있으면 <div class="box_st2">로 감싸기

10. 원문 텍스트는 절대 수정하지 말 것 (오타 포함 그대로 유지)
    - 단어 하나도 바꾸거나 고치지 말 것
    - 내용을 요약·축약·생략하지 말 것
    - 문단·항목의 순서를 임의로 바꾸지 말 것
    - 원문에 없는 내용을 추가하지 말 것
    - 원문의 모든 텍스트가 빠짐없이 출력에 포함되어야 함

11. section, div로 묶지 말 것 (규칙에 명시된 div 클래스 제외)

12. 모든 소스는 탭(\\t) 들여쓰기로 작성

13. 너무 길면 적당한 크기로 나눠서 제공하되, 계속 물어보지 말고 알아서 나눠서 제공"""


_SYSTEM_EDIT = """당신은 HTML 마크업 전문가입니다.
사용자가 제공하는 HTML 코드를 지시사항에 따라 수정하여 완성된 HTML 소스만 반환합니다.
설명·주석·코드블록 없이 HTML만 출력하세요.
원문 텍스트는 절대 수정하지 마세요. 요약·축약·생략·순서 변경·내용 추가 금지. 모든 원문 텍스트가 빠짐없이 출력에 포함되어야 합니다."""


def _get_client():
    global _client
    if _client is None:
        _client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    return _client


def edit_markup(html: str, instruction: str) -> str:
    prompt = f"""다음 HTML을 아래 지시사항에 따라 수정해주세요.

[지시사항]
{instruction}

[HTML]
{html}"""
    result = _chat([
        {"role": "system", "content": _SYSTEM_EDIT},
        {"role": "user", "content": prompt},
    ])
    return _post_process_markup(result)


def map_to_template(template_html: str, crawled_data: dict) -> str:
    images = crawled_data.get("images", [])
    image_section = ""
    if images:
        lines = []
        for img in images:
            lines.append(
                f"- src: {img.get('src', '')}\n  alt: {img.get('alt', '')}\n  OCR 텍스트: {img.get('ocr_text', '')}"
            )
        image_section = "\n\n이미지 OCR 결과:\n" + "\n".join(lines)

    prompt = f"""다음 HTML 템플릿에 크롤링된 데이터를 배치해주세요.

[HTML 템플릿]
{template_html}

[크롤링된 데이터]
텍스트:
{crawled_data['text']}{image_section}

원본 HTML:
{crawled_data['html']}

템플릿의 구조를 유지하면서 크롤링된 데이터를 적절한 위치에 배치한 완성된 HTML을 반환해주세요."""

    return _chat([
        {"role": "system", "content": _SYSTEM_TEMPLATE},
        {"role": "user", "content": prompt},
    ])


def _clean_html(html: str) -> str:
    """불필요한 속성·스크립트·스타일을 제거해 토큰을 줄입니다."""
    from bs4 import BeautifulSoup, Comment
    import re

    soup = BeautifulSoup(html, "html.parser")

    # script, style, 주석 제거
    for tag in soup(["script", "style"]):
        tag.decompose()
    for comment in soup.find_all(string=lambda t: isinstance(t, Comment)):
        comment.extract()

    # 불필요한 속성 제거 (구조에 필요한 것만 유지)
    keep_attrs = {"colspan", "rowspan", "scope", "headers", "class", "id", "href", "src", "alt"}
    for tag in soup.find_all(True):
        attrs_to_remove = [a for a in list(tag.attrs) if a not in keep_attrs]
        for a in attrs_to_remove:
            del tag[a]

    # 연속 공백·줄바꿈 정리
    result = str(soup)
    result = re.sub(r"\n\s*\n", "\n", result)
    result = re.sub(r"[ \t]+", " ", result)
    return result.strip()


def auto_markup(crawled_data: dict) -> str:
    from bs4 import BeautifulSoup

    raw_html = crawled_data.get("html", "")
    text = crawled_data.get("text", "")

    soup = BeautifulSoup(raw_html, "html.parser")
    has_table = bool(soup.find("table"))

    images = crawled_data.get("images", [])
    ocr_section = ""
    if images:
        ocr_lines = [img["ocr_text"] for img in images if img.get("ocr_text")]
        if ocr_lines:
            ocr_section = "\n\n[이미지 OCR 텍스트]\n" + "\n".join(ocr_lines)

    if has_table:
        cleaned = _clean_html(raw_html)
        content = (
            "다음 원본 HTML을 마크업 규칙에 따라 변환해주세요.\n"
            "테이블은 반드시 원본 구조(th, td, rowspan, colspan 등)를 그대로 유지하고 규칙의 래퍼 클래스만 적용하세요.\n"
            "테이블을 절대 리스트나 p 태그로 변환하지 마세요.\n"
            "원문 텍스트는 절대 수정·요약·생략·재배치하지 말고 모든 내용을 빠짐없이 그대로 출력하세요.\n\n"
            f"[원본 HTML]\n{cleaned}{ocr_section}"
        )
    else:
        content = (
            "다음 원문을 마크업해주세요.\n"
            "원문 텍스트는 절대 수정·요약·생략·재배치하지 말고 모든 내용을 빠짐없이 그대로 출력하세요.\n\n"
            f"{text}{ocr_section}"
        )

    return _post_process_markup(_chat([
        {"role": "system", "content": _SYSTEM_AUTO},
        {"role": "user", "content": content},
    ]))


def _post_process_markup(html: str) -> str:
    """AI 생성 결과를 후처리: 테이블 colgroup 자동 생성, td/th 내 불필요 태그 제거."""
    from bs4 import BeautifulSoup, NavigableString
    import re

    soup = BeautifulSoup(html, "html.parser")

    for table in soup.find_all("table"):
        # 1) 컬럼 수 계산 (colspan 반영, 전체 행 중 최대값)
        max_cols = 0
        for row in table.find_all("tr"):
            col_count = sum(int(c.get("colspan", 1)) for c in row.find_all(["td", "th"]))
            max_cols = max(max_cols, col_count)

        if max_cols > 0:
            # 기존 colgroup 제거 후 새로 삽입
            for cg in table.find_all("colgroup"):
                cg.decompose()
            width = round(100 / max_cols, 2)
            colgroup = soup.new_tag("colgroup")
            for _ in range(max_cols):
                col = soup.new_tag("col")
                col["style"] = f"width:{width}%"
                colgroup.append(col)
            table.insert(0, colgroup)

        # 2) td/th 내 불필요한 태그 제거
        for cell in table.find_all(["td", "th"]):
            # <p> 언래핑 (내용은 유지)
            for p in cell.find_all("p"):
                p.unwrap()
            # class 없는 <span> 언래핑
            for span in cell.find_all("span"):
                if not span.get("class"):
                    span.unwrap()

    result = re.sub(r"[ \t]{2,}", " ", str(soup))
    return _tab_indent(result)


def _tab_indent(html: str) -> str:
    """HTML 문자열에 탭 들여쓰기를 적용합니다."""
    import re

    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input",
            "link", "meta", "param", "source", "track", "wbr"}
    INLINE = {"a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data",
              "dfn", "em", "i", "kbd", "mark", "q", "rp", "rt", "ruby",
              "s", "samp", "small", "span", "strong", "sub", "sup", "time",
              "u", "var", "wbr"}

    tokens = re.findall(r'(<!--.*?-->|<[^>]+>|[^<]+)', html, re.DOTALL)
    lines = []
    depth = 0

    for token in tokens:
        stripped = token.strip()
        if not stripped:
            continue

        # 닫는 태그
        if re.match(r'^</', stripped):
            depth = max(0, depth - 1)
            lines.append("\t" * depth + stripped)
            continue

        # 주석
        if stripped.startswith("<!--"):
            lines.append("\t" * depth + stripped)
            continue

        # 여는 태그
        tag_match = re.match(r'^<(\w+)', stripped)
        if tag_match:
            tag_name = tag_match.group(1).lower()
            if tag_name in VOID or stripped.endswith("/>"):
                lines.append("\t" * depth + stripped)
            elif tag_name in INLINE:
                # 인라인 태그는 이전 줄에 붙이거나 그대로
                lines.append("\t" * depth + stripped)
                depth += 1
            else:
                lines.append("\t" * depth + stripped)
                depth += 1
            continue

        # 텍스트 노드
        text = stripped
        if text:
            lines.append("\t" * depth + text)

    return "\n".join(lines)
