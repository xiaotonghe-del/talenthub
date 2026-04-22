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
