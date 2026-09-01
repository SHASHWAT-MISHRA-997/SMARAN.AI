/**
 * Which model to use, from the settings and from what is already on the
 * machine.
 *
 * Nothing here needs the SMARAN.AI app. If it happens to be installed, the
 * keys already entered there are read so that they do not have to be typed in
 * twice - but the file is read straight off the disk and the app does not have
 * to be running for that.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { Choice, firstInstalledOllamaModel } from './agent/models';

const DEFAULT_OLLAMA = 'http://127.0.0.1:11434';

/** Keys the app has saved, if it is installed. Never requires it to be running. */
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
            // A malformed or unreadable file is not worth reporting; the
            // settings are the primary source and this is a convenience.
        }
    }
    return {};
}

export interface Resolved extends Choice {
    /** Something a person can act on when there is no model to use at all. */
    problem?: string;
}

export async function resolveChoice(): Promise<Resolved> {
    const config = vscode.workspace.getConfiguration('smaran');
    const provider = (config.get<string>('provider') || '').trim();
    const ollamaUrl = (config.get<string>('ollamaUrl') || DEFAULT_OLLAMA).trim();
    let model = (config.get<string>('model') || '').trim();

    const settingKeys = config.get<Record<string, string>>('apiKeys') || {};
    const appKeys = keysFromInstalledApp();
    const keyFor = (name: string) =>
        (settingKeys[name]
            || (name === 'openrouter' ? settingKeys.openRouter : undefined)
            || appKeys[name]
            || (name === 'openrouter' ? appKeys.openRouter : undefined)
            || '').trim();

    if (!provider) {
        // No provider means a model on this machine. Which one is worth
        // finding rather than demanding: most people have one and do not know
        // its exact tag.
        if (!model) {
            model = (await firstInstalledOllamaModel(ollamaUrl)) || '';
        }
        return {
            provider: '',
            model,
            apiKey: '',
            ollamaUrl,
            problem: model
                ? undefined
                : 'No model is set and Ollama has none installed. Either install one '
                  + '(ollama pull qwen2.5-coder:7b), or set smaran.provider and a key in smaran.apiKeys.',
        };
    }

    const apiKey = keyFor(provider);
    return {
        provider,
        model,
        apiKey,
        ollamaUrl,
        problem: apiKey
            ? (model ? undefined : `Set smaran.model to the ${provider} model you want, for example a "flash" or "coder" one.`)
            : `smaran.provider is set to ${provider} but there is no key for it in smaran.apiKeys.`,
    };
}
