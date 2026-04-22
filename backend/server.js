import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { filterByCriteria, filterOne } from './lib/criteria.js';
import { searchNews, verifyProfile } from './lib/llm.js';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const CRON_SECRET = process.env.CRON_SECRET || 'dev-secret';

app.use(cors());
app.use(express.json({ limit: '2mb' }));

let syncState = {
  running: false,
  startedAt: null,
  trigger: null,
  lastResult: null,
};

async function runSync(trigger = 'manual') {
  if (syncState.running) {
    return { skipped: true, reason: 'Sync already in progress' };
  }
  syncState = { running: true, startedAt: new Date().toISOString(), trigger, lastResult: null };
  const startTime = Date.now();
  const log = { trigger, processed: 0, updated: 0, unverified: 0, newsAdded: 0, errors: [] };
  console.log(`[Sync] Starting (${trigger})...`);
  try {
    const universalRows = await prisma.universalCriteria.findMany({ orderBy: { order: 'asc' } });
    const universal = universalRows.map(r => r.rule);
    const profiles = await prisma.profile.findMany({ include: { industry: true } });
    for (const profile of profiles) {
      try {
        log.processed++;
        const news = await searchNews(`"${profile.name}" ${profile.company}`);
        for (const item of news) {
          try {
            await prisma.newsItem.create({
              data: {
                profileId: profile.id,
                title: item.title,
                url: item.url,
                source: safeHostname(item.url),
                snippet: (item.content || '').slice(0, 500),
                publishedAt: item.published_date ? new Date(item.published_date) : new Date(),
              },
            });
            log.newsAdded++;
          } catch { }
        }
        const industryCriteria = profile.industry?.criteria || [];
        const verdict = await verifyProfile({
          profile,
          universalCriteria: universal,
          industryCriteria,
          newsSnippets: news,
        });
        const updates = { lastSynced: new Date(), lastVerified: new Date() };
        if (!verdict.qualifies) {
          updates.verified = false;
          updates.verifyReason = verdict.reasoning;
          log.unverified++;
        } else {
          updates.verified = true;
          updates.verifyReason = verdict.reasoning;
        }
        if (verdict.titleChanged && verdict.newTitle && verdict.newCompany) {
          updates.title = verdict.newTitle;
          updates.company = verdict.newCompany;
          log.updated++;
        }
        await prisma.profile.update({ where: { id: profile.id }, data: updates });
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        console.error(`[Sync] Error on ${profile.name}:`, e.message);
        log.errors.push(`${profile.name}: ${e.message}`);
      }
    }
  } catch (e) {
    console.error('[Sync] Fatal:', e);
    log.errors.push(`Fatal: ${e.message}`);
  }
  const durationMs = Date.now() - startTime;
  const status = log.errors.length === 0 ? 'success' : (log.errors.length < 5 ? 'partial' : 'failed');
  await prisma.syncLog.create({
    data: { trigger, durationMs, processed: log.processed, updated: log.updated, unverified: log.unverified, newsAdded: log.newsAdded, errors: log.errors.length ? log.errors.join('\n') : null, status },
  }).catch(e => console.error('[Sync] Log write failed:', e.message));
  const result = { ...log, durationMs, status, finishedAt: new Date().toISOString() };
  syncState = { running: false, startedAt: null, trigger: null, lastResult: result };
  console.log(`[Sync] Done: ${log.processed} processed, ${log.updated} updated, ${durationMs}ms`);
  return result;
}

function safeHostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return 'unknown'; }
}

async function getActiveIndustryIds() {
  const inds = await prisma.industry.findMany({ select: { id: true } });
  return inds.map(i => i.id);
}

// 临时 seed 端点 —— 用完即删
app.post('/api/seed', async (req, res) => {
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const INDUSTRIES = [
      { id: 'HR', label: 'Human Resources', desc: 'HR executives and AI HR platform leaders', num: '01', icon: 'I', criteria: ['Senior HR executive at Fortune 1000 company', 'Founder or C-level at HR tech or AI HR company with $5M+ funding', 'Widely cited HR industry analyst with published research'] },
      { id: 'VOICE_AI', label: 'Voice AI', desc: 'Speech synthesis and audio intelligence', num: '02', icon: 'II', criteria: ['Founder or C-level at voice AI or speech technology company', 'Company must have raised $3M+ or serve 10,000+ active users', 'Principal research scientist at a major voice AI laboratory'] },
      { id: 'AI_AGENTS', label: 'AI Agents', desc: 'Agent frameworks, research, and platforms', num: '03', icon: 'III', criteria: ['Founder or leadership at an AI agent framework or platform', 'Senior PM or research lead at a major AI laboratory', 'Influential open-source contributor with 5,000+ GitHub stars'] },
      { id: 'VC', label: 'Venture Capital', desc: 'Investors backing AI-native companies', num: '04', icon: 'IV', criteria: ['General Partner or solo capitalist actively investing in AI', 'Led or participated in five or more AI deals in the last two years', 'Managing a $50M+ fund focused on AI-native companies'] },
      { id: 'UNIVERSITY', label: 'Academia', desc: 'AI researchers and university faculty', num: '05', icon: 'V', criteria: ['Tenured or tenure-track professor at a top-50 research university', 'Focus on AI, ML, NLP, or Robotics research', 'Leads a recognized AI research laboratory', 'Minimum 1,000+ Google Scholar citations'] },
    ];
    const UNIVERSAL = [
      'Must hold a senior leadership, founder, or principal researcher role',
      'Must have a verifiable public presence across LinkedIn, X, or published work',
      'Must have been professionally active within the last twelve months',
      'Must have publicly accessible education and career history',
    ];
    const PROFILES = [
      { slug: 'josh-bersin', name: 'Josh Bersin', title: 'Global Industry Analyst', company: 'The Josh Bersin Company', industryId: 'HR', bio: 'Globally recognized HR industry analyst. Founder of Bersin & Associates (acquired by Deloitte).', linkedin: 'https://www.linkedin.com/in/bersin/', twitter: 'https://x.com/Josh_Bersin', education: [{ school: 'Stanford University', degree: 'MS, Engineering Management' }, { school: 'Cornell University', degree: 'BS, Engineering' }], experience: [{ role: 'Founder & CEO', company: 'The Josh Bersin Company', current: true }, { role: 'Principal, Bersin', company: 'Deloitte Consulting' }] },
      { slug: 'ashutosh-garg', name: 'Ashutosh Garg', title: 'Co-Founder & CEO', company: 'Eightfold AI', industryId: 'HR', bio: 'Co-founder and CEO of Eightfold AI, a talent intelligence platform using deep learning.', linkedin: 'https://www.linkedin.com/in/ashutoshgarg-eightfold/', education: [{ school: 'UIUC', degree: 'PhD, Computer Science' }, { school: 'IIT Delhi', degree: 'B.Tech, CS' }], experience: [{ role: 'Co-Founder & CEO', company: 'Eightfold AI', current: true }, { role: 'Research Scientist', company: 'Google' }] },
      { slug: 'harrison-chase', name: 'Harrison Chase', title: 'Co-Founder & CEO', company: 'LangChain', industryId: 'AI_AGENTS', bio: 'Co-founder and CEO of LangChain, the open-source framework for building LLM applications.', linkedin: 'https://www.linkedin.com/in/harrison-chase-961287118/', twitter: 'https://x.com/hwchase17', education: [{ school: 'Harvard University', degree: 'BA, Statistics & CS' }], experience: [{ role: 'Co-Founder & CEO', company: 'LangChain', current: true }, { role: 'ML Engineer', company: 'Robust Intelligence' }] },
      { slug: 'andrew-ng', name: 'Andrew Ng', title: 'Founder', company: 'DeepLearning.AI', industryId: 'AI_AGENTS', bio: 'Founder of DeepLearning.AI, Landing AI, and AI Fund. Co-founder of Coursera.', linkedin: 'https://www.linkedin.com/in/andrewyng/', twitter: 'https://x.com/AndrewYNg', education: [{ school: 'UC Berkeley', degree: 'PhD, CS' }, { school: 'MIT', degree: 'MS, EECS' }], experience: [{ role: 'Founder', company: 'DeepLearning.AI', current: true }, { role: 'Founder & CEO', company: 'Landing AI', current: true }] },
      { slug: 'scott-stephenson', name: 'Scott Stephenson', title: 'Co-Founder & CEO', company: 'Deepgram', industryId: 'VOICE_AI', bio: 'Co-founder and CEO of Deepgram, a leading speech-to-text platform. Former particle physicist.', linkedin: 'https://www.linkedin.com/in/scottstephenson/', twitter: 'https://x.com/ScottSteph', education: [{ school: 'University of Michigan', degree: 'PhD, Particle Physics' }], experience: [{ role: 'Co-Founder & CEO', company: 'Deepgram', current: true }] },
      { slug: 'mati-staniszewski', name: 'Mati Staniszewski', title: 'Co-Founder & CEO', company: 'ElevenLabs', industryId: 'VOICE_AI', bio: 'Co-founder and CEO of ElevenLabs, a leader in AI voice synthesis.', linkedin: 'https://www.linkedin.com/in/mati-staniszewski/', twitter: 'https://x.com/matistanis', education: [{ school: 'Imperial College London', degree: 'Mathematics' }], experience: [{ role: 'Co-Founder & CEO', company: 'ElevenLabs', current: true }, { role: 'Deployment Strategist', company: 'Palantir' }] },
      { slug: 'sarah-guo', name: 'Sarah Guo', title: 'Founder & Managing Partner', company: 'Conviction', industryId: 'VC', bio: 'Founder of Conviction, AI-focused venture fund. Host of No Priors podcast.', linkedin: 'https://www.linkedin.com/in/sarahguo/', twitter: 'https://x.com/saranormous', education: [{ school: 'University of Pennsylvania', degree: 'BS' }], experience: [{ role: 'Founder & Managing Partner', company: 'Conviction', current: true }, { role: 'General Partner', company: 'Greylock Partners' }] },
      { slug: 'vinod-khosla', name: 'Vinod Khosla', title: 'Founder', company: 'Khosla Ventures', industryId: 'VC', bio: 'Founder of Khosla Ventures. Co-founder of Sun Microsystems. Early backer of OpenAI.', linkedin: 'https://www.linkedin.com/in/vinodkhosla/', twitter: 'https://x.com/vkhosla', education: [{ school: 'Stanford GSB', degree: 'MBA' }], experience: [{ role: 'Founder', company: 'Khosla Ventures', current: true }, { role: 'Co-Founder', company: 'Sun Microsystems' }] },
      { slug: 'fei-fei-li', name: 'Fei-Fei Li', title: 'Sequoia Professor', company: 'Stanford University', industryId: 'UNIVERSITY', bio: 'Sequoia Professor at Stanford. Creator of ImageNet. Co-founder of World Labs.', linkedin: 'https://www.linkedin.com/in/fei-fei-li-4541247/', twitter: 'https://x.com/drfeifei', education: [{ school: 'Caltech', degree: 'PhD, EE' }, { school: 'Princeton', degree: 'BA, Physics' }], experience: [{ role: 'Sequoia Professor', company: 'Stanford University', current: true }, { role: 'Co-Founder & CEO', company: 'World Labs', current: true }] },
      { slug: 'yann-lecun', name: 'Yann LeCun', title: 'Chief AI Scientist', company: 'Meta / NYU', industryId: 'UNIVERSITY', bio: 'Chief AI Scientist at Meta and Silver Professor at NYU. 2018 Turing Award laureate.', linkedin: 'https://www.linkedin.com/in/yann-lecun/', twitter: 'https://x.com/ylecun', education: [{ school: 'Sorbonne Universite', degree: 'PhD, CS' }], experience: [{ role: 'Chief AI Scientist', company: 'Meta', current: true }, { role: 'Silver Professor', company: 'NYU', current: true }] },
    ];

    for (const ind of INDUSTRIES) {
      await prisma.industry.upsert({ where: { id: ind.id }, update: ind, create: ind });
    }
    await prisma.universalCriteria.deleteMany({});
    await prisma.universalCriteria.createMany({ data: UNIVERSAL.map((rule, order) => ({ rule, order })) });
    for (const p of PROFILES) {
      await prisma.profile.upsert({ where: { slug: p.slug }, update: p, create: p });
    }
    res.json({ ok: true, industries: INDUSTRIES.length, profiles: PROFILES.length, message: 'Database seeded!' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'TalentHub API', version: '2.0.0' });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    syncRunning: syncState.running,
    lastSync: syncState.lastResult,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/industries', async (req, res) => {
  try {
    const inds = await prisma.industry.findMany({ orderBy: { num: 'asc' } });
    const result = {};
    inds.forEach(i => { result[i.id] = { label: i.label, desc: i.desc, num: i.num, icon: i.icon }; });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/industries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { label, desc, num, icon } = req.body;
    const ind = await prisma.industry.upsert({
      where: { id },
      update: { label, desc, num, icon: icon || '' },
      create: { id, label, desc, num, icon: icon || '', criteria: [] },
    });
    res.json(ind);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/industries/:id', async (req, res) => {
  try {
    await prisma.profile.deleteMany({ where: { industryId: req.params.id } });
    await prisma.industry.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/criteria', async (req, res) => {
  try {
    const universalRows = await prisma.universalCriteria.findMany({ orderBy: { order: 'asc' } });
    const industries = await prisma.industry.findMany();
    const byIndustry = {};
    industries.forEach(i => { byIndustry[i.id] = i.criteria || []; });
    res.json({ universal: universalRows.map(r => r.rule), byIndustry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/criteria', async (req, res) => {
  try {
    const { universal, byIndustry } = req.body;
    if (Array.isArray(universal)) {
      await prisma.universalCriteria.deleteMany({});
      await prisma.universalCriteria.createMany({
        data: universal.map((rule, order) => ({ rule, order })),
      });
    }
    if (byIndustry && typeof byIndustry === 'object') {
      for (const [id, rules] of Object.entries(byIndustry)) {
        await prisma.industry.update({
          where: { id },
          data: { criteria: Array.isArray(rules) ? rules : [] },
        }).catch(() => { });
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/profiles', async (req, res) => {
  try {
    const raw = await prisma.profile.findMany({
      include: { industry: true },
      orderBy: { name: 'asc' },
    });
    const activeIds = await getActiveIndustryIds();
    const { accepted, rejected } = filterByCriteria(raw, activeIds, { debug: true });
    res.json({
      profiles: accepted,
      meta: {
        total: raw.length,
        displayed: accepted.length,
        filtered: rejected.length,
        syncRunning: syncState.running,
        lastSync: syncState.lastResult,
      },
    });
  } catch (e) {
    console.error('[API] /profiles error:', e);
    res.status(500).json({ error: e.message, profiles: [], meta: {} });
  }
});

app.get('/api/profiles/:slug', async (req, res) => {
  try {
    const raw = await prisma.profile.findUnique({
      where: { slug: req.params.slug },
      include: {
        industry: true,
        newsItems: { orderBy: { publishedAt: 'desc' }, take: 10 },
      },
    });
    if (!raw) return res.status(404).json({ error: 'Not found' });
    const activeIds = await getActiveIndustryIds();
    const filtered = filterOne(raw, activeIds);
    if (!filtered) return res.status(404).json({ error: 'Profile does not meet criteria' });
    res.json({ profile: filtered, news: raw.newsItems });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/profiles', async (req, res) => {
  try {
    const body = req.body;
    const profile = await prisma.profile.upsert({
      where: { slug: body.slug },
      update: body,
      create: { ...body, education: body.education || [], experience: body.experience || [] },
    });
    res.json(profile);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/profiles/:slug', async (req, res) => {
  try {
    await prisma.profile.delete({ where: { slug: req.params.slug } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/refresh', async (req, res) => {
  if (syncState.running) {
    return res.json({ ok: true, alreadyRunning: true, startedAt: syncState.startedAt, message: 'Sync already in progress' });
  }
  res.json({ ok: true, started: true, message: 'Sync started' });
  runSync('manual').catch(e => console.error('[Refresh] sync crashed:', e));
});

app.get('/api/sync-status', (req, res) => {
  res.json({
    running: syncState.running,
    startedAt: syncState.startedAt,
    trigger: syncState.trigger,
    lastResult: syncState.lastResult,
  });
});

app.get('/api/sync-logs', async (req, res) => {
  try {
    const logs = await prisma.syncLog.findMany({ orderBy: { runAt: 'desc' }, take: 20 });
    res.json(logs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cron/daily-sync', async (req, res) => {
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const result = await runSync('cron');
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

cron.schedule('0 3 * * *', async () => {
  console.log('[Cron] Daily sync triggered');
  try { await runSync('cron'); }
  catch (e) { console.error('[Cron] failed:', e); }
}, { timezone: 'UTC' });

app.listen(PORT, () => {
  console.log(`\n🚀 TalentHub API on :${PORT}`);
  console.log(`📅 Cron: 03:00 UTC daily`);
  console.log(`🤖 OpenRouter: ${process.env.OPENROUTER_API_KEY ? 'enabled' : 'DISABLED'}`);
  console.log(`🔍 Tavily: ${process.env.TAVILY_API_KEY ? 'enabled' : 'DISABLED (skipping news)'}\n`);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
