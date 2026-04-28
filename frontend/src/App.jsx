import { useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_URL
const DEV_MOCK = false

const MOCK_CRAWL = {
  success: true,
  text: '개인정보 처리방침\n\n제1조 (개인정보의 처리 목적)\n회사는 다음의 목적을 위하여 개인정보를 처리합니다.\n\n① 서비스 제공\n② 회원 관리\n③ 마케팅 활용\n\n제2조 (개인정보의 처리 및 보유 기간)\n이용자의 개인정보는 수집·이용 목적이 달성된 후에는 해당 정보를 지체 없이 파기합니다.',
  html: '<h1>개인정보 처리방침</h1><h2>제1조 (개인정보의 처리 목적)</h2><p>회사는 다음의 목적을 위하여 개인정보를 처리합니다.</p><ol><li>서비스 제공</li><li>회원 관리</li><li>마케팅 활용</li></ol><h2>제2조 (개인정보의 처리 및 보유 기간)</h2><p>이용자의 개인정보는 수집·이용 목적이 달성된 후에는 해당 정보를 지체 없이 파기합니다.</p>',
  images: [],
}

const MOCK_MARKUP = `<h2 class="tit1">개인정보 처리방침</h2>
<h3 class="tit2">제1조 (개인정보의 처리 목적)</h3>
<div class="indent">
\t<p>회사는 다음의 목적을 위하여 개인정보를 처리합니다.</p>
\t<ol class="list_ol1">
\t\t<li><span class="num">1</span>서비스 제공</li>
\t\t<li><span class="num">2</span>회원 관리</li>
\t\t<li><span class="num">3</span>마케팅 활용</li>
\t</ol>
</div>
<h3 class="tit2">제2조 (개인정보의 처리 및 보유 기간)</h3>
<div class="indent">
\t<p>이용자의 개인정보는 수집·이용 목적이 달성된 후에는 해당 정보를 지체 없이 파기합니다.</p>
\t<div class="tbl_st scroll_gr" tabindex="0">
\t\t<table>
\t\t\t<caption>개인정보 보유 기간</caption>
\t\t\t<colgroup>
\t\t\t\t<col style="width:33.33%">
\t\t\t\t<col style="width:33.33%">
\t\t\t\t<col style="width:33.33%">
\t\t\t</colgroup>
\t\t\t<thead>
\t\t\t\t<tr>
\t\t\t\t\t<th scope="col">항목</th>
\t\t\t\t\t<th scope="col">수집 목적</th>
\t\t\t\t\t<th scope="col">보유 기간</th>
\t\t\t\t</tr>
\t\t\t</thead>
\t\t\t<tbody>
\t\t\t\t<tr>
\t\t\t\t\t<td>이름, 이메일</td>
\t\t\t\t\t<td>회원 가입</td>
\t\t\t\t\t<td>회원 탈퇴 시</td>
\t\t\t\t</tr>
\t\t\t\t<tr>
\t\t\t\t\t<td class="al">
\t\t\t\t\t\t<ul class="list_st1">
\t\t\t\t\t\t\t<li>접속 IP</li>
\t\t\t\t\t\t\t<li>쿠키</li>
\t\t\t\t\t\t</ul>
\t\t\t\t\t</td>
\t\t\t\t\t<td>서비스 이용 기록</td>
\t\t\t\t\t<td>3개월</td>
\t\t\t\t</tr>
\t\t\t</tbody>
\t\t</table>
\t</div>
</div>`

const isValidUrl = (str) => {
  try {
    const u = new URL(str)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}


async function apiAutoMarkup(url, selector) {
  if (DEV_MOCK) {
    await new Promise(r => setTimeout(r, 800))
    return { html: MOCK_MARKUP, crawled: MOCK_CRAWL }
  }
  const res = await fetch(`${API_BASE}/auto-markup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, selector }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || '마크업 실패')
  return data
}

async function apiEditMarkup(html, instruction) {
  if (DEV_MOCK) {
    await new Promise(r => setTimeout(r, 700))
    return html + `\n<!-- [mock] 적용됨: ${instruction} -->`
  }
  const res = await fetch(`${API_BASE}/edit-markup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, instruction }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || '편집 실패')
  return data.html
}

function PreviewModal({ markup, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>마크업 미리보기</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <iframe
          className="modal-iframe"
          srcDoc={`<!DOCTYPE html>\n<html lang="ko">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<link rel="stylesheet" href="/basic.css">\n<link rel="stylesheet" href="/con_com.css">\n<style>body { padding: 2rem; }</style>\n</head>\n<body>\n${markup}\n</body>\n</html>`}
        />
      </div>
    </div>
  )
}

function MarkupResultPanel({ markup, onMarkupChange }) {
  const [editMode, setEditMode] = useState(false)
  const [editPrompt, setEditPrompt] = useState('')
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [editError, setEditError] = useState('')

  const copyToClipboard = () => {
    navigator.clipboard.writeText(markup)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleEdit = async () => {
    if (!editPrompt) return
    setLoadingEdit(true)
    setEditError('')
    try {
      const newMarkup = await apiEditMarkup(markup, editPrompt)
      onMarkupChange(newMarkup)
      setEditPrompt('')
    } catch (e) {
      setEditError(e.message)
    } finally {
      setLoadingEdit(false)
    }
  }

  return (
    <div className="markup-result">
      <div className="markup-actions">
        <button className={`copy-btn${copied ? ' copied' : ''}`} onClick={copyToClipboard}>
          {copied ? '복사됨 ✓' : '복사'}
        </button>
        <button className="preview-btn" onClick={() => setShowPreview(true)}>미리보기</button>
        <button className={`edit-mode-btn${editMode ? ' active' : ''}`} onClick={() => setEditMode(v => !v)}>
          {editMode ? '편집 완료' : '직접 편집'}
        </button>
      </div>
      {editMode ? (
        <textarea
          className="markup-editor"
          value={markup}
          onChange={e => onMarkupChange(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <pre className="result-html">{markup}</pre>
      )}
      {editError && <div className="error-box" style={{ marginTop: '8px' }}>{editError}</div>}
      <div className="prompt-edit-section">
        <p className="prompt-edit-label">AI로 수정하기</p>
        <div className="prompt-edit-row">
          <input
            className="edit-prompt-input"
            type="text"
            value={editPrompt}
            onChange={e => setEditPrompt(e.target.value)}
            placeholder='예: td에 class="al"을 추가해줘 / th는 가운데 정렬해줘'
            onKeyDown={e => e.key === 'Enter' && !loadingEdit && handleEdit()}
            disabled={loadingEdit}
          />
          <button className="edit-prompt-btn" onClick={handleEdit} disabled={loadingEdit || !editPrompt}>
            {loadingEdit ? '적용 중...' : '적용'}
          </button>
        </div>
      </div>
      {showPreview && <PreviewModal markup={markup} onClose={() => setShowPreview(false)} />}
    </div>
  )
}

export default function App() {
  const [mode, setMode] = useState('single')

  // 단일 모드
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMarkup, setLoadingMarkup] = useState(false)
  const [result, setResult] = useState(null)
  const [markupResult, setMarkupResult] = useState(null)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('text')
  const [fallbackSelector, setFallbackSelector] = useState('')
  const [needsSelector, setNeedsSelector] = useState(false)

  // 일괄 모드
  const [batchRows, setBatchRows] = useState([{ id: 1, url: '', urlError: '' }])
  const [batchResults, setBatchResults] = useState([])
  const [loadingBatch, setLoadingBatch] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 })

  // 단일 모드 검증
  const validate = () => {
    if (!url) { setUrlError('URL을 입력해주세요.'); return false }
    if (!isValidUrl(url)) { setUrlError('올바른 URL 형식이 아닙니다. (예: https://example.com)'); return false }
    setUrlError('')
    return true
  }

  const DETECT_FAIL_MSG = '본문 영역을 자동으로 감지하지 못했습니다'

  const handleCrawl = async (selectorOverride) => {
    if (!validate()) return
    const sel = selectorOverride ?? fallbackSelector
    setLoading(true)
    setError(null)
    setNeedsSelector(false)
    setResult(null)
    setMarkupResult(null)

    if (DEV_MOCK) {
      await new Promise(r => setTimeout(r, 600))
      setResult(MOCK_CRAWL)
      setActiveTab('text')
      setLoading(false)
      return
    }

    try {
      const res = await fetch(`${API_BASE}/crawl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, selector: sel }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || '크롤링 실패')
      setResult(data)
      setActiveTab('text')
    } catch (e) {
      setError(e.message)
      if (e.message.includes(DETECT_FAIL_MSG)) setNeedsSelector(true)
    } finally {
      setLoading(false)
    }
  }

  const handleAutoMarkup = async () => {
    if (!validate()) return
    setLoadingMarkup(true)
    setError(null)
    setNeedsSelector(false)
    setMarkupResult(null)
    try {
      const data = await apiAutoMarkup(url, fallbackSelector)
      setResult(data.crawled)
      setMarkupResult(data.html)
      setActiveTab('markup')
    } catch (e) {
      setError(e.message)
      if (e.message.includes(DETECT_FAIL_MSG)) setNeedsSelector(true)
    } finally {
      setLoadingMarkup(false)
    }
  }

  // 일괄 모드 핸들러
  const addBatchRow = () =>
    setBatchRows(prev => [...prev, { id: Date.now(), url: '', urlError: '' }])

  const removeBatchRow = (id) =>
    setBatchRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : prev)

  const updateBatchRow = (id, field, value) =>
    setBatchRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value, [`${field}Error`]: '' } : r))

  const validateBatchRows = () => {
    let hasErrors = false
    setBatchRows(prev => prev.map(row => {
      const u = { urlError: '' }
      if (!row.url) { u.urlError = 'URL을 입력해주세요.'; hasErrors = true }
      else if (!isValidUrl(row.url)) { u.urlError = '올바른 URL 형식이 아닙니다.'; hasErrors = true }
      return { ...row, ...u }
    }))
    return !hasErrors
  }

  const handleBatchMarkup = async () => {
    if (!validateBatchRows()) return
    setLoadingBatch(true)
    setBatchProgress({ current: 0, total: batchRows.length })
    setBatchResults(batchRows.map(r => ({ id: r.id, url: r.url, status: 'pending', markup: null, error: null })))

    for (let i = 0; i < batchRows.length; i++) {
      const row = batchRows[i]
      setBatchProgress({ current: i + 1, total: batchRows.length })
      setBatchResults(prev => prev.map(r => r.id === row.id ? { ...r, status: 'loading' } : r))
      try {
        const data = await apiAutoMarkup(row.url, '')
        setBatchResults(prev => prev.map(r => r.id === row.id ? { ...r, status: 'done', markup: data.html } : r))
      } catch (e) {
        setBatchResults(prev => prev.map(r => r.id === row.id ? { ...r, status: 'error', error: e.message } : r))
      }
    }
    setLoadingBatch(false)
  }

  const updateBatchMarkup = (id, newMarkup) =>
    setBatchResults(prev => prev.map(r => r.id === id ? { ...r, markup: newMarkup } : r))

  return (
    <div className="app">
      <header className="header">
        <h1>Markup Tool</h1>
      </header>

      <main className="main">
        <div className="mode-toggle">
          <button className={`mode-btn${mode === 'single' ? ' active' : ''}`} onClick={() => setMode('single')}>단일</button>
          <button className={`mode-btn${mode === 'batch' ? ' active' : ''}`} onClick={() => setMode('batch')}>일괄</button>
        </div>

        {/* 단일 모드 */}
        {mode === 'single' && (
          <>
            <div className="input-section">
              <div className="input-group">
                <label>URL</label>
                <input
                  type="text"
                  value={url}
                  onChange={e => { setUrl(e.target.value); setUrlError(''); setNeedsSelector(false); setFallbackSelector('') }}
                  placeholder="https://example.com/page"
                  onKeyDown={e => e.key === 'Enter' && handleCrawl()}
                  className={urlError ? 'input-error' : ''}
                  style={{ fontSize: '1.05rem', padding: '10px 14px', height: '48px' }}
                />
                {urlError && <span className="field-error">{urlError}</span>}
              </div>
              <div className="btn-group">
                <button className="crawl-btn" onClick={() => handleCrawl()} disabled={loading || loadingMarkup}>
                  {loading ? '크롤링 중...' : '크롤링'}
                </button>
                {result && (
                  <button className="markup-btn" onClick={handleAutoMarkup} disabled={loading || loadingMarkup}>
                    {loadingMarkup ? '마크업 생성 중...' : '자동 마크업'}
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="error-box">
                <span>{error}</span>
                {needsSelector && (
                  <div className="fallback-selector">
                    <input
                      type="text"
                      value={fallbackSelector}
                      onChange={e => setFallbackSelector(e.target.value)}
                      placeholder="CSS 셀렉터 직접 입력 (예: #content, .article)"
                      onKeyDown={e => e.key === 'Enter' && fallbackSelector && handleCrawl(fallbackSelector)}
                      autoFocus
                    />
                    <button
                      onClick={() => handleCrawl(fallbackSelector)}
                      disabled={!fallbackSelector || loading}
                    >
                      재시도
                    </button>
                  </div>
                )}
              </div>
            )}

            {result && (
              <div className={`result-section${loadingMarkup ? ' is-loading' : ''}`}>
                {loadingMarkup && (
                  <div className="loading-overlay">
                    <div className="spinner" />
                    <span>마크업 생성 중...</span>
                  </div>
                )}
                <div className="tabs">
                  <button className={activeTab === 'text' ? 'tab active' : 'tab'} onClick={() => setActiveTab('text')}>텍스트</button>
                  {result.images?.length > 0 && (
                    <button className={activeTab === 'ocr' ? 'tab active' : 'tab'} onClick={() => setActiveTab('ocr')}>
                      이미지 OCR ({result.images.length})
                    </button>
                  )}
                  {markupResult && (
                    <button className={activeTab === 'markup' ? 'tab active' : 'tab'} onClick={() => setActiveTab('markup')}>자동 마크업</button>
                  )}
                  {!markupResult && (
                    <button className={activeTab === 'html' ? 'tab active' : 'tab'} onClick={() => setActiveTab('html')}>HTML 코드</button>
                  )}
                  {!markupResult && (
                    <button className={activeTab === 'preview' ? 'tab active' : 'tab'} onClick={() => setActiveTab('preview')}>미리보기</button>
                  )}
                </div>
                <div className="tab-content">
                  {activeTab === 'text' && (
                    <pre className="result-text">{result.text || '(텍스트 없음 — 이미지 OCR 탭을 확인하세요)'}</pre>
                  )}
                  {activeTab === 'ocr' && (
                    <div className="ocr-results">
                      {result.images.map((img, i) => (
                        <div key={i} className="ocr-item">
                          <div className="ocr-meta">
                            <img src={img.src} alt={img.alt} className="ocr-thumb" />
                            <span className="ocr-alt">{img.alt || '(alt 없음)'}</span>
                          </div>
                          <pre className="ocr-text">{img.ocr_text}</pre>
                        </div>
                      ))}
                    </div>
                  )}
                  {activeTab === 'markup' && markupResult && (
                    <MarkupResultPanel markup={markupResult} onMarkupChange={setMarkupResult} />
                  )}
                  {activeTab === 'html' && <pre className="result-html">{result.html}</pre>}
                  {activeTab === 'preview' && (
                    <div className="result-preview" dangerouslySetInnerHTML={{ __html: result.html }} />
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* 일괄 모드 */}
        {mode === 'batch' && (
          <>
            <div className="input-section">
              <div className="batch-header-row">
                <span className="batch-col-label">URL</span>
              </div>
              <div className="batch-rows">
                {batchRows.map((row, i) => (
                  <div key={row.id} className="batch-row">
                    <span className="batch-row-num">{i + 1}</span>
                    <div className="batch-row-fields">
                      <div className="batch-field">
                        <input
                          type="text"
                          value={row.url}
                          onChange={e => updateBatchRow(row.id, 'url', e.target.value)}
                          placeholder="https://example.com"
                          className={row.urlError ? 'input-error' : ''}
                        />
                        {row.urlError && <span className="field-error">{row.urlError}</span>}
                      </div>
                    </div>
                    <button className="batch-remove-btn" onClick={() => removeBatchRow(row.id)} disabled={batchRows.length === 1}>×</button>
                  </div>
                ))}
              </div>
              <div className="batch-footer">
                <button className="batch-add-btn" onClick={addBatchRow} disabled={loadingBatch}>+ 행 추가</button>
                <button className="markup-btn" onClick={handleBatchMarkup} disabled={loadingBatch}>
                  {loadingBatch ? `처리 중... (${batchProgress.current}/${batchProgress.total})` : '일괄 마크업'}
                </button>
              </div>
            </div>

            {batchResults.length > 0 && (
              <div className="batch-results">
                {batchResults.map((item, i) => (
                  <div key={item.id} className={`batch-result-item ${item.status}`}>
                    <div className="batch-result-header">
                      <span className="batch-result-num">{i + 1}</span>
                      <span className="batch-result-url">{item.url}</span>
                      <span className={`batch-result-badge ${item.status}`}>
                        {item.status === 'pending' && '대기'}
                        {item.status === 'loading' && <><span className="spinner-sm" />처리 중</>}
                        {item.status === 'done' && '완료'}
                        {item.status === 'error' && '오류'}
                      </span>
                    </div>
                    {item.status === 'error' && (
                      <div className="batch-result-error">{item.error}</div>
                    )}
                    {item.status === 'done' && item.markup && (
                      <div className="batch-result-body">
                        <MarkupResultPanel
                          markup={item.markup}
                          onMarkupChange={newMarkup => updateBatchMarkup(item.id, newMarkup)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
