'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const script = path.resolve(__dirname, '..', 'install', 'windows', 'diagWindows.js');

function runDiag(args) {
    return spawnSync(process.execPath, [script, 'diag', ...args], {
        encoding: 'utf8',
        timeout: 60000,
        windowsHide: true,
    });
}

test('Windows diagnostics shows help', { skip: process.platform !== 'win32' }, () => {
    const result = runDiag(['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: iob diag/);
    assert.match(result.stdout, /--summary/);
});

test('Windows diagnostics rejects unknown options', { skip: process.platform !== 'win32' }, () => {
    const result = runDiag(['--unknown']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown option/);
});

test('Windows diagnostics produces a summary', { skip: process.platform !== 'win32' }, () => {
    const result = runDiag(['--summary']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SUMMARY/);
    assert.match(result.stdout.toLowerCase(), new RegExp(require('node:os').hostname().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(result.stdout, /Windows/);
    assert.match(result.stdout, /Node\.js/);
});
