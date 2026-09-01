/**
 * Counting installs and launches of the extension.
 *
 * Nothing but the desktop app ever reported anything, so the dashboard could
 * only say "windows" - the extension was invisible however many people had it
 * installed.
 *
 * Four fields go out and nothing else: a random id for this installation, the
 * word "install" or "launch", the platform - "vscode", counted separately
 * from the desktop app - and the version. No file, no task, no key, no
 * project name, no path.
 *
 * The id is generated here and kept in the extension's own storage. It is not
 * derived from the machine, the user, or anything VS Code knows about them.
 *
 * Off with the smaran.usageReporting setting, and inert in any build that was
 * not given an endpoint - which a source checkout is.
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import * as vscode from 'vscode';

/* Written by bake-analytics.js at build time. Reading process.env here would
   read the editor's environment, not the machine that packaged this, so it
   was always empty and nothing was ever sent. A checkout bakes empty strings,
   and then nothing is sent - the same default the desktop app has. */
import { ENDPOINT as BAKED_ENDPOINT, INGEST_KEY as BAKED_KEY } from './analyticsConfig';

const ENDPOINT = BAKED_ENDPOINT.trim();
const KEY = BAKED_KEY.trim();

const ID = 'smaran.installId';
const SEEN = 'smaran.reportedInstall';

function send(event: string, installId: string, version: string): void {
    let target: URL;
    try {
        target = new URL(`${ENDPOINT.replace(/\/+$/, '')}/ingest`);
    } catch {
        return;
    }
    const payload = JSON.stringify({
        install_id: installId,
        event,
        platform: 'vscode',
        app_version: version,
        os_version: process.platform,
    });

    const request = (target.protocol === 'https:' ? https : http).request(
        target,
        {
            method: 'POST',
            timeout: 8000,
            headers: {
                'Content-Type': 'application/json',
                'X-Ingest-Key': KEY,
                'Content-Length': Buffer.byteLength(payload),
            },
        },
        (response) => response.resume(),
    );
    // A counter must never be why the editor stutters or an activation fails.
    request.on('error', () => undefined);
    request.on('timeout', () => request.destroy());
    request.write(payload);
    request.end();
}

export async function reportStartup(context: vscode.ExtensionContext): Promise<void> {
    if (!ENDPOINT || !KEY) {
        return;
    }
    if (!vscode.workspace.getConfiguration('smaran').get<boolean>('usageReporting', true)) {
        return;
    }

    let installId = context.globalState.get<string>(ID);
    if (!installId) {
        installId = [...Array(16)]
            .map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0'))
            .join('');
        await context.globalState.update(ID, installId);
    }

    const version = vscode.extensions.getExtension('ShashwatMishra.smaran-ai-codex')
        ?.packageJSON?.version || 'unknown';

    if (context.globalState.get<boolean>(SEEN)) {
        send('launch', installId, version);
        return;
    }
    await context.globalState.update(SEEN, true);
    send('install', installId, version);
}
