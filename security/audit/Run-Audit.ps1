param(
 [Parameter(Mandatory=$true)][string]$AuditDirectory,
 [string]$AppImage,
 [string]$NativeImage,
 [string]$BrokerImage,
 [string]$Docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe',
 [switch]$Offline
)
$ErrorActionPreference='Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$audit=[IO.Path]::GetFullPath($AuditDirectory)
if ($audit -eq $repo -or $audit.StartsWith($repo+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {throw 'Keep private audit artifacts outside the repository.'}
$tooling=Join-Path $audit 'tooling'
$out=Join-Path $audit (Get-Date -Format 'yyyyMMdd-HHmmss')
function Checked-Python([string[]]$Arguments){
 & python -I -S -X utf8 @Arguments
 if($LASTEXITCODE -ne 0){throw 'Audit stage failed; no clean result is assumed.'}
}
if(-not $Offline){Checked-Python -Arguments @((Join-Path $PSScriptRoot 'prepare.py'),'--tooling',$tooling)}
Checked-Python -Arguments @((Join-Path $PSScriptRoot 'test_scanner.py'),'--tooling',$tooling)
Checked-Python -Arguments @((Join-Path $PSScriptRoot 'test_archive.py'),'--tooling',$tooling)
Checked-Python -Arguments @((Join-Path $PSScriptRoot 'test_installed.py'))
$scan=@((Join-Path $PSScriptRoot 'scan.py'),'--root',$repo,'--tooling',$tooling,'--out',$out)
if(-not $Offline){$scan+='--fetch-deps'}
Checked-Python -Arguments $scan
Checked-Python -Arguments @((Join-Path $PSScriptRoot 'finish_large_files.py'),'--root',$repo,'--tooling',$tooling,'--run',$out)
if(-not $Offline){Checked-Python -Arguments @((Join-Path $PSScriptRoot 'check_advisories.py'),'--root',$repo,'--out',$out)}
if($AppImage){
 $runtime=@((Join-Path $PSScriptRoot 'runtime_checks.py'),'--docker',$Docker,'--app-image',$AppImage,'--out',$out)
 if($NativeImage){$runtime+=@('--native-image',$NativeImage)}
 & python -I -S -X utf8 @runtime
}
foreach($item in @(@{Name='app';Image=$AppImage;Code='/app'},@{Name='native';Image=$NativeImage;Code='/native'},@{Name='broker';Image=$BrokerImage;Code='/broker-code'})){
 if($item.Image){
  & python -I -S -X utf8 (Join-Path $PSScriptRoot 'image_audit.py') --docker $Docker --image $item.Image --code-path $item.Code --root $repo --tooling $tooling --reference $out --out ($out+'-image-'+$item.Name)
  if($LASTEXITCODE -ne 0){Write-Warning ('Image audit incomplete: '+$item.Name)}
  if($item.Name -eq 'app' -and $LASTEXITCODE -eq 0){
   & python -I -S -X utf8 (Join-Path $PSScriptRoot 'verify_installed_dependencies.py') --root $repo --image-run ($out+'-image-app') --reference $out
   if($LASTEXITCODE -ne 0){Write-Warning 'Installed dependency comparison incomplete or different.'}
  }
 }
}
Checked-Python -Arguments @((Join-Path $PSScriptRoot 'report.py'),'--out',$out)
Write-Output "Audit evidence: $out"
