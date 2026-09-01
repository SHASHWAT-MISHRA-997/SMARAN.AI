/**
 * Which model to use, and where the keys live.
 *
 * Keys go in VS Code's SecretStorage - the OS keychain - rather than in
 * settings.json. A key in settings.json is a key in a plain text file that
 * Settings Sync copies to every machine you sign in on and that anybody
 * screen-sharing your editor can read. The old `smaran.apiKeys` setting is
 * still read once and moved across, so nothing anyone already typed is lost,
 * and it is emptied afterwards so it does not sit there as a copy.
 *
 * Nothing here needs the SMARAN.AI app. If it is installed, keys already
 * entered there are read off disk as a convenience - the app does not have to
 * be running, and does not have to exist.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { Choice, firstInstalledOllamaModel } from './agent/models';

const DEFAULT_OLLAMA = 'http://127.0.0.1:11434';
const DEFAULT_LM_STUDIO = 'http://127.0.0.1:1234/v1';
const SECRET = (provider: string) => `smaran.key.${provider}`;

/** Keys the desktop app has saved, if it is installed. */
function keysFromInstalledApp(): Record<string, string> {
    const roots = [
        process.env.LOCALAPPDATA,
        path.join(os.homedir(), 'Library', 'Application Support'),
        path.join(os.homedir(), '.local', 'share'),
        os.homedir(),
    ].filter(Boolean) as string[];

    for (const root of roots) {
        const file = path.join(root, 'SMARAN.AI', 'data', 'cloud_keys.json');
        try {
            if (fs.existsSync(file)) {
                const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (parsed && typeof parsed === 'object') {
                    return parsed as Record<string, string>;
                }
            }
        } catch {
            // Unreadable or malformed is not worth reporting: this is a
            // convenience, and the panel's own fields are the real source.
        }
    }
    return {};
}

export class Keys {
    constructor(private readonly secrets: vscode.SecretStorage) {}

    /** Move anything in the old plain-text setting into the keychain, once. */
    async migrate(): Promise<string[]> {
        const config = vscode.workspace.getConfiguration('smaran');
        const inSettings = config.get<Record<string, string>>('apiKeys') || {};
        const moved: string[] = [];

        for (const [name, value] of Object.entries(inSettings)) {
            const provider = name === 'openRouter' ? 'openrouter' : name;
            if (typeof value === 'string' && value.trim()) {
                await this.secrets.store(SECRET(provider), value.trim());
                moved.push(provider);
            }
        }
        if (moved.length) {
            try {
                await config.update('apiKeys', {}, vscode.ConfigurationTarget.Global);
            } catch {
                // A workspace-level setting cannot always be cleared from
                // here. The key is safe in the keychain either way.
            }
        }
        return moved;
    }

    async get(provider: string): Promise<string> {
        if (!provider) {
            return '';
        }
        const stored = await this.secrets.get(SECRET(provider));
        if (stored) {
            return stored;
        }
        const fromApp = keysFromInstalledApp();
        return (fromApp[provider] || (provider === 'openrouter' ? fromApp.openRouter : '') || '').trim();
    }

    async set(provider: string, key: string): Promise<void> {
        if (key.trim()) {
            await this.secrets.store(SECRET(provider), key.trim());
        } else {
            await this.secrets.delete(SECRET(provider));
        }
    }

    /** Which providers have a key, without handing the keys themselves out. */
    async configured(): Promise<Record<string, boolean>> {
        const out: Record<string, boolean> = {};
        for (const provider of ['groq', 'gemini', 'openrouter', 'nvidia', 'anthropic', 'openai', 'deepseek']) {
            out[provider] = Boolean(await this.get(provider));
        }
        return out;
    }
}

export interface Resolved extends Choice {
    /** Something a person can act on when there is no model to use at all. */
    problem?: string;
}

export function ollamaUrl(): string {
    return (vscode.workspace.getConfiguration('smaran').get<string>('ollamaUrl') || DEFAULT_OLLAMA).trim();
}

export function lmStudioUrl(): string {
    return (vscode.workspace.getConfiguration('smaran').get<string>('lmStudioUrl') || DEFAULT_LM_STUDIO).trim();
}

export async function resolveChoice(keys: Keys): Promise<Resolved> {
    const config = vscode.workspace.getConfiguration('smaran');
    const provider = (config.get<string>('provider') || '').trim();
    const url = ollamaUrl();
    let model = (config.get<string>('model') || '').trim();

    const lmStudio = lmStudioUrl();

    if (!provider) {
        // No provider means a model on this machine. Which one is worth
        // finding rather than demanding: most people have one and could not
        // tell you its exact tag.
        if (!model) {
            model = (await firstInstalledOllamaModel(url)) || '';
        }
        return {
            provider: '', model, apiKey: '', ollamaUrl: url, lmStudioUrl: lmStudio,
            problem: model ? undefined : 'no-model',
        };
    }

    // The local runners have no key to check; whether they are running is
    // something only the request itself can answer.
    if (provider === 'lmstudio') {
        return {
            provider, model, apiKey: '', ollamaUrl: url, lmStudioUrl: lmStudio,
            problem: model ? undefined : 'no-model-chosen',
        };
    }

    const apiKey = await keys.get(provider);
    return {
        provider, model, apiKey, ollamaUrl: url, lmStudioUrl: lmStudio,
        problem: apiKey ? (model ? undefined : 'no-model-chosen') : 'no-key',
    };
}
