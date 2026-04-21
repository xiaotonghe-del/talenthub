// talenthub-backend/lib/llm.js
// ============================================================
// LLM 服务层 —— 使用 OpenRouter (OpenAI 兼容接口)
// ============================================================
import OpenAI from 'openai';

// OpenRouter 兼容 OpenAI SDK，只要改 baseURL
const openai = process.env.OPENROUTER_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://talenthub.app',
        'X-Title': 'TalentHub',
      },
    })
  : null;

const MODEL = process.env.LLM_MODEL || 'openai/gpt-4o-mini';

export function safeParseJSON(text, fallback = {}) {
  if (!text || typeof text !== 'string') return fallback;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    console.warn('[LLM] JSON parse failed, using fallback');
    return fallback;
  }
}

export async function searchNews(query, opts = {}) {
  if (!process.env.TAVILY_API_KEY) {
    return [];
  }
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query, topic: 'news',
        days: opts.days || 14,
        max_results: opts.maxResults || 8,
        include_answer: false,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.results) ? data.results : [];
  } catch (e) {
    console.error('[LLM] Tavily error:', e.message);
    return [];
  }
}

export async function verifyProfile({ profile, universalCriteria, industryCriteria, newsSnippets }) {
  const fallback = {
    qualifies: true,
    reasoning: 'AI verification skipped (no key configured)',
    titleChanged: false,
    newTitle: null,
    newCompany: null,
  };

  if (!openai) return fallback;

  const newsContext = (newsSnippets || [])
    .slice(0, 5)
    .map((n, i) => `${i + 1}. ${n.title}\n   ${(n.content || '').slice(0, 200)}`)
    .join('\n\n') || '(no recent news available)';

  const prompt = `You are a strict verification assistant for a curated talent directory.

PERSON:
- Name: ${profile.name}
- Current Title: ${profile.title}
- Current Company: ${profile.company}
- Industry: ${profile.industry?.label || profile.industryId}
- Bio: ${profile.bio}

UNIVERSAL CRITERIA (must meet ALL):
${universalCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

INDUSTRY CRITERIA (must meet AT LEAST ONE):
${industryCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

RECENT NEWS:
${newsContext}

Return ONLY valid JSON:
{
  "qualifies": boolean,
  "reasoning": "1-2 sentence explanation",
  "titleChanged": boolean,
  "newTitle": "string or null",
  "newCompany": "string or null"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 400,
    });
    const raw = response.choices?.[0]?.message?.content || '';
    const parsed = safeParseJSON(raw, fallback);
    return {
      qualifies: typeof parsed.qualifies === 'boolean' ? parsed.qualifies : true,
      reasoning: String(parsed.reasoning || '').slice(0, 500),
      titleChanged: Boolean(parsed.titleChanged),
      newTitle: parsed.newTitle || null,
      newCompany: parsed.newCompany || null,
    };
  } catch (e) {
    console.error('[LLM] verifyProfile error:', e.message);
    return { ...fallback, reasoning: `LLM error: ${e.message}` };
  }
}