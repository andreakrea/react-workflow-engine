#!/usr/bin/env pwsh
# Publish vise-workflow-engine to npm, then push and redeploy the demo.
# Usage: .\publish.ps1 [none|patch|minor|major]
#   none  — publish the version already in package.json (e.g. the first 2.0.0)

param(
    [ValidateSet('none', 'patch', 'minor', 'major')]
    [string]$Bump = 'patch'
)

$ErrorActionPreference = 'Stop'

Write-Host "`n=== vise-workflow-engine publish ===" -ForegroundColor Cyan

# 0. npm auth
Write-Host "`n[0/7] Checking npm login..." -ForegroundColor Yellow
$ErrorActionPreference = 'Continue'
$npmUser = npm whoami 2>&1
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Not logged in to npm. Run 'npm login' first." -ForegroundColor Red
    exit 1
}
Write-Host "  Logged in as: $npmUser" -ForegroundColor Green

# 1. Clean working tree
$status = git status --porcelain
if ($status) {
    Write-Host "ERROR: Working directory has uncommitted changes:" -ForegroundColor Red
    Write-Host $status
    exit 1
}

# 2. Install, typecheck, test, build
Write-Host "`n[1/7] Typecheck, test and build..." -ForegroundColor Yellow
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

# 3. Version
Write-Host "`n[2/7] Version..." -ForegroundColor Yellow
$oldVersion = (Get-Content package.json | ConvertFrom-Json).version
if ($Bump -ne 'none') {
    npm version $Bump --no-git-tag-version
}
$version = (Get-Content package.json | ConvertFrom-Json).version
$published = npm view "vise-workflow-engine@$version" version 2>$null
if ($published) {
    Write-Host "ERROR: $version is already on npm. Use patch, minor or major." -ForegroundColor Red
    if ($Bump -ne 'none') { git checkout package.json package-lock.json 2>$null }
    exit 1
}
Write-Host "  $oldVersion -> $version" -ForegroundColor Green

# 4. Dry run
Write-Host "`n[3/7] Publish dry-run..." -ForegroundColor Yellow
npm publish --dry-run
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Dry run failed" -ForegroundColor Red; exit 1 }

# 5. Confirm and publish
Write-Host ""
$confirm = Read-Host "Publish v$version to npm? (y/N)"
if ($confirm -ne 'y') {
    if ($Bump -ne 'none') { git checkout package.json package-lock.json 2>$null }
    Write-Host "Aborted." -ForegroundColor Yellow
    exit 0
}

Write-Host "`n[4/7] Publishing to npm..." -ForegroundColor Yellow
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
    Write-Host "ERROR: Publish failed." -ForegroundColor Red
    if ($Bump -ne 'none') { git checkout package.json package-lock.json 2>$null }
    exit 1
}
Write-Host "  Published vise-workflow-engine@$version" -ForegroundColor Green

# 6. Commit (if bumped) and tag
Write-Host "`n[5/7] Committing and tagging..." -ForegroundColor Yellow
if ($Bump -ne 'none') {
    git add package.json package-lock.json 2>&1 | Out-Null
    git commit -m "release: v$version" 2>&1 | Out-Null
}
git tag "v$version" 2>&1 | Out-Null
Write-Host "  Tagged v$version" -ForegroundColor Green

# 7. Push and redeploy the demo
$push = Read-Host "`n[6/7] Push this branch and tags to origin? (y/N)"
if ($push -eq 'y') {
    git push origin HEAD --follow-tags
}
$deploy = Read-Host "`n[7/7] Redeploy the demo to GitHub Pages? (y/N)"
if ($deploy -eq 'y') {
    npm ci --prefix demo --silent
    npm run deploy:demo
}

Write-Host "`nDone!" -ForegroundColor Cyan
