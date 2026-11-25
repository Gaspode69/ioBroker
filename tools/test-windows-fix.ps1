[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $IoBrokerDir,

    [Parameter(Mandatory = $true)]
    [switch] $ConfirmDestructiveTest
)

$ErrorActionPreference = 'Stop'
$utf8ConsoleEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8ConsoleEncoding
[Console]::OutputEncoding = $utf8ConsoleEncoding
$OutputEncoding = $utf8ConsoleEncoding

if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
    throw 'This test script can only be run on Windows.'
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw 'Open PowerShell as Administrator and run the script again.'
}

$sourceRoot = Split-Path -Parent $PSScriptRoot
$targetRoot = (Resolve-Path -LiteralPath $IoBrokerDir).Path

if ($sourceRoot -eq $targetRoot) {
    throw 'The repository itself cannot be used as the ioBroker test installation.'
}

$requiredPaths = @(
    (Join-Path $targetRoot 'iobroker-data'),
    (Join-Path $targetRoot 'node_modules\iobroker.js-controller')
)
foreach ($requiredPath in $requiredPaths) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Container)) {
        throw "Not a usable ioBroker installation: missing $requiredPath"
    }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$workRoot = Join-Path ([IO.Path]::GetTempPath()) "iobroker-windows-fix-$stamp"
$beforeRoot = Join-Path $workRoot 'before'
$afterRoot = Join-Path $workRoot 'after'
$npmCache = Join-Path $workRoot 'npm-cache'
$instanceLogRoot = Join-Path $targetRoot 'log'
$fixLog = Join-Path $instanceLogRoot "windows-fix-test-$stamp.log"
New-Item -ItemType Directory -Path $beforeRoot, $afterRoot -Force | Out-Null
New-Item -ItemType Directory -Path $instanceLogRoot -Force | Out-Null

function Save-InstallationState {
    param(
        [Parameter(Mandatory = $true)] [string] $Destination
    )

    Push-Location $targetRoot
    try {
        Copy-Item -LiteralPath (Join-Path $targetRoot 'package.json') -Destination $Destination -ErrorAction SilentlyContinue
        Copy-Item -LiteralPath (Join-Path $targetRoot 'package-lock.json') -Destination $Destination -ErrorAction SilentlyContinue
        Copy-Item -LiteralPath (Join-Path $targetRoot '.npmrc') -Destination $Destination -ErrorAction SilentlyContinue
        Copy-Item -LiteralPath (Join-Path $targetRoot '.env') -Destination $Destination -ErrorAction SilentlyContinue

        & npm.cmd ls --depth=0 2>&1 | Out-File (Join-Path $Destination 'npm-ls.txt') -Encoding utf8
        Get-Service | Where-Object { $_.DisplayName -like '*ioBroker*' -or $_.Name -like '*ioBroker*' } |
            Format-List Name, DisplayName, Status, StartType |
            Out-File (Join-Path $Destination 'services.txt') -Encoding utf8

        $iobCommand = Join-Path $targetRoot 'iob.bat'
        if (Test-Path -LiteralPath $iobCommand) {
            & $iobCommand status 2>&1 | Out-File (Join-Path $Destination 'iob-status.txt') -Encoding utf8
            & $iobCommand list instances 2>&1 | Out-File (Join-Path $Destination 'iob-instances.txt') -Encoding utf8
        }
    } finally {
        Pop-Location
    }
}

Write-Host "Test installation: $targetRoot"
Write-Host "Test results:      $workRoot"
Write-Host "Fixer log:         $fixLog"
Write-Host ''
Write-Host 'This run stops ioBroker, maintains its JSONL databases, changes npm files,' -ForegroundColor Yellow
Write-Host 'and recreates and starts the Windows service.' -ForegroundColor Yellow

if (-not $ConfirmDestructiveTest) {
    throw 'Pass -ConfirmDestructiveTest to confirm the full integration test.'
}

Write-Host ''
Write-Host '[1/5] Running unit tests...'
Push-Location $sourceRoot
try {
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) {
        throw "Unit tests failed with exit code $LASTEXITCODE."
    }

    Write-Host ''
    Write-Host '[2/5] Creating an isolated local @iobroker/fix package...'
    $packOutput = & npm.cmd pack --pack-destination $workRoot --cache $npmCache --json
    if ($LASTEXITCODE -ne 0) {
        throw "npm pack failed with exit code $LASTEXITCODE."
    }
    $packInfo = $packOutput | ConvertFrom-Json
    $archivePath = Join-Path $workRoot $packInfo[0].filename
    & tar.exe -xf $archivePath -C $workRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Extracting the npm package failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}

$stagedPackage = Join-Path $workRoot 'package'
$stagedPackageJsonPath = Join-Path $stagedPackage 'package.json'
$stagedPackageJson = Get-Content -LiteralPath $stagedPackageJsonPath -Raw | ConvertFrom-Json
$stagedPackageJson.name = '@iobroker/fix'
$stagedPackageJsonText = $stagedPackageJson | ConvertTo-Json -Depth 100
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($stagedPackageJsonPath, $stagedPackageJsonText, $utf8WithoutBom)

Push-Location $stagedPackage
try {
    & npm.cmd install --omit=dev --ignore-scripts --cache $npmCache
    if ($LASTEXITCODE -ne 0) {
        throw "Installing the staged package dependencies failed with exit code $LASTEXITCODE."
    }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host '[3/5] Recording the state before the repair...'
Save-InstallationState -Destination $beforeRoot

$fixExitCode = 1
try {
    Write-Host ''
    Write-Host '[4/5] Running the local Windows fixer...'
    Push-Location $targetRoot
    try {
        # Merge stderr in cmd.exe before PowerShell sees it. Windows PowerShell otherwise turns every
        # harmless native stderr line into an ErrorRecord, which can abort the test under ErrorActionPreference=Stop.
        $nodeExecutable = (Get-Command node.exe).Source
        $fixEntrypoint = Join-Path $stagedPackage 'lib-npx\install.js'
        $fixCommandLine = '"{0}" "{1}" 2>&1' -f $nodeExecutable, $fixEntrypoint
        & $env:ComSpec /d /s /c $fixCommandLine | Tee-Object -FilePath $fixLog
        $fixExitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
} finally {
    Write-Host ''
    Write-Host '[5/5] Recording the state after the repair...'
    Save-InstallationState -Destination $afterRoot
}

$npmDifference = Compare-Object `
    (Get-Content -LiteralPath (Join-Path $beforeRoot 'npm-ls.txt')) `
    (Get-Content -LiteralPath (Join-Path $afterRoot 'npm-ls.txt'))
$npmDifference | Out-File (Join-Path $workRoot 'npm-difference.txt') -Encoding utf8

Write-Host ''
Write-Host "Fixer exit code: $fixExitCode"
Write-Host "Log:              $fixLog"
Write-Host "npm comparison:   $(Join-Path $workRoot 'npm-difference.txt')"
Write-Host "Before/after:      $beforeRoot / $afterRoot"

if ($fixExitCode -ne 0) {
    throw "The Windows fixer failed with exit code $fixExitCode. See $fixLog"
}

Write-Host ''
Write-Host 'The scripted test completed. Check Admin, adapters, iob restart and autostart after a Windows reboot.' -ForegroundColor Green
