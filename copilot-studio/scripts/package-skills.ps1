param(
    [string]$OutDir = (Join-Path $PSScriptRoot '../dist')
)

$ErrorActionPreference = 'Stop'
$skillsDir = Join-Path $PSScriptRoot '../skills'
& node (Join-Path $PSScriptRoot 'validate-skills.js') $skillsDir
if ($LASTEXITCODE -ne 0) {
    throw 'Skill validation failed. No packages were created.'
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
foreach ($skill in Get-ChildItem -LiteralPath $skillsDir -Directory) {
    $archive = Join-Path $OutDir ($skill.Name + '.zip')
    $files = Get-ChildItem -LiteralPath $skill.FullName | Where-Object { $_.Name -notlike '.*' }
    Compress-Archive -LiteralPath $files.FullName -DestinationPath $archive -Force
    Write-Output "packaged $archive"
}