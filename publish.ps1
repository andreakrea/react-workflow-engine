#!/usr/bin/env pwsh
# Publish vise-workflow-engine to npm
# Usage: .\publish.ps1 [patch|minor|major]

param(
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Bump = 'patch'
)

$ErrorActionPreference = 'Stop'

Write-Host "`n=== vise-workflow-engine publish ===" -ForegroundColor Cyan

# 0. Check npm auth
Write-Host "`n[0/5] Checking npm login..." -ForegroundColor Yellow
$ErrorActionPreference = 'Continue'
$npmUser = npm whoami 2>&1
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Not logged in to npm. Run 'npm login' first." -ForegroundColor Red
    exit 1
}
Write-Host "  Logged in as: $npmUser" -ForegroundColor Green

# 1. Ensure working directory is clean
$status = git status --porcelain
if ($status) {
    Write-Host "ERROR: Working directory has uncommitted changes:" -ForegroundColor Red
    Write-Host $status
    exit 1
}

# 2. Install, typecheck, test, build
Write-Host "`n[1/5] Typecheck, test and build..." -ForegroundColor Yellow
npm ci --silent
npm run typecheck
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Typecheck failed" -ForegroundColor Red; exit 1 }
npm test
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Tests failed" -ForegroundColor Red; exit 1 }
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Build failed" -ForegroundColor Red; exit 1 }
foreach ($f in 'dist/index.mjs', 'dist/react.mjs', 'dist/server.mjs', 'dist/knex.mjs', 'dist/style.css') {
    if (-not (Test-Path $f)) { Write-Host "ERROR: $f missing after build" -ForegroundColor Red; exit 1 }
}
Write-Host "  OK." -ForegroundColor Green

# 3. Bump version
Write-Host "`n[2/5] Bumping version ($Bump)..." -ForegroundColor Yellow
$oldVersion = (Get-Content package.json | ConvertFrom-Json).version
npm version $Bump --no-git-tag-version
$version = (Get-Content package.json | ConvertFrom-Json).version
Write-Host "  $oldVersion -> $version" -ForegroundColor Green

# 4. Dry run
Write-Host "`n[3/5] Running publish dry-run..." -ForegroundColor Yellow
npm publish --dry-run
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Dry run failed" -ForegroundColor Red; exit 1 }

# 5. Confirm
Write-Host ""
$confirm = Read-Host "Publish v$version to npm? (y/N)"
if ($confirm -ne 'y') {
    git checkout package.json package-lock.json 2>$null
    Write-Host "Aborted. Version bump reverted." -ForegroundColor Yellow
    exit 0
}

# 6. Publish
Write-Host "`n[4/5] Publishing to npm..." -ForegroundColor Yellow
$otp = Read-Host "Enter npm OTP code (leave blank if using automation token)"
$ErrorActionPreference = 'Continue'
if ($otp) {
    npm publish --access public --otp $otp 2>&1 | Write-Host
} else {
    npm publish --access public 2>&1 | Write-Host
}
$publishExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($publishExit -ne 0) {
    Write-Host "ERROR: Publish failed. Reverting version bump..." -ForegroundColor Red
    git checkout package.json package-lock.json 2>$null
    exit 1
}
Write-Host "  Published vise-workflow-engine@$version" -ForegroundColor Green

# 7. Git commit & tag
Write-Host "`n[5/5] Committing and tagging..." -ForegroundColor Yellow
git add package.json package-lock.json 2>&1 | Out-Null
git commit -m "release: v$version" 2>&1 | Out-Null
git tag "v$version" 2>&1 | Out-Null
Write-Host "  Tagged v$version - push with: git push; git push --tags" -ForegroundColor Green

Write-Host "`nDone!" -ForegroundColor Cyan
