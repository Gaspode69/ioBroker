#!/usr/bin/env node

'use strict';

const platform = require('node:os').platform();
const { execSync, exec } = require('node:child_process');
const fs = require('fs-extra');
const tools = require('./tools.js');
const pack = require('../package.json');

function runLinux(isFix) {
    console.log(`Linux installation starting... (fixing = ${isFix})`);
    return new Promise((resolve, reject) => {
        // Install iobroker
        const cmd = `curl -sL https://iobroker.net/${isFix ? 'fix.sh' : 'install.sh'} | bash -`;

        // System call used for update of js-controller itself,
        // because during the installation the npm packet will be deleted too, but some files must be loaded even during the installation process.
        const child = exec(cmd);

        child.stderr.pipe(process.stderr);
        child.stdout.pipe(process.stdout);

        child.on('exit', code => {
            // code 1 is a strange error that cannot be explained. Everything is installed but error :(
            if (code && code !== 1) {
                reject(new Error(`Cannot install: ${code}`));
            } else {
                // command succeeded
                resolve();
            }
        });
    });
}

if (!/^win/.test(platform) && !tools.isAutomatedInstallation()) {
    // On Linux/OSX this must be run with the installer script now!
    if (pack.name.includes('fix')) {
        runLinux(true)
            .then(() => { });
    } else {
        runLinux()
            .then(() => { });
    }
} else {
    const isFix = pack.name.includes('fix');

    console.log(`Windows installation starting... (fixing = ${isFix})`);

    // Cancel Windows installation/fix of ioBroker for non x64 systems
    if (process.arch !== 'x64') {
        console.log(`Sorry, ioBroker under Windows is only supported on x64 systems. This is an ${process.arch} system.`);
        console.log(`You cannot install ioBroker on this system.`);
        process.exit(5);
    }

    // first of all, we remove the file which indicates that the installation is completed
    // this files is used to synchronise with the Windows MSI installer.
    try {
        fs.unlinkSync('./instDone');
    } catch (e) {
        // nothing to do here, a file did not exist
    }

    require('./checkVersions.js');

    if (isFix && /^win/.test(platform)) {
        const { runWindowsFix } = require('./windowsFix.js');
        runWindowsFix({
            repairInstallation: () => require('./installCopyFiles.js'),
            repairService: () => require('./installSetup.js'),
        });
    } else {
        require('./installCopyFiles.js');

        // We only do the basic installation when we install, not on an automated fix run.
        if (!isFix) {
            const targetDir = process.cwd();
            execSync('npm install --production', {
                cwd: targetDir,
                stdio: 'inherit',
            });
        }
        require('./installSetup.js');
    }
}
