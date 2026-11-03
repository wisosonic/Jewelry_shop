<#
.SYNOPSIS
One-shot dev environment setup for Naya Sophia Jewelry (Windows/PowerShell).

.DESCRIPTION
Installs dependencies, prepares server\.env, migrates + seeds the SQLite
database, then starts both dev servers. Safe to re-run - use for first-time
setup or to get back to a running state after a clean checkout. Stop both
servers with Ctrl+C. This is the Windows/PowerShell equivalent of setup.sh -
keep both in sync (see CLAUDE.md) if install/migrate/seed/dev commands change.

.EXAMPLE
.\setup.ps1

If your system blocks script execution ("running scripts is disabled"),
run it instead as:
    powershell -ExecutionPolicy Bypass -File .\setup.ps1
#>

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

function Test-CommandExists {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-CommandExists "node")) {
    Write-Error "Node.js is required (v20+) but was not found on PATH."
    exit 1
}
if (-not (Test-CommandExists "npm")) {
    Write-Error "npm is required but was not found on PATH."
    exit 1
}

Write-Host "==> Installing dependencies (client + server workspaces)"
# --no-audit skips a bulk vulnerability-advisory network call that has been
# observed to hang indefinitely (npm connects fine but the request never
# completes) on some networks - see CLAUDE.md. Run `npm audit` manually
# afterward if you want a security check.
npm install --no-audit --no-fund

$envPath = Join-Path $RootDir "server\.env"
$envExamplePath = Join-Path $RootDir "server\.env.example"
if (-not (Test-Path $envPath)) {
    Write-Host "==> Creating server\.env from server\.env.example"
    Copy-Item $envExamplePath $envPath
    Write-Host "    Edit server\.env to set a real METALS_API_KEY (https://metals.dev) and"
    Write-Host "    JWT secrets before relying on live metal prices or a real deployment."
} else {
    Write-Host "==> server\.env already exists, leaving it as-is"
}

# A dev server left running from a previous invocation of this script (or a
# manual `npm run dev:server`) still holds the Prisma query engine DLL
# loaded in memory, which makes `prisma generate` fail with a cryptic
# "EPERM: operation not permitted, rename ...query_engine-windows.dll.node"
# a few lines later. Ports 4000/5173 being listened on is a reliable sign
# such a process is still alive, so check for that and fail with a clear,
# actionable message instead of letting the confusing EPERM through.
foreach ($port in 4000, 5173) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        Write-Host ""
        Write-Host "Port $port is already in use - a dev server from a previous run is likely still running." -ForegroundColor Yellow
        Write-Host "That process can hold a lock on the Prisma query engine DLL and make the next step fail with a confusing EPERM error." -ForegroundColor Yellow
        Write-Host "Stop it, then re-run this script:" -ForegroundColor Yellow
        Write-Host "    Get-Process node | Stop-Process -Force" -ForegroundColor Yellow
        Write-Host ""
        exit 1
    }
}

Write-Host "==> Generating Prisma client and applying database migrations"
npm run --workspace server prisma:generate
Push-Location (Join-Path $RootDir "server")
try {
    npx prisma migrate deploy
} finally {
    Pop-Location
}

Write-Host "==> Seeding the database (admin + customer users, settings, sample products)"
npm run seed

Write-Host ""
Write-Host "==> Starting the API server"

# Launched via cmd.exe so npm.cmd resolves correctly; -NoNewWindow keeps
# both servers' output interleaved in this same console, like setup.sh.
$serverProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev:server" -PassThru -NoNewWindow

# The client's Vite dev server proxies /api, /uploads, and /socket.io to
# the API - if it starts (and the browser opens) before the API is
# actually accepting connections, the very first requests (notably the
# Socket.IO client's connection attempt on page load) fail with a proxy
# ECONNREFUSED. Vite itself boots in well under a second while the API
# takes a few seconds longer (loading env, connecting Prisma), so polling
# GET /api/health (mounted before auth/CORS - no credentials needed) until
# it responds, before starting the client at all, closes that race.
Write-Host "==> Waiting for the API to be ready..."
$maxWaitSeconds = 30
$apiReady = $false
for ($i = 0; $i -lt $maxWaitSeconds; $i++) {
    if ($serverProc.HasExited) {
        Write-Error "The API server exited before becoming ready (exit code $($serverProc.ExitCode)). Check the output above for what went wrong."
        exit 1
    }
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:4000/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            $apiReady = $true
            break
        }
    } catch {
        # Connection refused/reset while the API is still starting up - keep polling.
    }
    Start-Sleep -Seconds 1
}

if (-not $apiReady) {
    Write-Error "The API did not become ready within $maxWaitSeconds seconds. Check the output above for what went wrong."
    taskkill /PID $serverProc.Id /T /F 2>$null | Out-Null
    exit 1
}

Write-Host "==> API is ready - starting the client"
Write-Host "    API:    http://localhost:4000"
Write-Host "    Client: http://localhost:5173"
Write-Host "    Seeded admin login:    admin@nayasofia.com / Admin1234!"
Write-Host "    Seeded customer login: customer@nayasofia.com / Customer123!"
Write-Host "    Press Ctrl+C to stop both servers."
Write-Host ""

$clientProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run dev:client" -PassThru -NoNewWindow

try {
    Wait-Process -Id $serverProc.Id, $clientProc.Id
} finally {
    Write-Host ""
    Write-Host "Stopping dev servers..."
    # taskkill /T kills the whole process tree (cmd.exe -> npm -> node),
    # which plain Stop-Process would miss - Windows doesn't auto-kill a
    # process's children the way a POSIX process-group kill does, and npm
    # wraps the real tsx/vite node.exe several layers deep.
    foreach ($proc in @($serverProc, $clientProc)) {
        if ($proc -and -not $proc.HasExited) {
            taskkill /PID $proc.Id /T /F 2>$null | Out-Null
        }
    }
}
