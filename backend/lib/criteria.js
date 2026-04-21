// talenthub-backend/lib/criteria.js
// ============================================================
// Criteria 筛选模块 —— 服务端集中式过滤逻辑
// 所有 profile 必须先通过这里才能暴露给前端
// ============================================================

function isValidProfile(p) {
    if (!p || typeof p !== 'object') return false;
    if (!p.slug || typeof p.slug !== 'string') return false;
    if (!p.name || typeof p.name !== 'string' || p.name.trim().length < 2) return false;
    if (!p.industryId) return false;
    return true;
  }
  
  function sanitize(p) {
    return {
      slug: String(p.slug).trim(),
      name: String(p.name).trim(),
      title: String(p.title || '').trim(),
      company: String(p.company || '').trim(),
      industry: String(p.industryId),
      bio: String(p.bio || '').trim(),
      linkedin: p.linkedin || '',
      twitter: p.twitter || '',
      website: p.website || '',
      education: Array.isArray(p.education) ? p.education : [],
      experience: Array.isArray(p.experience) ? p.experience : [],
      verified: Boolean(p.verified),
      lastSynced: p.lastSynced ? new Date(p.lastSynced).toISOString() : new Date().toISOString(),
    };
  }
  
  function passesBusinessRules(p, activeIndustryIds) {
    if (!p.verified) return { pass: false, reason: 'Not verified by AI' };
    if (!p.title) return { pass: false, reason: 'Missing title' };
    if (!p.company) return { pass: false, reason: 'Missing company' };
    if (!p.linkedin && !p.twitter && !p.website) {
      return { pass: false, reason: 'No public presence link' };
    }
    if (!p.bio || p.bio.length < 20) return { pass: false, reason: 'Bio too short' };
    if (!activeIndustryIds.includes(p.industry)) {
      return { pass: false, reason: `Industry ${p.industry} not active` };
    }
    return { pass: true };
  }
  
  export function filterByCriteria(rawProfiles, activeIndustryIds, opts = {}) {
    const accepted = [];
    const rejected = [];
  
    if (!Array.isArray(rawProfiles)) {
      return { accepted, rejected };
    }
  
    for (const raw of rawProfiles) {
      if (!isValidProfile(raw)) {
        rejected.push({ slug: raw?.slug || 'unknown', reason: 'Invalid structure' });
        continue;
      }
      const clean = sanitize(raw);
      const check = passesBusinessRules(clean, activeIndustryIds);
      if (!check.pass) {
        rejected.push({ slug: clean.slug, reason: check.reason });
        continue;
      }
      accepted.push(clean);
    }
  
    if (opts.debug) {
      console.log(`[Criteria] Accepted: ${accepted.length}, Rejected: ${rejected.length}`);
      rejected.forEach(r => console.log(`  ✗ ${r.slug}: ${r.reason}`));
    }
  
    return { accepted, rejected };
  }
  
  export function filterOne(raw, activeIndustryIds) {
    const { accepted } = filterByCriteria([raw], activeIndustryIds);
    return accepted[0] || null;
  }