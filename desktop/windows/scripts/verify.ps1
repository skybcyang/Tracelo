param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot "../artifacts"),
    [string]$Version = "0.7.0"
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
dotnet run --project "$root/desktop/windows/CaptureCore.Tests" -c Release
if ($LASTEXITCODE -ne 0) { throw "Capture core tests failed" }
dotnet publish "$root/desktop/windows/TraceloCapture/TraceloCapture.csproj" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true "-p:Version=$Version" -o "$output/app"
if ($LASTEXITCODE -ne 0) { throw "Windows publish failed" }
$process = Start-Process "$output/app/TraceloCapture.exe" -ArgumentList "--smoke-test", ('"{0}"' -f "$output/smoke") -Wait -PassThru
if (Test-Path "$output/smoke/smoke-result.txt") { Get-Content "$output/smoke/smoke-result.txt" }
if ($process.ExitCode -ne 0) { throw "Windows native smoke test failed: $($process.ExitCode)" }
Write-Output "Published executable and native smoke screenshots: $output"
