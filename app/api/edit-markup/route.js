import { NextResponse } from 'next/server';
import { editMarkup } from '@/lib/ai-mapper';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const { html, instruction } = await request.json();
    const result = await editMarkup(html, instruction);
    return NextResponse.json({ html: result });
  } catch (e) {
    return NextResponse.json({ detail: e.message }, { status: 500 });
  }
}
