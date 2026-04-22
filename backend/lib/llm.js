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
 * 让 AI 根据 criteria 发现新的候选人（严格反幻觉版）
 */
export async function discoverProfiles({ industry, industryCriteria, universalCriteria, existingNames, count = 5 }) {
  if (!openai) {
    console.warn('[LLM] OpenRouter not configured, skipping discovery');
    return [];
  }

  const prompt = `You are a talent researcher. Your ONLY task is to find REAL, WELL-KNOWN, VERIFIABLE people for a curated AI industry talent directory.

TASK: Suggest up to ${count} REAL people in the "${industry}" category.

UNIVERSAL CRITERIA (must meet ALL):
${universalCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

INDUSTRY CRITERIA (must meet AT LEAST ONE):
${industryCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

ALREADY IN DATABASE (DO NOT SUGGEST THESE):
${existingNames.length ? existingNames.join(', ') : '(none)'}

CRITICAL RULES — YOU MUST FOLLOW:

1. ONLY suggest people you are 100% SURE exist and whose current role you can verify from public sources (news, LinkedIn, company websites as of 2024-2025).

2. If you are NOT SURE about a specific person's current company or role, DO NOT include them. It is FAR better to return FEWER people than to make up details.

3. EVERY person MUST have a REAL LinkedIn profile URL. If you don't know their exact LinkedIn URL, DO NOT include them.

4. DO NOT invent or guess:
   - Company names
   - Job titles
   - LinkedIn URLs
   - Education details
   - Twitter handles

5. If you cannot find ${count} people you are SURE about, return fewer (even just 1-2 is better than fake data).

6. Prefer well-known industry leaders over obscure figures. The goal is quality, not quantity.

7. It is acceptable and encouraged to return an EMPTY array if you cannot confidently identify new people.

Return ONLY valid JSON (no markdown, no commentary):
{
  "profiles": [
    {
      "name": "Full Real Name",
      "title": "Their verified current role",
      "company": "Their verified current company",
      "bio": "Factual 2-3 sentence bio with only verifiable facts",
      "linkedin": "https://www.linkedin.com/in/their-real-handle/",
      "twitter": "https://x.com/their-real-handle or empty string if unsure",
      "website": "empty string or verified official URL",
      "education": [{"school": "Verified University Name", "degree": "Verified degree"}],
      "experience": [{"role": "Current role", "company": "Current company", "current": true}],
      "confidence": "high | medium | low"
    }
  ]
}

Set "confidence": "high" only if you are 100% certain of name + current company + LinkedIn.
If confidence would be "low", DO NOT include that person.`;

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 2500,
    });

    const raw = response.choices?.[0]?.message?.content || '';
    const parsed = safeParseJSON(raw, { profiles: [] });
    let profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];

    // 过滤层 1: 必须有 LinkedIn
    profiles = profiles.filter(p => {
      const hasLinkedIn = p.linkedin && typeof p.linkedin === 'string' && p.linkedin.includes('linkedin.com/in/');
      if (!hasLinkedIn) {
        console.warn(`[Discover] Rejected ${p.name}: no valid LinkedIn`);
      }
      return hasLinkedIn;
    });

    // 过滤层 2: 必须 confidence = high
    profiles = profiles.filter(p => {
      const isHigh = !p.confidence || p.confidence === 'high';
      if (!isHigh) {
        console.warn(`[Discover] Rejected ${p.name}: confidence=${p.confidence}`);
      }
      return isHigh;
    });

    // 过滤层 3: 必须有基本字段 + bio 长度
    profiles = profiles.filter(p => p.name && p.title && p.company && p.bio && p.bio.length >= 30);

    // 规范化
    return profiles.slice(0, count).map(p => ({
      name: String(p.name).trim(),
      title: String(p.title).trim(),
      company: String(p.company).trim(),
      bio: String(p.bio).trim(),
      linkedin: p.linkedin,
      twitter: p.twitter || '',
      website: p.website || '',
      education: Array.isArray(p.education) ? p.education : [],
      experience: Array.isArray(p.experience) ? p.experience : [],
    }));
  } catch (e) {
    console.error(`[LLM] discoverProfiles (${industry}) error:`, e.message);
    return [];
  }
}
