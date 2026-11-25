// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, execSync } = require('node:child_process');

const FIXER_VERSION = '2026-11-24';
const TEMP_DIRECTORY_PATTERN = /^\..+-.{8}$/;

/** @param {string} rootDir */
function validateInstallation(rootDir) {
    const requiredPaths = [
        path.join(rootDir, 'iobroker-data'),
        path.join(rootDir, 'node_modules', 'iobroker.js-controller'),
    ];
    const missing = requiredPaths.filter(requiredPath => !fs.existsSync(requiredPath));
    if (missing.length) {
        throw new Error(
            `ioBroker is not installed in "${rootDir}". Missing: ${missing
                .map(missingPath => path.relative(rootDir, missingPath))
                .join(', ')}`,
        );
    }
}

/**
 * @param {string} rootDir
 * @param {{ execFileSync?: typeof execFileSync }} [options]
 */
function stopWindowsService(rootDir, options = {}) {
    const run = options.execFileSync || execFileSync;
    let serviceName = process.env.iobServiceName;
    const dotenvPath = path.join(rootDir, '.env');
    if (!serviceName && fs.existsSync(dotenvPath)) {
        const match = /^\s*iobServiceName\s*=\s*["']?([^\r\n"']+)["']?\s*$/im.exec(fs.readFileSync(dotenvPath, 'utf8'));
        serviceName = match && match[1].trim();
    }
    serviceName ||= 'ioBroker';
    const serviceExecutable = path.join(rootDir, 'daemon', `${serviceName.toLowerCase()}.exe`);

    if (!fs.existsSync(serviceExecutable)) {
        console.log('No installed Windows service found; continuing.');
        return;
    }

    try {
        run(serviceExecutable, ['stop'], { cwd: rootDir, stdio: 'inherit' });
    } catch (error) {
        throw new Error(
            `The Windows service could not be stopped. Run iob fix from an elevated command prompt. ${error.message}`,
            { cause: error },
        );
    }
}

/** @param {string} rootDir */
function repairNpmConfig(rootDir) {
    const npmrcPath = path.join(rootDir, '.npmrc');
    const desiredSettings = new Map([
        ['audit', 'false'],
        ['update-notifier', 'false'],
        ['engine-strict', 'true'],
    ]);
    const input = fs.existsSync(npmrcPath) ? fs.readFileSync(npmrcPath, 'utf8') : '';
    const outputLines = input
        .split(/\r?\n/)
        .filter((line, index, lines) => index < lines.length - 1 || line !== '')
        .filter(line => {
            const match = /^\s*([^#;=\s]+)\s*=/.exec(line);
            return !match || !desiredSettings.has(match[1].toLowerCase());
        });

    if (outputLines.length && outputLines[outputLines.length - 1] !== '') {
        outputLines.push('');
    }
    outputLines.push(
        '# Maintained by iob fix',
        ...Array.from(desiredSettings, ([key, value]) => `${key}=${value}`),
        '',
    );
    fs.writeFileSync(npmrcPath, outputLines.join('\r\n'), 'utf8');
}

/**
 * @param {string} rootDir
 * @returns {string[]} removed absolute paths
 */
function cleanupNpmTemporaryDirectories(rootDir) {
    const nodeModulesDir = path.join(rootDir, 'node_modules');
    if (!fs.existsSync(nodeModulesDir)) {
        return [];
    }

    /** @type {string[]} */
    const removed = [];
    /** @type {string[]} */
    const pending = [nodeModulesDir];
    while (pending.length) {
        const currentDir = pending.pop();
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.isSymbolicLink()) {
                continue;
            }
            const entryPath = path.join(currentDir, entry.name);
            if (entry.name !== '.local-chromium' && TEMP_DIRECTORY_PATTERN.test(entry.name)) {
                fs.rmSync(entryPath, { recursive: true, force: true });
                removed.push(entryPath);
            } else {
                pending.push(entryPath);
            }
        }
    }
    return removed;
}

/**
 * @param {string} rootDir
 * @param {{ execSync?: typeof execSync }} [options]
 */
function maintainJsonlDatabases(rootDir, options = {}) {
    const run = options.execSync || execSync;
    run('npm x --yes @iobroker/jsonltool@latest', {
        cwd: path.join(rootDir, 'iobroker-data'),
        stdio: 'inherit',
    });
}

/** @param {number} number @param {number} total @param {string} title */
function printStep(number, total, title) {
    console.log(`\n${'-'.repeat(72)}`);
    console.log(`Step ${number}/${total}: ${title}`);
    console.log('-'.repeat(72));
}

/**
 * @param {{
 *   rootDir?: string,
 *   repairInstallation: () => void,
 *   repairService: () => void,
 *   maintainDatabases?: boolean,
 * }} options
 */
function runWindowsFix(options) {
    const rootDir = options.rootDir || process.cwd();
    const totalSteps = 6;

    console.log(`ioBroker Windows Fixer ${FIXER_VERSION}`);
    console.log(`Installation directory: ${rootDir}`);

    printStep(1, totalSteps, 'Checking the installation and stopping ioBroker');
    validateInstallation(rootDir);
    stopWindowsService(rootDir);

    printStep(2, totalSteps, 'Repairing npm configuration');
    repairNpmConfig(rootDir);

    printStep(3, totalSteps, 'Cleaning npm temporary directories');
    const removed = cleanupNpmTemporaryDirectories(rootDir);
    console.log(removed.length ? `Removed ${removed.length} temporary director${removed.length === 1 ? 'y' : 'ies'}.` : 'No temporary directories found.');

    printStep(4, totalSteps, 'Maintaining JSONL databases');
    if (options.maintainDatabases === false) {
        console.log('Database maintenance skipped.');
    } else {
        maintainJsonlDatabases(rootDir);
    }

    printStep(5, totalSteps, 'Repairing installation files and package metadata');
    options.repairInstallation();

    printStep(6, totalSteps, 'Repairing autostart and starting ioBroker');
    options.repairService();

    console.log('\nThe final Windows service repair has been started; its completion is reported below.');
}

module.exports = {
    FIXER_VERSION,
    cleanupNpmTemporaryDirectories,
    maintainJsonlDatabases,
    repairNpmConfig,
    runWindowsFix,
    stopWindowsService,
    validateInstallation,
};
