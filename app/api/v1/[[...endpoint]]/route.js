// Own-stack generation routes (NEXT_PUBLIC_PROVIDER=higgsfield).
// Serves the same contract the Muapi client speaks:
//   POST /api/v1/<endpoint>                 -> submit, returns { request_id }
//   GET  /api/v1/predictions/<id>/result    -> { status, outputs: [...] }
// When the provider env is not set, middleware.js rewrites these paths to
// api.muapi.ai before they ever reach this handler (upstream behaviour).
import { NextResponse } from 'next/server';
import {
    hf, parseJsonLoose, buildCreateArgs,
    extractJobId, extractMediaUrls, extractStatus,
} from '../../_hf/cli.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ownStack = () => process.env.NEXT_PUBLIC_PROVIDER === 'higgsfield';

export async function POST(request, { params }) {
    if (!ownStack()) return NextResponse.json({ error: 'own-stack provider disabled' }, { status: 404 });
    const segments = (await params).endpoint || [];
    const endpoint = segments.join('/');
    if (!endpoint || endpoint.startsWith('predictions')) {
        return NextResponse.json({ error: 'unknown endpoint' }, { status: 404 });
    }

    let payload = {};
    try { payload = await request.json(); } catch { /* empty body is fine */ }

    let args;
    try { args = await buildCreateArgs(endpoint, payload); }
    catch (e) { return NextResponse.json({ error: `media staging failed: ${e.message}` }, { status: 400 }); }

    const { error, stdout, stderr } = await hf(args);
    const data = parseJsonLoose(stdout);
    if (error && !data) {
        return NextResponse.json({ error: (stderr || error.message).slice(0, 500) }, { status: 502 });
    }

    const jobId = extractJobId(data);
    if (!jobId) {
        // Some jobs may return synchronously with URLs and no id.
        const outputs = extractMediaUrls(data);
        if (outputs.length) return NextResponse.json({ status: 'completed', outputs });
        return NextResponse.json({ error: `no job id in CLI response: ${stdout.slice(0, 300)}` }, { status: 502 });
    }
    return NextResponse.json({ request_id: jobId, status: 'processing' });
}

export async function GET(request, { params }) {
    if (!ownStack()) return NextResponse.json({ error: 'own-stack provider disabled' }, { status: 404 });
    const segments = (await params).endpoint || [];
    // Expect predictions/<id>/result
    if (segments[0] !== 'predictions' || !segments[1]) {
        return NextResponse.json({ error: 'unknown endpoint' }, { status: 404 });
    }
    const jobId = segments[1];
    if (!/^[0-9a-f-]{16,64}$/i.test(jobId)) {
        return NextResponse.json({ error: 'bad job id' }, { status: 400 });
    }

    // Short blocking wait per poll tick; a CLI timeout just means "still running".
    const { error, stdout, stderr } = await hf(
        ['generate', 'wait', jobId, '--timeout', '8s', '--quiet'],
        { timeoutMs: 20_000 },
    );
    const data = parseJsonLoose(stdout);
    const status = extractStatus(data);
    const outputs = extractMediaUrls(data);

    if (outputs.length && (!status || /complete|succe|done|finish/.test(status))) {
        return NextResponse.json({ status: 'completed', outputs });
    }
    if (status && /fail|error|nsfw|cancel/.test(status)) {
        return NextResponse.json({ status: 'failed', error: stderr.slice(0, 300) || 'generation failed' });
    }
    if (error && !data && !/timeout|timed out|deadline/i.test(`${stderr}${error.message}`)) {
        return NextResponse.json({ status: 'failed', error: (stderr || error.message).slice(0, 300) });
    }
    return NextResponse.json({ status: 'processing' });
}
