// scripts/sync-vendor.mjs — copy alphaTab's shipped browser bundle and Bravura
// fonts out of node_modules into webview/.
//
// These files are vendored rather than bundled because the webview loads them as
// plain <script>/font URLs, not through webpack. Before this script existed they
// were hand-copied, so `npm install` could bump @coderline/alphatab without
// touching webview/ and nobody would notice the version skew.
//
//   node scripts/sync-vendor.mjs           copy (overwrite webview/)
//   node scripts/sync-vendor.mjs --check   compare only, exit 1 on drift
//
// INVARIANT: webview/font/ must stay a sibling of webview/alphaTab.min.js.
// Nothing sets core.fontDirectory, so alphaTab derives the Bravura path from the
// script URL. Moving either one breaks glyph rendering with no clear error.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'node_modules', '@coderline', 'alphatab', 'dist');
const DEST = path.join(ROOT, 'webview');

// Bravura.eot (IE-only) and Bravura.svg (dropped from Blink in 2015) are
// deliberately not synced — no webview engine can use them and they cost 2.2 MB.
const ASSETS = [
    ['alphaTab.min.js', 'alphaTab.min.js'],
    ['font/Bravura.otf', 'font/Bravura.otf'],
    ['font/Bravura.woff', 'font/Bravura.woff'],
    ['font/Bravura.woff2', 'font/Bravura.woff2'],
];

const checkOnly = process.argv.includes('--check');

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

if (!fs.existsSync(SRC)) {
    console.error(`alphaTab dist not found at ${SRC} — run \`npm install\` first.`);
    process.exit(2);
}

const version = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'node_modules', '@coderline', 'alphatab', 'package.json'), 'utf-8')
).version;

const drift = [];
for (const [from, to] of ASSETS) {
    const src = path.join(SRC, from);
    const dest = path.join(DEST, to);
    if (!fs.existsSync(src)) {
        console.error(`missing in node_modules: ${from}`);
        process.exit(2);
    }
    const same = fs.existsSync(dest) && sha256(src) === sha256(dest);
    if (same) {
        continue;
    }
    if (checkOnly) {
        drift.push(to);
        continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`synced webview/${to}`);
}

if (checkOnly && drift.length > 0) {
    console.error(
        `vendored assets are stale against @coderline/alphatab@${version}:\n` +
        drift.map((f) => `  webview/${f}`).join('\n') +
        `\nrun: npm run sync:vendor`
    );
    process.exit(1);
}

console.log(
    checkOnly
        ? `vendored assets match @coderline/alphatab@${version}`
        : `vendor sync complete (@coderline/alphatab@${version})`
);
