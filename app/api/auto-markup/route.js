import { NextResponse } from 'next/server';
import { crawl } from '@/lib/crawler';
import { autoMarkup } from '@/lib/ai-mapper';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const { url, selector = '' } = await request.json();
    const crawled = await crawl(url, selector);
    if (!crawled.success) {
      return NextResponse.json({ detail: crawled.error }, { status: 400 });
    }
    const html = await autoMarkup(crawled);
    return NextResponse.json({ html, crawled });
  } catch (e) {
    return NextResponse.json({ detail: e.message }, { status: 500 });
  }
}
