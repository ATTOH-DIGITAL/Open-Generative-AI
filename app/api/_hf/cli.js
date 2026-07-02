// Own-stack provider: translate studio API calls to the official Higgsfield CLI.
// Active when NEXT_PUBLIC_PROVIDER=higgsfield (see middleware.js). The CLI owns
// auth, token refresh and endpoint drift — this layer only maps params and
// normalizes responses to the Muapi-shaped contract the client already speaks.
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import modelMap from './model-map.json' with { type: 'json' };

const HF_BIN = process.env.HIGGSFIELD_CLI || 'higgsfield';
const FLAG_RE = /^[a-z][a-z0-9_]*$/;

// Payload keys forwarded as plain --flag value pairs.
const PARAM_FLAGS = [
    'prompt', 'negative_prompt', 'aspect_ratio', 'resolution', 'duration',
    'quality', 'mode', 'seed', 'strength', 'steps', 'guidance_scale', 'style',
];

// Payload keys carrying media; mapped to the CLI's dedicated media flags.
const MEDIA_FLAGS = {
    image_url: '--image',
    start_image: '--start-image',
    start_image_url: '--start-image',
    end_image_url: '--end-image',
    last_image: '--end-image',
    video_url: '--video',
    audio_url: '--audio',
};

export function hf(args, { timeoutMs = 120_000 } = {}) {
    return new Promise((resolve) => {
        execFile(HF_BIN, [...args, '--json', '--no-color'], {
            timeout: timeoutMs,
            maxBuffer: 32 * 1024 * 1024,
        }, (error, stdout, stderr) => {
            resolve({ error, stdout: stdout || '', stderr: stderr || '' });
        });
    });
}

export function parseJsonLoose(text) {
    try { return JSON.parse(text); } catch { /* fall through */ }
    const start = text.search(/[[{]/);
    if (start === -1) return null;
    try { return JSON.parse(text.slice(start)); } catch { return null; }
}

export function resolveModel(endpoint) {
    const slug = String(endpoint || '').trim();
    return modelMap[slug] || slug.replace(/-/g, '_');
}

// Fetch a remote/data URL into a tmp file so the CLI can upload it.
export async function stageMedia(value) {
    if (typeof value !== 'string' || value === '') return null;
    // Already an upload/job UUID → pass through untouched.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hf-media-'));
    if (value.startsWith('data:')) {
        const m = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
        if (!m) return null;
        const ext = (m[1] || 'image/png').split('/')[1]?.split('+')[0] || 'png';
        const file = path.join(dir, `input-${crypto.randomUUID()}.${ext}`);
        await fs.writeFile(file, Buffer.from(decodeURIComponent(m[3]), m[2] ? 'base64' : 'utf8'));
        return file;
    }
    if (/^https?:\/\//.test(value)) {
        const res = await fetch(value);
        if (!res.ok) throw new Error(`media fetch failed: ${res.status} ${value.slice(0, 120)}`);
        const ext = (res.headers.get('content-type') || 'image/png').split('/')[1]?.split(';')[0] || 'png';
        const file = path.join(dir, `input-${crypto.randomUUID()}.${ext}`);
        await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
        return file;
    }
    return null;
}

export async function buildCreateArgs(endpoint, payload = {}) {
    const args = ['generate', 'create', resolveModel(endpoint)];
    for (const key of PARAM_FLAGS) {
        const v = payload[key];
        if (v === undefined || v === null || v === '' || v === -1) continue;
        if (!FLAG_RE.test(key)) continue;
        args.push(`--${key}`, String(v));
    }
    for (const [key, flag] of Object.entries(MEDIA_FLAGS)) {
        const staged = await stageMedia(payload[key]);
        if (staged) args.push(flag, staged);
    }
    const list = Array.isArray(payload.images_list) ? payload.images_list : [];
    for (const item of list) {
        const staged = await stageMedia(item);
        if (staged) args.push('--image', staged);
    }
    return args;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Depth-first hunt for the job id in whatever shape the CLI returns.
export function extractJobId(data) {
    if (!data || typeof data !== 'object') return null;
    if (Array.isArray(data.jobs) && data.jobs[0]?.id) return String(data.jobs[0].id);
    for (const key of ['job_id', 'id', 'job_set_id', 'request_id']) {
        if (typeof data[key] === 'string' && UUID_RE.test(data[key])) return data[key];
    }
    for (const v of Object.values(data)) {
        if (v && typeof v === 'object') {
            const found = extractJobId(v);
            if (found) return found;
        }
    }
    return null;
}

const MEDIA_URL_RE = /^https?:\/\/\S+\.(png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|glb)(\?\S*)?$/i;
const URL_KEYS = new Set(['url', 'raw', 'min', 'output', 'result', 'video', 'image']);

export function extractMediaUrls(data, out = []) {
    if (typeof data === 'string') {
        if (MEDIA_URL_RE.test(data)) out.push(data);
        return out;
    }
    if (Array.isArray(data)) { data.forEach(v => extractMediaUrls(v, out)); return out; }
    if (data && typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) {
            if (typeof v === 'string' && URL_KEYS.has(k) && /^https?:\/\//.test(v)) out.push(v);
            else extractMediaUrls(v, out);
        }
    }
    return [...new Set(out)];
}

export function extractStatus(data) {
    if (!data || typeof data !== 'object') return null;
    for (const key of ['status', 'state']) {
        if (typeof data[key] === 'string') return data[key].toLowerCase();
    }
    if (Array.isArray(data.jobs)) {
        const statuses = data.jobs.map(j => extractStatus(j)).filter(Boolean);
        if (statuses.length) {
            if (statuses.some(s => /fail|error|nsfw|cancel/.test(s))) return 'failed';
            if (statuses.every(s => /complete|succe|done|finish/.test(s))) return 'completed';
            return 'processing';
        }
    }
    return null;
}
