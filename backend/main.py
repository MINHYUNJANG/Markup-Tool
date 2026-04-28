from dotenv import load_dotenv
load_dotenv()

from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from crawler import crawl
from ai_mapper import map_to_template, auto_markup, edit_markup

app = FastAPI(title="Markup Tool API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class CrawlRequest(BaseModel):
    url: str
    selector: Optional[str] = ""


class MarkupRequest(BaseModel):
    url: str
    selector: Optional[str] = ""
    template_html: str


class EditMarkupRequest(BaseModel):
    html: str
    instruction: str


@app.get("/")
def root():
    return {"status": "ok"}


@app.post("/crawl")
async def crawl_endpoint(req: CrawlRequest):
    try:
        result = await crawl(req.url, req.selector)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/markup")
async def markup_endpoint(req: MarkupRequest):
    crawled = await crawl(req.url, req.selector)
    if not crawled["success"]:
        raise HTTPException(status_code=400, detail=crawled["error"])

    result_html = map_to_template(req.template_html, crawled)
    return {"html": result_html}


@app.post("/edit-markup")
async def edit_markup_endpoint(req: EditMarkupRequest):
    try:
        result_html = edit_markup(req.html, req.instruction)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"html": result_html}


@app.post("/auto-markup")
async def auto_markup_endpoint(req: CrawlRequest):
    crawled = await crawl(req.url, req.selector)
    if not crawled["success"]:
        raise HTTPException(status_code=400, detail=crawled["error"])

    try:
        result_html = auto_markup(crawled)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"html": result_html, "crawled": crawled}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3000)
