#!/usr/bin/env node
/**
 * Turns the changelog fragments in `changes/` into a CHANGELOG section.
 *
 * Usage (from the repository root, Node 18+, no dependencies):
 *   node scripts/changelog.mjs --version X.Y.Z [--date YYYY-MM-DD]
 *       Writes a `## [X.Y.Z] - date` section at the top of `CHANGELOG.md`,
 *       a shorter one in `vscode-extension/CHANGELOG.md` (scopes `language`,
 *       `editor`, `vscode` only), and deletes the fragments it used.
 *   node scripts/changelog.mjs --check
 *       Checks every fragment (front matter, known `type`, known `scope`).
 *   node scripts/changelog.mjs --notes X.Y.Z
 *       Prints the section of that version (the body of the GitHub release).
 *
 * `--root <dir>` runs the script on another folder (the tests use it).
 * The format of a fragment is in `changes/README.md`.
 */
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Keep a Changelog order. */
export const TYPES = ['added', 'changed', 'deprecated', 'removed', 'fixed', 'security'];
export const SCOPES = ['language', 'runtime', 'cli', 'node', 'nestjs', 'browser', 'editor', 'vscode', 'playground', 'docs', 'build'];
/** The scopes that appear in the extension changelog. */
export const EXTENSION_SCOPES = ['language', 'editor', 'vscode'];

const REPO_URL = 'https://github.com/shams-app/minab';
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads one fragment. Throws an Error that names the file when it is not valid.
 * @returns {{ name: string, type: string, scope: string, breaking: boolean, text: string }}
 */
export function parseFragment(source, name) {
    const match = source.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) throw new Error(`${name}: the front matter is missing (it must start with a line "---")`);
    const fields = {};
    for (const line of match[1].split('\n')) {
        if (!line.trim()) continue;
        const pair = line.match(/^([a-z]+):\s*(.*?)\s*$/);
        if (!pair) throw new Error(`${name}: cannot read the front matter line "${line}"`);
        fields[pair[1]] = pair[2];
    }
    if (!fields.type) throw new Error(`${name}: "type" is missing`);
    if (!TYPES.includes(fields.type)) throw new Error(`${name}: unknown type "${fields.type}" (use one of: ${TYPES.join(', ')})`);
    if (!fields.scope) throw new Error(`${name}: "scope" is missing`);
    if (!SCOPES.includes(fields.scope)) throw new Error(`${name}: unknown scope "${fields.scope}" (use one of: ${SCOPES.join(', ')})`);
    const breaking = fields.breaking ?? 'false';
    if (breaking !== 'true' && breaking !== 'false') throw new Error(`${name}: "breaking" must be true or false`);
    const text = match[2].trim().replace(/\s*\n\s*/g, ' ');
    if (!text) throw new Error(`${name}: the text is empty`);
    return { name, type: fields.type, scope: fields.scope, breaking: breaking === 'true', text };
}

/** Every fragment in `<root>/changes`, sorted by file name. */
export function readFragments(root) {
    const dir = resolve(root, 'changes');
    if (!existsSync(dir)) return { fragments: [], errors: [] };
    const fragments = [];
    const errors = [];
    for (const file of readdirSync(dir).sort()) {
        if (!file.endsWith('.md') || file === 'README.md') continue;
        try {
            fragments.push(parseFragment(readFileSync(resolve(dir, file), 'utf8'), `changes/${file}`));
        } catch (error) {
            errors.push(error.message);
        }
    }
    return { fragments, errors };
}

const bullet = fragment => `- ${fragment.breaking ? '**Breaking:** ' : ''}${fragment.text}`;
const heading = type => type.charAt(0).toUpperCase() + type.slice(1);

/** The section for CHANGELOG.md. */
export function renderSection(fragments, version, date) {
    const lines = [`## [${version}] - ${date}`];
    for (const type of TYPES) {
        const items = fragments.filter(f => f.type === type && f.scope !== 'playground');
        if (items.length) lines.push('', `### ${heading(type)}`, '', ...items.map(bullet));
    }
    const playground = fragments.filter(f => f.scope === 'playground');
    if (playground.length) lines.push('', '### Playground', '', ...playground.map(bullet));
    return lines.join('\n');
}

/** The shorter section for the extension changelog. */
export function renderExtensionSection(fragments, version) {
    const items = TYPES.flatMap(type => fragments.filter(f => f.type === type && EXTENSION_SCOPES.includes(f.scope)));
    const body = items.length ? items.map(bullet) : ['No change for the extension in this release.'];
    return [`## ${version}`, '', ...body].join('\n');
}

const linkLine = version => `[${version}]: ${REPO_URL}/releases/tag/v${version}`;

/** Puts a section before the first `## ` heading, and its link before the first link line (or at the end). */
export function insertSection(changelog, section, version) {
    const text = changelog.replace(/\r\n/g, '\n');
    const hasVersion = new RegExp(`^## \\[?${version.replace(/[.+]/g, '\\$&')}\\]?(\\s|$)`, 'm');
    if (hasVersion.test(text)) throw new Error(`the changelog already has a section for ${version}`);
    const firstHeading = text.search(/^## /m);
    let result = firstHeading === -1 ? `${text.trimEnd()}\n\n${section}\n` : `${text.slice(0, firstHeading)}${section}\n\n${text.slice(firstHeading)}`;
    const firstLink = result.search(/^\[[^\]]+\]: /m);
    if (firstLink === -1) {
        result = `${result.trimEnd()}\n\n${linkLine(version)}\n`;
    } else {
        result = `${result.slice(0, firstLink)}${linkLine(version)}\n${result.slice(firstLink)}`;
    }
    return result;
}

/** The section of one version, without its link line. Throws when the version is not there. */
export function extractNotes(changelog, version) {
    const lines = changelog.replace(/\r\n/g, '\n').split('\n');
    const escaped = version.replace(/[.+]/g, '\\$&');
    const start = lines.findIndex(line => new RegExp(`^## \\[?${escaped}\\]?(\\s|$)`).test(line));
    if (start === -1) throw new Error(`no section for ${version} in the changelog`);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^## /.test(lines[i]) || /^\[[^\]]+\]: /.test(lines[i])) {
            end = i;
            break;
        }
    }
    return lines
        .slice(start + 1, end)
        .join('\n')
        .trim();
}

function option(args, name) {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
}

/** Runs the command line. Returns the exit code. */
export function main(args) {
    const root = resolve(option(args, '--root') ?? DEFAULT_ROOT);
    try {
        if (args.includes('--check')) {
            const { fragments, errors } = readFragments(root);
            for (const error of errors) console.error(error);
            if (errors.length) return 1;
            console.log(`${fragments.length} changelog fragment(s) ok`);
            return 0;
        }
        if (args.includes('--notes')) {
            const version = option(args, '--notes');
            if (!version || !VERSION.test(version)) throw new Error('--notes needs a version like 0.2.0');
            console.log(extractNotes(readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8'), version));
            return 0;
        }
        if (args.includes('--version')) {
            const version = option(args, '--version');
            if (!version || !VERSION.test(version)) throw new Error('--version needs a version like 0.2.0');
            const date = option(args, '--date') ?? new Date().toISOString().slice(0, 10);
            if (!DATE.test(date)) throw new Error('--date needs the form YYYY-MM-DD');
            const { fragments, errors } = readFragments(root);
            if (errors.length) {
                for (const error of errors) console.error(error);
                return 1;
            }
            if (!fragments.length) throw new Error('there are no fragments in changes/');
            const rootPath = resolve(root, 'CHANGELOG.md');
            const extensionPath = resolve(root, 'vscode-extension/CHANGELOG.md');
            // Compute both results first, so a failure writes nothing.
            const rootResult = insertSection(readFileSync(rootPath, 'utf8'), renderSection(fragments, version, date), version);
            const extensionResult = insertSection(readFileSync(extensionPath, 'utf8'), renderExtensionSection(fragments, version), version);
            writeFileSync(rootPath, rootResult);
            writeFileSync(extensionPath, extensionResult);
            for (const fragment of fragments) unlinkSync(resolve(root, fragment.name));
            console.log(`wrote the ${version} section; removed ${fragments.length} fragment(s)`);
            return 0;
        }
        console.error('usage: changelog.mjs --version X.Y.Z [--date YYYY-MM-DD] | --check | --notes X.Y.Z');
        return 2;
    } catch (error) {
        console.error(error.message);
        return 1;
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    process.exitCode = main(process.argv.slice(2));
}
