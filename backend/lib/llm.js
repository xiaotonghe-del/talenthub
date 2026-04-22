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
/**
 * 让 AI 根据 criteria 发现新的候选人
 * 返回 5 个符合标准且不在排除列表里的新 profile
 */
export async function discoverProfiles({ industry, industryCriteria, universalCriteria, existingNames, count = 5 }) {
  if (!openai) {
    console.warn('[LLM] OpenRouter not configured, skipping discovery');
    return [];
  }

  const prompt = `You are a talent researcher. Discover ${count} REAL, verifiable people who currently qualify for a curated talent directory in the "${industry}" category.

UNIVERSAL CRITERIA (must meet ALL):
${universalCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

INDUSTRY CRITERIA (must meet AT LEAST ONE):
${industryCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

EXCLUDE these people (already in database):
${existingNames.length ? existingNames.join(', ') : '(none)'}

Requirements:
- All people MUST be REAL, currently active professionals
- Use only publicly known information
- Return EXACTLY ${count} unique new people (different from excluded list)
- Each must meet universal criteria AND at least one industry criterion

Return ONLY valid JSON (no markdown):
{
  "profiles": [
    {
      "name": "Full Name",
      "title": "Their current role",
      "company": "Their current company",
      "bio": "2-3 sentence bio explaining why they qualify",
      "linkedin": "https://www.linkedin.com/in/their-handle/ or empty string",
      "twitter": "https://x.com/their-handle or empty string",
      "website": "empty string or official URL",
      "education": [{"school": "University Name", "degree": "Degree name"}],
      "experience": [{"role": "Current role", "company": "Current company", "current": true}]
    }
  ]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 2500,
    });

    const raw = response.choices?.[0]?.message?.content || '';
    const parsed = safeParseJSON(raw, { profiles: [] });
    const profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];

    // 规范化每个 profile
    return profiles.slice(0, count).map(p => ({
      name: String(p.name || '').trim(),
      title: String(p.title || '').trim(),
      company: String(p.company || '').trim(),
      bio: String(p.bio || '').trim(),
      linkedin: p.linkedin || '',
      twitter: p.twitter || '',
      website: p.website || '',
      education: Array.isArray(p.education) ? p.education : [],
      experience: Array.isArray(p.experience) ? p.experience : [],
    })).filter(p => p.name && p.title && p.company);
  } catch (e) {
    console.error(`[LLM] discoverProfiles (${industry}) error:`, e.message);
    return [];
  }
}
