#!/usr/bin/env pwsh
# Publish vise-workflow-engine to npm
# Usage: .\publish.ps1 [patch|minor|major]

param(
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Bump = 'patch'
)

$ErrorActionPreference = 'Stop'

Write-Host "`n=== vise-workflow-engine publish ===" -ForegroundColor Cyan

# 1. Ensure working directory is clean
$status = git status --porcelain
if ($status) {
    Write-Host "ERROR: Working directory has uncommitted changes:" -ForegroundColor Red
    Write-Host $status
    exit 1
}

# 2. Install frontend deps & build
Write-Host "`n[1/5] Building frontend..." -ForegroundColor Yellow
Push-Location frontend
npm install --silent
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "ERROR: Frontend build failed" -ForegroundColor Red; exit 1 }
Pop-Location
Write-Host "  Frontend built successfully." -ForegroundColor Green

# 3. Verify dist exists
if (-not (Test-Path "frontend/dist/index.mjs")) {
    Write-Host "ERROR: frontend/dist/index.mjs not found after build" -ForegroundColor Red
    exit 1
}

# 4. Bump version
Write-Host "`n[2/5] Bumping version ($Bump)..." -ForegroundColor Yellow
npm version $Bump --no-git-tag-version
$version = (Get-Content package.json | ConvertFrom-Json).version
Write-Host "  New version: $version" -ForegroundColor Green

# 5. Dry run
Write-Host "`n[3/5] Running publish dry-run..." -ForegroundColor Yellow
npm publish --dry-run
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Dry run failed" -ForegroundColor Red; exit 1 }

# 6. Confirm
Write-Host ""
$confirm = Read-Host "Publish v$version to npm? (y/N)"
if ($confirm -ne 'y') {
    Write-Host "Aborted. Version was bumped to $version - revert with: git checkout package.json" -ForegroundColor Yellow
    exit 0
}

# 7. Publish
Write-Host "`n[4/5] Publishing to npm..." -ForegroundColor Yellow
npm publish
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Publish failed" -ForegroundColor Red; exit 1 }
Write-Host "  Published vise-workflow-engine@$version" -ForegroundColor Green

# 8. Git commit & tag
Write-Host "`n[5/5] Committing and tagging..." -ForegroundColor Yellow
git add package.json
git commit -m "release: v$version"
git tag "v$version"
Write-Host "  Tagged v$version - push with: git push; git push --tags" -ForegroundColor Green

Write-Host "`nDone!" -ForegroundColor Cyan
