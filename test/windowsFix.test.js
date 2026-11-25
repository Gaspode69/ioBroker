'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    cleanupNpmTemporaryDirectories,
    repairNpmConfig,
    stopWindowsService,
    validateInstallation,
} = require('../lib-npx/windowsFix.js');

function temporaryDirectory(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iobroker-windows-fix-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return directory;
}

test('validateInstallation accepts an ioBroker installation and rejects another directory', t => {
    const rootDir = temporaryDirectory(t);
    assert.throws(() => validateInstallation(rootDir), /ioBroker is not installed/);

    fs.mkdirSync(path.join(rootDir, 'iobroker-data'));
    fs.mkdirSync(path.join(rootDir, 'node_modules', 'iobroker.js-controller'), { recursive: true });
    assert.doesNotThrow(() => validateInstallation(rootDir));
});

test('repairNpmConfig preserves unrelated settings and replaces fixer-owned values', t => {
    const rootDir = temporaryDirectory(t);
    fs.writeFileSync(
        path.join(rootDir, '.npmrc'),
        ['registry=https://registry.npmjs.org/', 'audit=true', 'engine-strict=false', 'update-notifier=true', ''].join('\n'),
    );

    repairNpmConfig(rootDir);
    repairNpmConfig(rootDir);

    const result = fs.readFileSync(path.join(rootDir, '.npmrc'), 'utf8');
    assert.match(result, /registry=https:\/\/registry\.npmjs\.org\//);
    assert.match(result, /audit=false/);
    assert.match(result, /update-notifier=false/);
    assert.match(result, /engine-strict=true/);
    assert.equal((result.match(/audit=false/g) || []).length, 1);
    assert.doesNotMatch(result, /audit=true|engine-strict=false|update-notifier=true/);
});

test('cleanupNpmTemporaryDirectories only removes npm temporary directories', t => {
    const rootDir = temporaryDirectory(t);
    const nodeModulesDir = path.join(rootDir, 'node_modules');
    const abandoned = path.join(nodeModulesDir, 'some-package', '.staging-12345678');
    const retained = path.join(nodeModulesDir, 'some-package', 'normal-directory');
    const chromium = path.join(nodeModulesDir, '.local-chromium');
    fs.mkdirSync(abandoned, { recursive: true });
    fs.mkdirSync(retained, { recursive: true });
    fs.mkdirSync(chromium, { recursive: true });

    const removed = cleanupNpmTemporaryDirectories(rootDir);

    assert.deepEqual(removed, [abandoned]);
    assert.equal(fs.existsSync(abandoned), false);
    assert.equal(fs.existsSync(retained), true);
    assert.equal(fs.existsSync(chromium), true);
});

test('stopWindowsService honors a custom service name from .env', t => {
    const rootDir = temporaryDirectory(t);
    const serviceExecutable = path.join(rootDir, 'daemon', 'my-iobroker.exe');
    fs.mkdirSync(path.dirname(serviceExecutable));
    fs.writeFileSync(serviceExecutable, 'placeholder');
    fs.writeFileSync(path.join(rootDir, '.env'), 'iobServiceName=My-ioBroker\n');
    let invocation;

    stopWindowsService(rootDir, {
        execFileSync: (file, args, options) => {
            invocation = { file, args, options };
            return Buffer.alloc(0);
        },
    });

    assert.deepEqual(invocation, {
        file: serviceExecutable,
        args: ['stop'],
        options: { cwd: rootDir, stdio: 'inherit' },
    });
});

test('stopWindowsService aborts the repair when the service cannot be stopped', t => {
    const rootDir = temporaryDirectory(t);
    const serviceExecutable = path.join(rootDir, 'daemon', 'iobroker.exe');
    fs.mkdirSync(path.dirname(serviceExecutable));
    fs.writeFileSync(serviceExecutable, 'placeholder');

    assert.throws(
        () => stopWindowsService(rootDir, { execFileSync: () => { throw new Error('access denied'); } }),
        /elevated command prompt.*access denied/,
    );
});
