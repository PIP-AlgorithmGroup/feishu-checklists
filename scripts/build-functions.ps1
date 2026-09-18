$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outputDirectory = Join-Path $projectRoot "dist"
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$packages = [ordered]@{
  "feishu-sign" = @(
    "index.js",
    "package.json"
  )
  "feishu-checklist-api" = @(
    "index.js",
    "auth.js",
    "image.js",
    "package.json",
    "package-lock.json"
  )
  "feishu-card-callback" = @(
    "index.js",
    "logic.js",
    "package.json"
  )
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

foreach ($package in $packages.GetEnumerator()) {
  $sourceDirectory = Join-Path $projectRoot "cloudfunctions/$($package.Key)"
  $sourceFiles = $package.Value | ForEach-Object {
    $path = Join-Path $sourceDirectory $_
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Missing deployment file: $path"
    }
    $path
  }
  $archivePath = Join-Path $outputDirectory "$($package.Key).zip"
  Compress-Archive -Force -Path $sourceFiles -DestinationPath $archivePath

  $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    $actualEntries = @($archive.Entries | ForEach-Object FullName | Sort-Object)
    $expectedEntries = @($package.Value | Sort-Object)
    if (Compare-Object $expectedEntries $actualEntries) {
      throw "Unexpected ZIP contents: $archivePath"
    }
  } finally {
    $archive.Dispose()
  }

  Write-Host "Built $archivePath"
}
