# 9 Router CLI -- PowerShell Installation Script
# Run: .\install-9cli.ps1

$projectDir = "D:\9router cli"
$batPath = "$projectDir\9cli.bat"

# 1. Verify the bat file exists
if (-not (Test-Path $batPath)) {
    Write-Host "Error: $batPath not found!" -ForegroundColor Red
    exit 1
}

# 2. Add project directory to user PATH
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$projectDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$projectDir", "User")
    Write-Host "+ Added $projectDir to PATH" -ForegroundColor Green
} else {
    Write-Host "+ $projectDir already in PATH" -ForegroundColor Green
}

# 3. Create PowerShell profile function for persistent alias
$profileContent = @"

# 9 CLI - 9 Router CLI Launcher
function 9cli {
    & bun "$projectDir\src\index.ts" @args
}
"@

$profilePath = $PROFILE
$profileDir = Split-Path $profilePath -Parent

if (-not (Test-Path $profileDir)) {
    New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
}

$alreadyInProfile = $false
if (Test-Path $profilePath) {
    $profileContent2 = Get-Content $profilePath -Raw
    if ($profileContent2 -match "function 9cli") {
        $alreadyInProfile = $true
    }
}

if (-not $alreadyInProfile) {
    Add-Content -Path $profilePath -Value $profileContent
    Write-Host "+ Added 9cli function to PowerShell profile: $profilePath" -ForegroundColor Green
} else {
    Write-Host "+ 9cli function already in PowerShell profile" -ForegroundColor Green
}

Write-Host ""
Write-Host "Installation Complete!" -ForegroundColor Cyan
Write-Host ""
Write-Host "To use 9cli right now, paste this:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  function 9cli { & bun "$projectDir\src\cli.ts" @args }" -ForegroundColor White
Write-Host ""
Write-Host "Then restart PowerShell and 9cli will work from anywhere." -ForegroundColor Green
Write-Host ""
