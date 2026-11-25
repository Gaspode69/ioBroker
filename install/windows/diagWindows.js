'use strict';

// Windows counterpart of diag.sh. This file is copied into the ioBroker installation
// directory by the Windows installer/fixer and is invoked by "iob diag".

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERSION = '2026-11-25';
const TIMEOUT = 15000;
const rawArgs = process.argv.slice(3); // iob.bat also passes the "diag" command
const args = rawArgs.filter(arg => arg !== '--allow-root');
const german = args.includes('--de');
const unmasked = args.includes('--unmask');
const summaryOnly = args.some(arg => ['--summary', '--short', '--zusammenfassung', '--kurz', '-s', '-k'].includes(arg));

// The Start-menu command prompt is created with a rather small scrollback buffer.
// Increase only the buffer; unlike "mode con", SetBufferSize keeps the visible
// window dimensions unchanged. Never shrink a larger existing buffer.
if (process.platform === 'win32') {
    const resizeBuffer = [
        'try {',
        '$width = [Math]::Max(160, [Console]::BufferWidth)',
        '$height = [Math]::Max(9999, [Console]::BufferHeight)',
        '[Console]::SetBufferSize($width, $height)',
        '} catch {}',
    ].join('\n');
    spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', resizeBuffer], {
        stdio: 'inherit',
    });
}

const text = {
    title: german ? 'ioBroker Diagnose' : 'ioBroker Diagnosis',
    base: german ? 'BASISSYSTEM' : 'BASE SYSTEM',
    time: german ? 'ZEIT UND ZEITZONEN' : 'TIME AND TIMEZONES',
    user: german ? 'BENUTZER' : 'USER',
    memory: german ? 'ARBEITSSPEICHER UND PROZESSE' : 'MEMORY AND PROCESSES',
    storage: german ? 'DATENTRAEGER UND DATEISYSTEM' : 'STORAGE AND FILESYSTEM',
    physicalStorage: german ? 'PHYSISCHE DATENTRAEGER' : 'PHYSICAL STORAGE',
    windowsHealth: german ? 'WINDOWS-EREIGNISSE UND DIENSTE' : 'WINDOWS EVENTS AND SERVICES',
    windowsUpdates: 'WINDOWS UPDATE',
    node: 'NODE.JS INSTALLATION',
    iob: 'IOBROKER INSTALLATION',
    iobMemory: german ? 'IOBROKER-PROZESSE UND AUSLAGERUNGSDATEI' : 'IOBROKER PROCESSES AND PAGEFILE',
    data: german ? 'OBJEKTE, STATES UND HISTORY' : 'OBJECTS, STATES AND HISTORY',
    service: 'IOBROKER SERVICE',
    ports: german ? 'LAUSCHENDE PORTS' : 'LISTENING PORTS',
    logs: 'LOG ANALYSIS',
    logTail: german ? 'LETZTE 25 LOGZEILEN' : 'LAST 25 LOG LINES',
    summary: german ? 'ZUSAMMENFASSUNG' : 'SUMMARY',
};

function l(english, germanText) {
    return german ? germanText : english;
}

function usage() {
    console.log(german ? 'ioBroker Diagnose fuer Windows' : 'ioBroker diagnostics for Windows');
    console.log('');
    console.log('Usage: iob diag [OPTIONS]');
    console.log('');
    console.log('  --de                         Deutsche Ausgabe');
    console.log('  --unmask                     Show otherwise masked values');
    console.log('  --summary, --short, -s       Show summary only');
    console.log('  --zusammenfassung, --kurz, -k  Alias for --summary');
    console.log('  -h, --help                   Show this help');
}

if (args.includes('-h') || args.includes('--help')) {
    usage();
    process.exit(0);
}

const knownArgs = new Set([
    '--de', '--unmask', '--summary', '--short', '--zusammenfassung', '--kurz', '-s', '-k',
]);
const unknown = args.find(arg => !knownArgs.has(arg));
if (unknown) {
    console.error(`${german ? 'Unbekannte Option' : 'Unknown option'}: ${unknown}`);
    usage();
    process.exit(1);
}

function findRootDir() {
    const candidates = [__dirname, process.cwd(), path.resolve(__dirname, '..', '..')];
    return candidates.find(candidate =>
        fs.existsSync(path.join(candidate, 'iobroker-data')) ||
        fs.existsSync(path.join(candidate, 'node_modules', 'iobroker.js-controller')),
    ) || __dirname;
}

const rootDir = findRootDir();
const controllerCli = path.join(rootDir, 'node_modules', 'iobroker.js-controller', 'iobroker.js');
const hostName = os.hostname();
const userName = os.userInfo().username;

function run(command, commandArgs, options = {}) {
    const result = spawnSync(command, commandArgs, {
        cwd: options.cwd || rootDir,
        encoding: 'utf8',
        timeout: options.timeout || TIMEOUT,
        windowsHide: true,
        maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
        return { ok: false, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() };
    }
    return { ok: true, stdout: (result.stdout || '').trim(), stderr: (result.stderr || '').trim() };
}

function powershell(script, timeout) {
    const utf8Script = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' +
        '$OutputEncoding = [Console]::OutputEncoding; ' + script;
    return run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', utf8Script], { timeout });
}

function powershellJson(script, fallback, timeout) {
    const result = powershell(`& { ${script} } | ConvertTo-Json -Compress -Depth 6`, timeout);
    if (!result.ok || !result.stdout) {
        return fallback;
    }
    try {
        return JSON.parse(result.stdout);
    } catch {
        return fallback;
    }
}

function iob(commandArgs, timeout = TIMEOUT) {
    if (!fs.existsSync(controllerCli)) {
        return { ok: false, stdout: '', stderr: 'js-controller CLI not found' };
    }
    return run(process.execPath, [controllerCli, ...commandArgs], { timeout, maxBuffer: 30 * 1024 * 1024 });
}

function npmVersion(tool) {
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', `${tool}-cli.js`);
    if (fs.existsSync(cli)) {
        return run(process.execPath, [cli, '--version']);
    }
    return run(`${tool}.cmd`, ['--version']);
}

function mask(value) {
    let result = String(value == null ? '' : value);
    if (unmasked) {
        return result;
    }
    result = result.replace(/\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b/g, '$1.xxx');
    result = result.replace(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, '<MAC>');
    return result;
}

function heading(label) {
    console.log(`\n*** ${label} ***`);
}

function line(label, value) {
    console.log(`${label.padEnd(22)}: ${mask(value)}`);
}

function formatBytes(bytes) {
    if (!Number.isFinite(Number(bytes))) {
        return 'unknown';
    }
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let value = Number(bytes);
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function formatDuration(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
}

function localizedBoolean(value) {
    if (String(value).toLowerCase() === 'true') return l('yes', 'ja');
    if (String(value).toLowerCase() === 'false') return l('no', 'nein');
    return value || l('unknown', 'unbekannt');
}

function localizedServiceValue(value) {
    const translations = { Running: 'Läuft', Stopped: 'Gestoppt', Automatic: 'Automatisch', Manual: 'Manuell', Disabled: 'Deaktiviert' };
    return german ? (translations[value] || value) : value;
}

function backupDescription(value) {
    if (!value) return l('none found', 'keins gefunden');
    return german
        ? `vor ${value.ageDays} Tag${value.ageDays === 1 ? '' : 'en'} (${value.name})`
        : `${value.ageDays} day(s) ago (${value.name})`;
}

function asArray(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
}

function readDotEnv() {
    const envPath = path.join(rootDir, '.env');
    if (!fs.existsSync(envPath)) return {};
    const values = {};
    for (const row of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = row.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
        if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
    return values;
}

function envValue(values, name) {
    const match = Object.entries(values).find(([key]) => key.toLowerCase() === name.toLowerCase());
    return match ? match[1] : undefined;
}

function readVersions() {
    for (const candidate of [path.join(rootDir, 'versions.json'), path.resolve(__dirname, '..', '..', 'versions.json')]) {
        try {
            return JSON.parse(fs.readFileSync(candidate, 'utf8'));
        } catch {
            // Try the next location.
        }
    }
    return {};
}

function packageVersion(packageName) {
    try {
        return JSON.parse(fs.readFileSync(path.join(rootDir, 'node_modules', packageName, 'package.json'), 'utf8')).version;
    } catch {
        return null;
    }
}

function getService() {
    const configuredName = envValue(readDotEnv(), 'iobServiceName') || 'ioBroker';
    const escapedName = configuredName.replace(/'/g, "''");
    const result = powershellJson(
        `$s = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq '${escapedName}' -or ` +
        `$_.Name -eq '${escapedName.toLowerCase()}.exe' -or $_.DisplayName -eq '${escapedName}' } | Select-Object -First 1; ` +
        "if ($s) { $s | Select-Object Name,DisplayName,@{n='State';e={$_.Status.ToString()}},@{n='StartMode';e={$_.StartType.ToString()}} }",
        null,
    );
    if (result?.Name) {
        const query = run('sc.exe', ['queryex', result.Name]);
        const processId = /PID\s*:\s*(\d+)/i.exec(query.stdout)?.[1];
        if (processId && processId !== '0') result.ProcessId = Number(processId);
    }
    return { configuredName, details: result };
}

function getBaseInfo() {
    const windows = powershellJson(
        "$w = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'; " +
        "$w | Select-Object @{n='Caption';e={$_.ProductName}},@{n='Version';e={$_.DisplayVersion}}," +
        "@{n='BuildNumber';e={\"$($_.CurrentBuild).$($_.UBR)\"}},InstallDate",
        {},
    );
    const computer = powershellJson(
        "$c = Get-ItemProperty 'HKLM:\\HARDWARE\\DESCRIPTION\\System\\BIOS'; " +
        "$c | Select-Object SystemManufacturer,SystemProductName,@{n='SystemType';e={$env:PROCESSOR_ARCHITECTURE}}",
        {},
    );
    computer.Manufacturer = computer.Manufacturer || computer.SystemManufacturer;
    computer.Model = computer.Model || computer.SystemProductName;
    if (Number.parseInt(windows.BuildNumber, 10) >= 22000 && /^Windows 10\b/.test(windows.Caption || '')) {
        windows.Caption = windows.Caption.replace(/^Windows 10\b/, 'Windows 11');
    }
    return { windows, computer };
}

function getDisks() {
    return asArray(powershellJson(
        "[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady -and $_.DriveType -eq 'Fixed' } | " +
        "Select-Object @{n='DeviceID';e={$_.Name.TrimEnd('\\')}},@{n='VolumeName';e={$_.VolumeLabel}}," +
        "@{n='FileSystem';e={$_.DriveFormat}},@{n='Size';e={$_.TotalSize}},@{n='FreeSpace';e={$_.AvailableFreeSpace}}",
        [],
    ));
}

function getTopProcesses() {
    return asArray(powershellJson(
        'Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 Name,Id,WorkingSet64,CPU',
        [],
    ));
}

function getWindowsEvents() {
    const script = [
        '$since = (Get-Date).AddDays(-7)',
        '$events = @()',
        "foreach ($log in @('System', 'Application')) {",
        '  try { $events += @(Get-WinEvent -FilterHashtable @{LogName=$log; Level=1,2; StartTime=$since} -MaxEvents 200 -ErrorAction Stop) } catch {}',
        '}',
        '[pscustomobject]@{',
        '  Sampled = $events.Count',
        '  Critical = @($events | Where-Object Level -eq 1).Count',
        '  Errors = @($events | Where-Object Level -eq 2).Count',
        '  ServiceControlErrors = @($events | Where-Object ProviderName -eq "Service Control Manager").Count',
        '  Groups = @($events | Group-Object LogName,ProviderName,Id,LevelDisplayName | Sort-Object Count -Descending | Select-Object -First 10 Count,' +
        "@{n='Latest';e={($_.Group | Sort-Object TimeCreated -Descending | Select-Object -First 1).TimeCreated.ToString('yyyy-MM-dd HH:mm:ss')}}," +
        "@{n='LogName';e={$_.Group[0].LogName}},@{n='ProviderName';e={$_.Group[0].ProviderName}},@{n='Id';e={$_.Group[0].Id}},@{n='Level';e={$_.Group[0].LevelDisplayName}})",
        '}',
    ].join('\n');
    return powershellJson(script, null, 20000);
}

function getStoppedAutomaticServices() {
    const script = [
        "Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne 'Running' -and $_.StartType -eq 'Automatic' }",
        "Select-Object -First 20 Name,DisplayName,@{n='Status';e={$_.Status.ToString()}},@{n='StartType';e={$_.StartType.ToString()}}",
    ].join(' | ');
    return asArray(powershellJson(script, [], 15000));
}

function getWindowsUpdates() {
    const script = [
        'try {',
        '  $session = New-Object -ComObject Microsoft.Update.Session',
        '  $searcher = $session.CreateUpdateSearcher()',
        "  $result = $searcher.Search('IsInstalled=0 and IsHidden=0')",
        '  [pscustomobject]@{',
        '    Available = $true',
        '    Count = $result.Updates.Count',
        '    RebootRequired = @($result.Updates | Where-Object RebootRequired).Count -gt 0',
        '    Titles = @($result.Updates | Select-Object -First 10 -ExpandProperty Title)',
        '  }',
        '} catch { [pscustomobject]@{ Available = $false; Error = $_.Exception.Message } }',
    ].join('\n');
    return powershellJson(script, null, 45000);
}

function getRebootReasons() {
    const script = [
        '$reasons = @()',
        "if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending') { $reasons += 'Component Based Servicing' }",
        "if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') { $reasons += 'Windows Update' }",
        "$pending = (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue).PendingFileRenameOperations",
        "if ($pending) { $reasons += 'Pending file rename operations' }",
        '$reasons',
    ].join('; ');
    return asArray(powershellJson(script, [], 10000));
}

function getPhysicalDisks() {
    const script = [
        '$disks = @()',
        'try { $disks = @(Get-PhysicalDisk -ErrorAction Stop | Select-Object FriendlyName,MediaType,HealthStatus,OperationalStatus,Size) } catch {}',
        '$disks',
    ].join('; ');
    return asArray(powershellJson(script, [], 15000));
}

function getPagefiles() {
    const script = [
        "$configured = @((Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management' -Name PagingFiles -ErrorAction SilentlyContinue).PagingFiles)",
        '$usage = @()',
        'try { $usage = @(Get-CimInstance Win32_PageFileUsage -ErrorAction Stop | Select-Object Name,AllocatedBaseSize,CurrentUsage,PeakUsage) } catch {}',
        '[pscustomobject]@{ Configured = $configured; Usage = $usage }',
    ].join('; ');
    return powershellJson(script, { Configured: [], Usage: [] }, 15000);
}

function getPorts() {
    const script = 'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ' +
        'Sort-Object LocalPort | Select-Object LocalAddress,LocalPort,OwningProcess,@{n="Process";e={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName}}';
    const fromPowerShell = asArray(powershellJson(script, []));
    if (fromPowerShell.length) return fromPowerShell;

    // Get-NetTCPConnection may require rights which a regular ioBroker user does not have.
    const netstat = run('netstat.exe', ['-ano', '-p', 'tcp']);
    if (!netstat.ok) return [];
    const processes = new Map(asArray(powershellJson(
        "Get-Process | Select-Object Id,@{n='Process';e={$_.ProcessName}}",
        [],
    )).map(item => [String(item.Id), item.Process]));
    const result = [];
    for (const row of netstat.stdout.split(/\r?\n/)) {
        const fields = row.trim().split(/\s+/);
        if (fields.length < 5 || fields[0].toUpperCase() !== 'TCP' || !/:0$/.test(fields[2])) continue;
        const local = fields[1];
        const separator = local.lastIndexOf(':');
        if (separator < 0) continue;
        const pid = fields[4];
        result.push({
            LocalAddress: local.slice(0, separator).replace(/^\[|\]$/g, ''),
            LocalPort: local.slice(separator + 1),
            OwningProcess: pid,
            Process: processes.get(pid) || '',
        });
    }
    return result.sort((a, b) => Number(a.LocalPort) - Number(b.LocalPort));
}

function getUdpEndpoints() {
    const fromPowerShell = asArray(powershellJson(
        'Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Sort-Object LocalPort | ' +
        'Select-Object LocalAddress,LocalPort,OwningProcess,@{n="Process";e={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName}}',
        [],
        15000,
    ));
    if (fromPowerShell.length) return uniqueEndpoints(fromPowerShell);

    const netstat = run('netstat.exe', ['-ano', '-p', 'udp']);
    if (!netstat.ok) return [];
    const processes = new Map(asArray(powershellJson(
        "Get-Process | Select-Object Id,@{n='Process';e={$_.ProcessName}}",
        [],
    )).map(item => [String(item.Id), item.Process]));
    const result = [];
    for (const row of netstat.stdout.split(/\r?\n/)) {
        const fields = row.trim().split(/\s+/);
        if (fields.length < 4 || fields[0].toUpperCase() !== 'UDP') continue;
        const local = fields[1];
        const separator = local.lastIndexOf(':');
        if (separator < 0) continue;
        const pid = fields[3];
        result.push({
            LocalAddress: local.slice(0, separator).replace(/^\[|\]$/g, ''),
            LocalPort: local.slice(separator + 1),
            OwningProcess: pid,
            Process: processes.get(pid) || '',
        });
    }
    return uniqueEndpoints(result).sort((a, b) => Number(a.LocalPort) - Number(b.LocalPort));
}

function uniqueEndpoints(endpoints) {
    const seen = new Set();
    return endpoints.filter(endpoint => {
        const key = `${endpoint.LocalAddress}|${endpoint.LocalPort}|${endpoint.OwningProcess}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function latestBackup() {
    const backupDir = path.join(rootDir, 'backups');
    if (!fs.existsSync(backupDir)) return null;
    const files = fs.readdirSync(backupDir, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => ({ name: entry.name, stat: fs.statSync(path.join(backupDir, entry.name)) }))
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    if (!files.length) return null;
    return { name: files[0].name, ageDays: Math.floor((Date.now() - files[0].stat.mtimeMs) / 86400000) };
}

function databaseFiles() {
    const dataDir = path.join(rootDir, 'iobroker-data');
    if (!fs.existsSync(dataDir)) return [];
    return fs.readdirSync(dataDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && /(objects|states).*\.(jsonl|json)$/i.test(entry.name))
        .map(entry => ({ name: entry.name, size: fs.statSync(path.join(dataDir, entry.name)).size }))
        .sort((a, b) => b.size - a.size);
}

function getHistoryStats() {
    const historyDir = path.join(rootDir, 'iobroker-data', 'history');
    if (!fs.existsSync(historyDir)) return { available: false, files: 0, truncated: false, top: [] };
    const pending = [historyDir];
    const totals = new Map();
    let files = 0;
    const maxFiles = 200000;
    while (pending.length && files < maxFiles) {
        const current = pending.pop();
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                pending.push(entryPath);
            } else if (entry.isFile() && /^history\..+\.json$/i.test(entry.name)) {
                files++;
                const size = fs.statSync(entryPath).size;
                totals.set(entry.name, (totals.get(entry.name) || 0) + size);
                if (files >= maxFiles) break;
            }
        }
    }
    return {
        available: true,
        files,
        truncated: pending.length > 0,
        top: [...totals.entries()]
            .map(([name, size]) => ({ name, size }))
            .sort((a, b) => b.size - a.size)
            .slice(0, 10),
    };
}

function getIobProcessMemory(processLabels) {
    const ids = [...processLabels.keys()].filter(id => Number.isInteger(id) && id > 0);
    if (!ids.length) return [];
    const script = `Get-Process -Id @(${ids.join(',')}) -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,WorkingSet64,CPU`;
    return asArray(powershellJson(script, [], 15000)).map(processInfo => ({
        ...processInfo,
        Label: processLabels.get(Number(processInfo.Id)) || processInfo.ProcessName,
    })).sort((a, b) => Number(b.WorkingSet64) - Number(a.WorkingSet64));
}

function getLogFiles() {
    const logDir = path.join(rootDir, 'log');
    if (!fs.existsSync(logDir)) return [];
    return fs.readdirSync(logDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && /^iobroker.*\.log$/i.test(entry.name))
        .map(entry => path.join(logDir, entry.name))
        .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
}

function analyseLogs(files) {
    const maxBytesPerFile = 32 * 1024 * 1024;
    const result = {
        errors: 0,
        warnings: 0,
        starts: 0,
        restarts: 0,
        truncated: 0,
        controllerVersion: null,
        processIds: new Map(),
        byInstance: new Map(),
    };
    for (const file of files) {
        let content;
        try {
            const size = fs.statSync(file).size;
            const length = Math.min(size, maxBytesPerFile);
            const buffer = Buffer.alloc(length);
            const handle = fs.openSync(file, 'r');
            try {
                fs.readSync(handle, buffer, 0, length, size - length);
            } finally {
                fs.closeSync(handle);
            }
            if (size > length) result.truncated++;
            content = buffer.toString('utf8').replace(/\0/g, '').replace(/\x1b\[[0-9;]*m/g, '');
        } catch {
            continue;
        }
        for (const row of content.split(/\r?\n/)) {
            const lower = row.toLowerCase();
            const controllerStart = /iobroker\.js-controller version\s+([^\s]+)\s+js-controller starting/i.exec(row);
            if (controllerStart) result.controllerVersion = controllerStart[1];
            const processMatch = /\b([a-z][a-z0-9_-]*\.\d+) \((\d+)\)/i.exec(row);
            if (processMatch) result.processIds.set(processMatch[1], Number(processMatch[2]));
            const isError = /\s-\serror:/.test(lower);
            const isWarning = /\s-\swarn(?:ing)?:/.test(lower);
            if (isError) result.errors++;
            if (isWarning) result.warnings++;
            if (/start(?:ing|ed) adapter|instance .* started/.test(lower)) result.starts++;
            if (/restart loop|restarted too often|will be restarted/.test(lower)) result.restarts++;
            if (isError || isWarning) {
                const payload = /\s-\s(?:error|warn(?:ing)?):\s+(.+)/i.exec(row)?.[1] || '';
                const match = /^([a-z][a-z0-9_-]*\.\d+)(?:\s|\()/i.exec(payload);
                const instance = /^host\.[^\s]+/i.test(payload) ? 'host' : (match ? match[1] : 'other');
                const count = result.byInstance.get(instance) || { errors: 0, warnings: 0 };
                if (isError) count.errors++;
                if (isWarning) count.warnings++;
                result.byInstance.set(instance, count);
            }
        }
    }
    return result;
}

function tailLog() {
    const candidates = [path.join(rootDir, 'log', 'iobroker.current.log'), ...getLogFiles()]
        .filter((value, index, list) => fs.existsSync(value) && list.indexOf(value) === index)
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (!candidates.length) return [];
    const file = candidates[0];
    const size = fs.statSync(file).size;
    const length = Math.min(size, 256 * 1024);
    const buffer = Buffer.alloc(length);
    const handle = fs.openSync(file, 'r');
    try {
        fs.readSync(handle, buffer, 0, length, size - length);
    } finally {
        fs.closeSync(handle);
    }
    return buffer.toString('utf8').replace(/\0/g, '').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).slice(-26, -1);
}

const baseInfo = getBaseInfo();
const service = getService();
const disks = getDisks();
const backup = latestBackup();
const dbFiles = databaseFiles();
const versions = readVersions();
const nodeVersion = process.version;
const npmResult = npmVersion('npm');
const npxResult = npmVersion('npx');
const controllerVersion = packageVersion('iobroker.js-controller');
const statusResult = fs.existsSync(controllerCli) ? iob(['status'], 10000) : { ok: false, stdout: '', stderr: 'js-controller CLI not found' };
const queryLiveIob = statusResult.ok && /\bis running\b/i.test(statusResult.stdout);
const notRunningResult = { ok: false, stdout: '', stderr: 'ioBroker service is not running' };
const instanceResult = queryLiveIob ? iob(['list', 'instances']) : notRunningResult;
const hostsResult = queryLiveIob ? iob(['list', 'hosts']) : notRunningResult;
const logFiles = getLogFiles();
const logAnalysis = analyseLogs(logFiles);
const hasIobInstallation = fs.existsSync(path.join(rootDir, 'iobroker-data'));
const windowsEvents = hasIobInstallation ? getWindowsEvents() : null;
const stoppedAutomaticServices = hasIobInstallation ? getStoppedAutomaticServices() : [];
const windowsUpdates = hasIobInstallation ? getWindowsUpdates() : null;
const rebootReasons = hasIobInstallation ? getRebootReasons() : [];
const physicalDisks = hasIobInstallation ? getPhysicalDisks() : [];
const pagefiles = hasIobInstallation ? getPagefiles() : { Configured: [], Usage: [] };
const historyStats = hasIobInstallation ? getHistoryStats() : { available: false, files: 0, truncated: false, top: [] };
const hostObjectControllerVersion = /version:\s*([^,\s)]+)/i.exec(hostsResult.stdout)?.[1] || null;
const runningControllerVersion = logAnalysis.controllerVersion || hostObjectControllerVersion;
const activeInstances = instanceResult.ok ? (instanceResult.stdout.match(/^\+\s+system\.adapter\./gm) || []).length : l('unknown', 'unbekannt');
const adapterUpdateResult = queryLiveIob ? iob(['update', summaryOnly ? '-u' : '-i'], 20000) : notRunningResult;
const pendingIobUpdates = adapterUpdateResult.ok
    ? (adapterUpdateResult.stdout.match(/Updat(?:able|eable)/gi) || []).length
    : l('unknown', 'unbekannt');
const activeRepository = /(?:Used repository|Active repo\(s\)):\s*([^\s\r\n]+)/i.exec(adapterUpdateResult.stdout)?.[1] || null;
const adminObjectResult = queryLiveIob ? iob(['object', 'get', 'system.adapter.admin.0'], 10000) : notRunningResult;
let adminAuth = null;
try {
    adminAuth = JSON.parse(adminObjectResult.stdout).native?.auth;
} catch {
    // Older controllers or unavailable object DB: keep the value unknown.
}
const objectsResult = queryLiveIob ? iob(['list', 'objects'], 30000) : notRunningResult;
const statesResult = queryLiveIob ? iob(['list', 'states'], 30000) : notRunningResult;
const objectCount = objectsResult.ok ? objectsResult.stdout.split(/\r?\n/).filter(Boolean).length : null;
const stateCount = statesResult.ok ? statesResult.stdout.split(/\r?\n/).filter(Boolean).length : null;
const processLabels = new Map([...logAnalysis.processIds.entries()].map(([label, id]) => [id, label]));
if (service.details?.ProcessId) processLabels.set(Number(service.details.ProcessId), 'js-controller');
const iobProcesses = getIobProcessMemory(processLabels);
const iobProcessMemoryTotal = iobProcesses.reduce((total, processInfo) => total + Number(processInfo.WorkingSet64 || 0), 0);

function collectWarnings() {
    const warnings = [];
    if (service.details && service.details.StartMode !== 'Automatic') {
        warnings.push(l(
            `The ioBroker service start mode is ${service.details.StartMode}; it may not start after a reboot.`,
            `Der Starttyp des ioBroker-Dienstes ist ${localizedServiceValue(service.details.StartMode)}; nach einem Neustart startet er möglicherweise nicht automatisch.`,
        ));
    }
    if (activeRepository && activeRepository.toLowerCase() !== 'stable') {
        warnings.push(l(`The active repository is ${activeRepository}.`, `Das aktive Repository ist ${activeRepository}.`));
    }
    if (adminAuth === false) {
        warnings.push(l('Admin login is not enforced.', 'Die Anmeldung am Admin ist nicht erzwungen.'));
    }
    if (!asArray(pagefiles.Configured).filter(Boolean).length && !asArray(pagefiles.Usage).length) {
        warnings.push(l('No Windows pagefile is configured.', 'Es ist keine Windows-Auslagerungsdatei konfiguriert.'));
    }
    if (windowsUpdates?.Available && Number(windowsUpdates.Count) > 0) {
        warnings.push(l(
            `${windowsUpdates.Count} Windows update(s) are pending.`,
            `${windowsUpdates.Count} Windows-Update(s) stehen aus.`,
        ));
    }
    if (rebootReasons.length) {
        warnings.push(l(
            `Windows needs a reboot (${rebootReasons.join(', ')}).`,
            `Windows muss neu gestartet werden (${rebootReasons.join(', ')}).`,
        ));
    }
    if (windowsEvents?.ServiceControlErrors > 0) {
        warnings.push(l(
            `${windowsEvents.ServiceControlErrors} Service Control Manager error(s) occurred in the sampled event logs.`,
            `${windowsEvents.ServiceControlErrors} Fehler des Service Control Managers wurden in den untersuchten Ereignissen gefunden.`,
        ));
    }
    const unhealthyDisks = physicalDisks.filter(disk => String(disk.HealthStatus).toLowerCase() !== 'healthy');
    if (unhealthyDisks.length) {
        warnings.push(l(
            `${unhealthyDisks.length} physical disk(s) do not report a healthy state.`,
            `${unhealthyDisks.length} physische Datenträger melden keinen fehlerfreien Zustand.`,
        ));
    }
    const lowDisks = disks.filter(disk => disk.Size && Number(disk.FreeSpace) / Number(disk.Size) <= 0.1).map(disk => disk.DeviceID);
    if (lowDisks.length) {
        warnings.push(l(
            `Low free space on ${lowDisks.join(', ')} (10% or less).`,
            `Wenig freier Speicher auf ${lowDisks.join(', ')} (höchstens 10 %).`,
        ));
    }
    return warnings;
}

const diagnosticWarnings = collectWarnings();

function printSummary() {
    console.log('```text');
    console.log(`========================== ${text.summary} ==========================`);
    line(l('diag version', 'diag-Version'), VERSION);
    line(l('Host', 'Windows-Rechner'), hostName);
    line('Windows', `${baseInfo.windows.Caption || os.release()} ${baseInfo.windows.Version || ''} (Build ${baseInfo.windows.BuildNumber || os.release()})`);
    line(l('Architecture', 'Architektur'), `${os.arch()} / ${baseInfo.computer.SystemType || ''}`);
    line(l('Uptime', 'Systemlaufzeit'), formatDuration(os.uptime()));
    line(l('Timezone', 'Zeitzone'), Intl.DateTimeFormat().resolvedOptions().timeZone || l('unknown', 'unbekannt'));
    line(l('Memory', 'Arbeitsspeicher'), german
        ? `${formatBytes(os.totalmem() - os.freemem())} verwendet / ${formatBytes(os.totalmem())}`
        : `${formatBytes(os.totalmem() - os.freemem())} used / ${formatBytes(os.totalmem())}`);
    line(l('ioBroker process memory', 'ioBroker-Prozessspeicher'), iobProcesses.length
        ? `${formatBytes(iobProcessMemoryTotal)} (${iobProcesses.length} ${l('processes', 'Prozesse')})`
        : l('unavailable', 'nicht verfügbar'));
    const pagefileUsage = asArray(pagefiles.Usage);
    line(l('Pagefile', 'Auslagerungsdatei'), pagefileUsage.length
        ? `${pagefileUsage.reduce((sum, item) => sum + Number(item.CurrentUsage || 0), 0)} MiB / ${pagefileUsage.reduce((sum, item) => sum + Number(item.AllocatedBaseSize || 0), 0)} MiB`
        : (asArray(pagefiles.Configured).filter(Boolean).join(', ') || l('not configured', 'nicht konfiguriert')));
    line('Node.js', nodeVersion);
    line(l('Recommended Node.js', 'Empfohlenes Node.js'), versions.nodeJsRecommended || l('unknown', 'unbekannt'));
    line('npm / npx', `${npmResult.stdout || 'not found'} / ${npxResult.stdout || 'not found'}`);
    line(l('js-controller installed', 'js-controller installiert'), controllerVersion || l('not found', 'nicht gefunden'));
    line(l('js-controller running', 'js-controller aktiv'), runningControllerVersion || l('unknown', 'unbekannt'));
    line(l('ioBroker service', 'ioBroker-Dienst'), service.details
        ? `${localizedServiceValue(service.details.State)}, ${localizedServiceValue(service.details.StartMode)}`
        : l('not found', 'nicht gefunden'));
    line(l('Active instances', 'Aktive Instanzen'), activeInstances);
    line(l('Pending ioBroker updates', 'Offene ioBroker-Updates'), pendingIobUpdates);
    line(l('Pending Windows updates', 'Offene Windows-Updates'), windowsUpdates?.Available ? windowsUpdates.Count : l('unavailable', 'nicht verfügbar'));
    line(l('Windows reboot pending', 'Windows-Neustart ausstehend'), localizedBoolean(rebootReasons.length > 0));
    line(l('Active repository', 'Aktives Repository'), activeRepository || l('unknown', 'unbekannt'));
    line(l('Admin login enforced', 'Admin-Anmeldung erzwungen'), adminAuth == null ? l('unknown', 'unbekannt') : localizedBoolean(adminAuth));
    line(l('Latest local backup', 'Letztes lokales Backup'), backupDescription(backup));
    line(l('Log errors / warnings', 'Logfehler / Warnungen'), `${logAnalysis.errors} / ${logAnalysis.warnings}`);
    line(l('Restart-loop indicators', 'Hinweise auf Neustartschleifen'), logAnalysis.restarts);
    line(l('Critical/error events', 'Kritische/Fehler-Ereignisse'), windowsEvents
        ? `${windowsEvents.Critical} / ${windowsEvents.Errors} (${l('sample', 'Stichprobe')})`
        : l('unavailable', 'nicht verfügbar'));
    line(l('Stopped automatic/trigger services', 'Gestoppte Automatik-/Triggerdienste'), stoppedAutomaticServices.length);
    line(l('Physical disks', 'Physische Datenträger'), physicalDisks.length
        ? `${physicalDisks.length}, ${physicalDisks.filter(disk => String(disk.HealthStatus).toLowerCase() === 'healthy').length} ${l('healthy', 'fehlerfrei')}`
        : l('unavailable', 'nicht verfügbar'));
    line(l('Objects / states', 'Objekte / States'), objectCount == null || stateCount == null
        ? l('unavailable', 'nicht verfügbar')
        : `${objectCount} / ${stateCount}`);
    line(l('History files', 'History-Dateien'), historyStats.available ? historyStats.files : l('not found', 'nicht gefunden'));
    for (const disk of disks) {
        const freePercent = disk.Size ? Math.round(Number(disk.FreeSpace) / Number(disk.Size) * 100) : 0;
        line(`${l('Disk', 'Laufwerk')} ${disk.DeviceID}`, german
            ? `${formatBytes(disk.FreeSpace)} frei von ${formatBytes(disk.Size)} (${freePercent} %)`
            : `${formatBytes(disk.FreeSpace)} free of ${formatBytes(disk.Size)} (${freePercent}%)`);
    }
    if (diagnosticWarnings.length) {
        console.log(`\n${l('WARNINGS', 'WARNUNGEN')}:`);
        for (const warning of diagnosticWarnings) console.log(`  - ${warning}`);
    }
    console.log(`================== ${german ? 'ENDE DER ZUSAMMENFASSUNG' : 'END OF SUMMARY'} ==================`);
    console.log('```');
}

if (summaryOnly) {
    printSummary();
    process.exit(0);
}

console.log(`*** ${text.title} ***`);
console.log(german
    ? 'Die Ausgabe kann fuer eine Support-Anfrage vollstaendig kopiert werden.'
    : 'The complete output can be copied into a support request.');
if (!unmasked) {
    console.log(german
        ? 'IP- und MAC-Adressen werden maskiert. Fuer Klartext: iob diag --unmask'
        : 'IP and MAC addresses are masked. For plain text: iob diag --unmask');
}
console.log('\n```text');
line('diag version', VERSION);

heading(text.base);
line(l('Host', 'Windows-Rechner'), hostName);
line(l('Operating system', 'Betriebssystem'), `${baseInfo.windows.Caption || 'Windows'} ${baseInfo.windows.Version || os.release()}`);
line('Build', baseInfo.windows.BuildNumber || os.release());
line(l('Architecture', 'Architektur'), `${os.arch()} / ${baseInfo.computer.SystemType || l('unknown', 'unbekannt')}`);
line('Hardware', `${baseInfo.computer.Manufacturer || ''} ${baseInfo.computer.Model || ''}`.trim());
if (baseInfo.computer.HypervisorPresent != null) {
    line(l('Hypervisor present', 'Hypervisor vorhanden'), localizedBoolean(baseInfo.computer.HypervisorPresent));
}
line(l('System uptime', 'Systemlaufzeit'), formatDuration(os.uptime()));
line(l('Installation root', 'Installationsverzeichnis'), rootDir);
line(l('Reboot pending', 'Neustart ausstehend'), localizedBoolean(rebootReasons.length > 0));
if (rebootReasons.length) line(l('Reboot reasons', 'Neustartgründe'), rebootReasons.join(', '));

heading(text.time);
line(l('Local time', 'Lokale Zeit'), new Date().toString());
line('UTC', new Date().toISOString());
line(l('Timezone', 'Zeitzone'), Intl.DateTimeFormat().resolvedOptions().timeZone || l('unknown', 'unbekannt'));

heading(text.windowsUpdates);
if (windowsUpdates?.Available) {
    line(l('Pending updates', 'Offene Updates'), windowsUpdates.Count);
    line(l('Update needs reboot', 'Update benötigt Neustart'), localizedBoolean(windowsUpdates.RebootRequired));
    for (const title of asArray(windowsUpdates.Titles)) console.log(`  - ${title}`);
} else {
    console.log(l('Windows Update status could not be read.', 'Der Windows-Update-Status konnte nicht gelesen werden.'));
}

heading(text.windowsHealth);
if (windowsEvents) {
    line(l('Events sampled', 'Untersuchte Ereignisse'), windowsEvents.Sampled);
    line(l('Critical', 'Kritisch'), windowsEvents.Critical);
    line(l('Errors', 'Fehler'), windowsEvents.Errors);
    line(l('Service control errors', 'Dienststeuerungsfehler'), windowsEvents.ServiceControlErrors);
    console.log(`\n${l('Most frequent critical/error events', 'Häufigste kritische/Fehler-Ereignisse')}:`);
    for (const event of asArray(windowsEvents.Groups)) {
        console.log(`  ${String(event.Count).padStart(4)}x  ${event.Latest || ''}  ${event.LogName || ''}  ${event.ProviderName || ''}  ID ${event.Id}  ${event.Level || ''}`);
    }
} else {
    console.log(l('Windows event logs could not be read.', 'Die Windows-Ereignisprotokolle konnten nicht gelesen werden.'));
}
console.log(`\n${l('Automatic services currently stopped (trigger-start services may be normal)', 'Derzeit gestoppte automatische Dienste (bei Triggerstart möglicherweise normal)')}:`);
if (stoppedAutomaticServices.length) {
    for (const stoppedService of stoppedAutomaticServices) console.log(`  ${stoppedService.Name}: ${stoppedService.DisplayName}`);
} else {
    console.log(`  ${l('none', 'keine')}`);
}

heading(text.user);
line(l('Current user', 'Aktueller Benutzer'), `${os.userInfo().domain ? `${os.userInfo().domain}\\` : ''}${userName}`);
line(l('Elevated', 'Administratorrechte'), localizedBoolean(
    powershell('([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)').stdout,
));

heading(text.memory);
line(l('Memory used', 'Speicher verwendet'), `${formatBytes(os.totalmem() - os.freemem())} / ${formatBytes(os.totalmem())}`);
line(l('Free memory', 'Speicher frei'), formatBytes(os.freemem()));
console.log(`\n${l('Top processes by memory', 'Prozesse mit dem höchsten Speicherverbrauch')}:`);
for (const processInfo of getTopProcesses()) {
    console.log(`  ${String(processInfo.Name || '').padEnd(28)} PID ${String(processInfo.Id).padEnd(7)} ${formatBytes(processInfo.WorkingSet64)}`);
}

heading(text.iobMemory);
if (iobProcesses.length) {
    for (const processInfo of iobProcesses) {
        console.log(`  ${String(processInfo.Label).padEnd(28)} PID ${String(processInfo.Id).padEnd(7)} ${formatBytes(processInfo.WorkingSet64)}`);
    }
    line(l('Total ioBroker memory', 'ioBroker-Speicher gesamt'), formatBytes(iobProcessMemoryTotal));
} else {
    console.log(l('No running ioBroker processes could be assigned.', 'Es konnten keine laufenden ioBroker-Prozesse zugeordnet werden.'));
}
const pagefileUsage = asArray(pagefiles.Usage);
line(l('Pagefile configuration', 'Auslagerungsdatei-Konfiguration'), asArray(pagefiles.Configured).filter(Boolean).join(', ') || l('not configured', 'nicht konfiguriert'));
if (pagefileUsage.length) {
    for (const pagefile of pagefileUsage) {
        line(pagefile.Name || l('Pagefile', 'Auslagerungsdatei'), `${pagefile.CurrentUsage} MiB / ${pagefile.AllocatedBaseSize} MiB (${l('peak', 'Spitze')}: ${pagefile.PeakUsage} MiB)`);
    }
} else if (asArray(pagefiles.Configured).filter(Boolean).length) {
    line(l('Pagefile usage', 'Auslagerungsdatei-Auslastung'), l('unavailable', 'nicht verfügbar'));
}

heading(text.storage);
for (const disk of disks) {
    const freePercent = disk.Size ? Math.round(Number(disk.FreeSpace) / Number(disk.Size) * 100) : 0;
    line(`${disk.DeviceID} ${disk.VolumeName || ''}`.trim(), `${disk.FileSystem || '?'}; ${formatBytes(disk.FreeSpace)} free of ${formatBytes(disk.Size)} (${freePercent}%)`);
}
line(l('Latest local backup', 'Letztes lokales Backup'), backupDescription(backup));
console.log('\nioBroker database files:');
for (const file of dbFiles) console.log(`  ${file.name.padEnd(35)} ${formatBytes(file.size)}`);

heading(text.physicalStorage);
if (physicalDisks.length) {
    for (const disk of physicalDisks) {
        line(disk.FriendlyName || l('Disk', 'Datenträger'), `${disk.MediaType || '?'}; ${disk.HealthStatus || '?'}; ${formatBytes(disk.Size)}`);
    }
} else {
    console.log(l(
        'Physical disk health is unavailable (Storage Management rights/provider may be missing).',
        'Der Zustand physischer Datenträger ist nicht verfügbar (fehlende Rechte oder Storage-Provider).',
    ));
}

heading(text.node);
line('node executable', process.execPath);
line('node', nodeVersion);
line('npm', npmResult.stdout || 'not found');
line('npx', npxResult.stdout || 'not found');
line(l('Recommended Node.js', 'Empfohlenes Node.js'), versions.nodeJsRecommended || l('unknown', 'unbekannt'));
line(l('Accepted Node.js', 'Unterstütztes Node.js'), asArray(versions.nodeJsAccepted).join(', ') || l('unknown', 'unbekannt'));
if (/-/.test(nodeVersion)) console.log(german ? 'WARNUNG: Node.js ist eine Vorabversion.' : 'WARNING: Node.js is a pre-release version.');

heading(text.iob);
console.log('Status:');
console.log(mask(statusResult.stdout || statusResult.stderr || 'not available'));
console.log('\nHosts:');
console.log(mask(hostsResult.stdout || hostsResult.stderr || 'not available'));
line('js-controller installed', controllerVersion || 'not found');
line('js-controller running', runningControllerVersion || 'unknown');
if (controllerVersion && runningControllerVersion && controllerVersion !== runningControllerVersion) {
    console.log(german
        ? `WARNUNG: Installiert ist js-controller ${controllerVersion}, aktiv läuft noch ${runningControllerVersion}. ioBroker neu starten.`
        : `WARNING: js-controller ${controllerVersion} is installed, but ${runningControllerVersion} is still running. Restart ioBroker.`);
}
line(l('Admin login enforced', 'Admin-Anmeldung erzwungen'), adminAuth == null ? l('unknown', 'unbekannt') : localizedBoolean(adminAuth));
console.log('\nInstances:');
console.log(mask(instanceResult.stdout || instanceResult.stderr || 'not available'));
console.log('\nRepositories:');
console.log(mask(queryLiveIob ? (iob(['repo', 'list']).stdout || 'not available') : notRunningResult.stderr));
console.log('\nInstalled adapters:');
console.log(mask(queryLiveIob ? (iob(['list', 'adapters'], 30000).stdout || 'not available') : notRunningResult.stderr));
console.log('\nAdapter versions and update status:');
console.log(mask(adapterUpdateResult.stdout || adapterUpdateResult.stderr || 'not available'));

heading(text.data);
line(l('Objects', 'Objekte'), objectCount == null ? l('unavailable', 'nicht verfügbar') : objectCount);
line('States', stateCount == null ? l('unavailable', 'nicht verfügbar') : stateCount);
if (historyStats.available) {
    line(l('History files scanned', 'Untersuchte History-Dateien'), historyStats.files);
    if (historyStats.truncated) console.log(l('WARNING: History scan was limited to 200000 files.', 'WARNUNG: Die History-Prüfung wurde auf 200000 Dateien begrenzt.'));
    for (const item of historyStats.top) console.log(`  ${formatBytes(item.size).padStart(10)}  ${item.name}`);
} else {
    console.log(l('No history directory found.', 'Kein History-Verzeichnis gefunden.'));
}

heading(text.service);
line('Configured name', service.configuredName);
if (service.details) {
    line(l('State', 'Status'), localizedServiceValue(service.details.State));
    line(l('Start mode', 'Starttyp'), localizedServiceValue(service.details.StartMode));
    if (service.details.StartName) line(l('Account', 'Dienstkonto'), service.details.StartName);
    if (service.details.ProcessId) line('Prozess-ID', service.details.ProcessId);
} else {
    console.log(german ? 'Der konfigurierte Windows-Dienst wurde nicht gefunden.' : 'The configured Windows service was not found.');
}

if (diagnosticWarnings.length) {
    heading(l('WARNINGS', 'WARNUNGEN'));
    for (const warning of diagnosticWarnings) console.log(`- ${warning}`);
}

heading(text.ports);
console.log('TCP:');
for (const port of getPorts()) {
    const address = mask(port.LocalAddress).padEnd(18);
    console.log(`  ${address} ${String(port.LocalPort).padEnd(7)} PID ${String(port.OwningProcess).padEnd(7)} ${mask(port.Process || '')}`);
}
console.log('\nUDP:');
for (const port of getUdpEndpoints()) {
    const address = mask(port.LocalAddress).padEnd(18);
    console.log(`  ${address} ${String(port.LocalPort).padEnd(7)} PID ${String(port.OwningProcess).padEnd(7)} ${mask(port.Process || '')}`);
}

heading(text.logs);
line('Log files analysed', logFiles.length);
if (logAnalysis.truncated) {
    line('Large logs sampled', logAnalysis.truncated);
}
line('Errors', logAnalysis.errors);
line('Warnings', logAnalysis.warnings);
line('Adapter starts', logAnalysis.starts);
line('Restart-loop indicators', logAnalysis.restarts);
console.log('\nErrors/warnings by instance:');
for (const [instance, count] of [...logAnalysis.byInstance.entries()].sort((a, b) => b[1].errors - a[1].errors)) {
    console.log(`  ${instance.padEnd(30)} ${count.errors} error(s), ${count.warnings} warning(s)`);
}

heading(text.logTail);
for (const row of tailLog()) console.log(mask(row));
console.log('```');
