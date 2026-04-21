// talenthub-backend/seed.js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const INDUSTRIES = [
  { id: 'HR', label: 'Human Resources', desc: 'HR executives and AI HR platform leaders', num: '01', icon: 'I',
    criteria: ['Senior HR executive at Fortune 1000 company', 'Founder or C-level at HR tech or AI HR company with $5M+ funding', 'Widely cited HR industry analyst with published research'] },
  { id: 'VOICE_AI', label: 'Voice AI', desc: 'Speech synthesis and audio intelligence', num: '02', icon: 'II',
    criteria: ['Founder or C-level at voice AI or speech technology company', 'Company must have raised $3M+ or serve 10,000+ active users', 'Principal research scientist at a major voice AI laboratory'] },
  { id: 'AI_AGENTS', label: 'AI Agents', desc: 'Agent frameworks, research, and platforms', num: '03', icon: 'III',
    criteria: ['Founder or leadership at an AI agent framework or platform', 'Senior PM or research lead at a major AI laboratory', 'Influential open-source contributor with 5,000+ GitHub stars'] },
  { id: 'VC', label: 'Venture Capital', desc: 'Investors backing AI-native companies', num: '04', icon: 'IV',
    criteria: ['General Partner or solo capitalist actively investing in AI', 'Led or participated in five or more AI deals in the last two years', 'Managing a $50M+ fund focused on AI-native companies'] },
  { id: 'UNIVERSITY', label: 'Academia', desc: 'AI researchers and university faculty', num: '05', icon: 'V',
    criteria: ['Tenured or tenure-track professor at a top-50 research university', 'Focus on AI, ML, NLP, or Robotics research', 'Leads a recognized AI research laboratory', 'Minimum 1,000+ Google Scholar citations'] },
];

const UNIVERSAL = [
  'Must hold a senior leadership, founder, or principal researcher role',
  'Must have a verifiable public presence across LinkedIn, X, or published work',
  'Must have been professionally active within the last twelve months',
  'Must have publicly accessible education and career history',
];

const PROFILES = [
  { slug: 'josh-bersin', name: 'Josh Bersin', title: 'Global Industry Analyst', company: 'The Josh Bersin Company', industryId: 'HR',
    bio: 'Globally recognized HR industry analyst. Founder of Bersin & Associates (acquired by Deloitte) and The Josh Bersin Company.',
    linkedin: 'https://www.linkedin.com/in/bersin/', twitter: 'https://x.com/Josh_Bersin',
    education: [{ school: 'Stanford University', degree: 'MS, Engineering Management' }, { school: 'Cornell University', degree: 'BS, Engineering' }],
    experience: [{ role: 'Founder & CEO', company: 'The Josh Bersin Company', current: true }, { role: 'Principal, Bersin', company: 'Deloitte Consulting' }] },

  { slug: 'ashutosh-garg', name: 'Ashutosh Garg', title: 'Co-Founder & CEO', company: 'Eightfold AI', industryId: 'HR',
    bio: 'Co-founder and CEO of Eightfold AI, a talent intelligence platform using deep learning.',
    linkedin: 'https://www.linkedin.com/in/ashutoshgarg-eightfold/',
    education: [{ school: 'University of Illinois Urbana-Champaign', degree: 'PhD, Computer Science' }, { school: 'IIT Delhi', degree: 'B.Tech, Computer Science' }],
    experience: [{ role: 'Co-Founder & CEO', company: 'Eightfold AI', current: true }, { role: 'Research Scientist', company: 'Google' }] },

  { slug: 'harrison-chase', name: 'Harrison Chase', title: 'Co-Founder & CEO', company: 'LangChain', industryId: 'AI_AGENTS',
    bio: 'Co-founder and CEO of LangChain, the open-source framework for building applications with large language models.',
    linkedin: 'https://www.linkedin.com/in/harrison-chase-961287118/', twitter: 'https://x.com/hwchase17',
    education: [{ school: 'Harvard University', degree: 'BA, Statistics & Computer Science' }],
    experience: [{ role: 'Co-Founder & CEO', company: 'LangChain', current: true }, { role: 'ML Engineer', company: 'Robust Intelligence' }] },

  { slug: 'andrew-ng', name: 'Andrew Ng', title: 'Founder', company: 'DeepLearning.AI', industryId: 'AI_AGENTS',
    bio: 'Founder of DeepLearning.AI, Landing AI, and AI Fund. Co-founder of Coursera. Adjunct Professor at Stanford.',
    linkedin: 'https://www.linkedin.com/in/andrewyng/', twitter: 'https://x.com/AndrewYNg',
    education: [{ school: 'UC Berkeley', degree: 'PhD, Computer Science' }, { school: 'MIT', degree: 'MS, EECS' }, { school: 'Carnegie Mellon', degree: 'BS' }],
    experience: [{ role: 'Founder', company: 'DeepLearning.AI', current: true }, { role: 'Founder & CEO', company: 'Landing AI', current: true }] },

  { slug: 'scott-stephenson', name: 'Scott Stephenson', title: 'Co-Founder & CEO', company: 'Deepgram', industryId: 'VOICE_AI',
    bio: 'Co-founder and CEO of Deepgram, a leading speech-to-text and voice AI platform. Former particle physicist.',
    linkedin: 'https://www.linkedin.com/in/scottstephenson/', twitter: 'https://x.com/ScottSteph',
    education: [{ school: 'University of Michigan', degree: 'PhD, Particle Physics' }, { school: 'Case Western Reserve', degree: 'BS, Physics' }],
    experience: [{ role: 'Co-Founder & CEO', company: 'Deepgram', current: true }] },

  { slug: 'mati-staniszewski', name: 'Mati Staniszewski', title: 'Co-Founder & CEO', company: 'ElevenLabs', industryId: 'VOICE_AI',
    bio: 'Co-founder and CEO of ElevenLabs, a leader in AI voice synthesis and cloning.',
    linkedin: 'https://www.linkedin.com/in/mati-staniszewski/', twitter: 'https://x.com/matistanis',
    education: [{ school: 'Imperial College London', degree: 'Mathematics' }],
    experience: [{ role: 'Co-Founder & CEO', company: 'ElevenLabs', current: true }, { role: 'Deployment Strategist', company: 'Palantir' }] },

  { slug: 'sarah-guo', name: 'Sarah Guo', title: 'Founder & Managing Partner', company: 'Conviction', industryId: 'VC',
    bio: 'Founder of Conviction, AI-focused venture fund. Host of No Priors podcast.',
    linkedin: 'https://www.linkedin.com/in/sarahguo/', twitter: 'https://x.com/saranormous',
    education: [{ school: 'University of Pennsylvania', degree: 'BS, Wharton & Engineering' }],
    experience: [{ role: 'Founder & Managing Partner', company: 'Conviction', current: true }, { role: 'General Partner', company: 'Greylock Partners' }] },

  { slug: 'vinod-khosla', name: 'Vinod Khosla', title: 'Founder', company: 'Khosla Ventures', industryId: 'VC',
    bio: 'Founder of Khosla Ventures. Co-founder of Sun Microsystems. Early major backer of OpenAI.',
    linkedin: 'https://www.linkedin.com/in/vinodkhosla/', twitter: 'https://x.com/vkhosla',
    education: [{ school: 'Stanford GSB', degree: 'MBA' }, { school: 'IIT Delhi', degree: 'B.Tech' }],
    experience: [{ role: 'Founder', company: 'Khosla Ventures', current: true }, { role: 'Co-Founder', company: 'Sun Microsystems' }] },

  { slug: 'fei-fei-li', name: 'Fei-Fei Li', title: 'Sequoia Professor', company: 'Stanford University', industryId: 'UNIVERSITY',
    bio: 'Sequoia Professor at Stanford and Co-Director of Stanford HAI. Creator of ImageNet. Co-founder of World Labs.',
    linkedin: 'https://www.linkedin.com/in/fei-fei-li-4541247/', twitter: 'https://x.com/drfeifei',
    education: [{ school: 'Caltech', degree: 'PhD, Electrical Engineering' }, { school: 'Princeton University', degree: 'BA, Physics' }],
    experience: [{ role: 'Sequoia Professor', company: 'Stanford University', current: true }, { role: 'Co-Founder & CEO', company: 'World Labs', current: true }] },

  { slug: 'yann-lecun', name: 'Yann LeCun', title: 'Chief AI Scientist', company: 'Meta / NYU', industryId: 'UNIVERSITY',
    bio: 'Chief AI Scientist at Meta and Silver Professor at NYU. 2018 Turing Award laureate. Inventor of convolutional neural networks.',
    linkedin: 'https://www.linkedin.com/in/yann-lecun/', twitter: 'https://x.com/ylecun',
    education: [{ school: 'Sorbonne Université', degree: 'PhD, Computer Science' }],
    experience: [{ role: 'Chief AI Scientist', company: 'Meta', current: true }, { role: 'Silver Professor', company: 'NYU', current: true }] }
];

async function main() {
  console.log('🌱 Seeding database...');

  for (const ind of INDUSTRIES) {
    await prisma.industry.upsert({
      where: { id: ind.id },
      update: ind,
      create: ind,
    });
  }
  console.log(`✅ ${INDUSTRIES.length} industries`);

  await prisma.universalCriteria.deleteMany({});
  await prisma.universalCriteria.createMany({
    data: UNIVERSAL.map((rule, order) => ({ rule, order })),
  });
  console.log(`✅ ${UNIVERSAL.length} universal criteria`);

  for (const p of PROFILES) {
    await prisma.profile.upsert({
      where: { slug: p.slug },
      update: p,
      create: p,
    });
  }
  console.log(`✅ ${PROFILES.length} profiles`);

  console.log('\n🎉 Seeding complete!');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());