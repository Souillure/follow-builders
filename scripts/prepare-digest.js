#!/usr/bin/env node

// ============================================================================
// Follow Builders — Prepare Digest (Hybrid)
// ============================================================================
// Merges two feed sources:
// 1. Central feeds from zarazhangrui (X tweets, podcasts, blogs)
// 2. Custom YouTube feeds from user's fork (extra podcasts)
//
// Usage: node prepare-digest.js
// Output: JSON to stdout
// ============================================================================

import { readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// -- Constants ---------------------------------------------------------------

const USER_DIR = join(homedir(), '.follow-builders');
const CONFIG_PATH = join(USER_DIR, 'config.json');

// Central feeds (zarazhangrui's — X tweets, podcasts, blogs)
const CENTRAL_FEED_X_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json';
const CENTRAL_FEED_PODCASTS_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json';
const CENTRAL_FEED_BLOGS_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json';

// Custom feeds (user's fork — extra YouTube channels)
const CUSTOM_FEED_PODCASTS_URL = 'https://raw.githubusercontent.com/Souillure/follow-builders/main/feed-podcasts.json';

// Prompts from the central repo (always up to date)
const PROMPTS_BASE = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/prompts';
const PROMPT_FILES = [
  'summarize-podcast.md',
  'summarize-tweets.md',
  'summarize-blogs.md',
  'digest-intro.md',
  'translate.md'
];

// -- Fetch helpers -----------------------------------------------------------

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.text();
}

// -- Main --------------------------------------------------------------------

async function main() {
  const errors = [];

  // 1. Read user config
  let config = {
    language: 'en',
    frequency: 'daily',
    delivery: { method: 'stdout' }
  };
  if (existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
    } catch (err) {
      errors.push(`Could not read config: ${err.message}`);
    }
  }

  // 2. Fetch all feeds (central + custom) in parallel
  const [feedX, centralPodcasts, feedBlogs, customPodcasts] = await Promise.all([
    fetchJSON(CENTRAL_FEED_X_URL),
    fetchJSON(CENTRAL_FEED_PODCASTS_URL),
    fetchJSON(CENTRAL_FEED_BLOGS_URL),
    fetchJSON(CUSTOM_FEED_PODCASTS_URL)
  ]);

  if (!feedX) errors.push('Could not fetch tweet feed');
  if (!centralPodcasts) errors.push('Could not fetch central podcast feed');
  if (!feedBlogs) errors.push('Could not fetch blog feed');
  if (!customPodcasts) errors.push('Could not fetch custom podcast feed');

  // 3. Merge podcast feeds (central + custom, deduplicated by title)
  const centralEpisodes = centralPodcasts?.podcasts || [];
  const customEpisodes = customPodcasts?.podcasts || [];
  const seenTitles = new Set(centralEpisodes.map(e => e.title));
  const mergedPodcasts = [...centralEpisodes];
  for (const ep of customEpisodes) {
    if (!seenTitles.has(ep.title)) {
      mergedPodcasts.push(ep);
      seenTitles.add(ep.title);
    }
  }

  // 4. Load prompts with priority: user custom > remote (GitHub) > local default
  const prompts = {};
  const scriptDir = decodeURIComponent(new URL('.', import.meta.url).pathname);
  const localPromptsDir = join(scriptDir, '..', 'prompts');
  const userPromptsDir = join(USER_DIR, 'prompts');

  for (const filename of PROMPT_FILES) {
    const key = filename.replace('.md', '').replace(/-/g, '_');
    const userPath = join(userPromptsDir, filename);
    const localPath = join(localPromptsDir, filename);

    if (existsSync(userPath)) {
      prompts[key] = await readFile(userPath, 'utf-8');
      continue;
    }

    const remote = await fetchText(`${PROMPTS_BASE}/${filename}`);
    if (remote) {
      prompts[key] = remote;
      continue;
    }

    if (existsSync(localPath)) {
      prompts[key] = await readFile(localPath, 'utf-8');
    } else {
      errors.push(`Could not load prompt: ${filename}`);
    }
  }

  // 5. Build the output
  const x = feedX?.x || [];
  const blogs = feedBlogs?.blogs || [];

  const output = {
    status: 'ok',
    generatedAt: new Date().toISOString(),

    config: {
      language: config.language || 'en',
      frequency: config.frequency || 'daily',
      delivery: config.delivery || { method: 'stdout' }
    },

    podcasts: mergedPodcasts,
    x,
    blogs,

    stats: {
      podcastEpisodes: mergedPodcasts.length,
      xBuilders: x.length,
      totalTweets: x.reduce((sum, a) => sum + a.tweets.length, 0),
      blogPosts: blogs.length,
      feedGeneratedAt: feedX?.generatedAt || centralPodcasts?.generatedAt || feedBlogs?.generatedAt || null
    },

    prompts,
    errors: errors.length > 0 ? errors : undefined
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({
    status: 'error',
    message: err.message
  }));
  process.exit(1);
});
