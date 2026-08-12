param(
  [string]$TargetDirectory = (Join-Path $PSScriptRoot '..\data\dictionaries\sources\mdx\supplements'),
  [string[]]$Only = @(),
  [switch]$Foreground
)

$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($TargetDirectory)
New-Item -ItemType Directory -Force -Path $target | Out-Null

$downloads = @(
  @{ Name = 'ldoce4-bilingual.mdx'; Url = 'https://mdx.mdict.org/%E6%8C%89%E8%AF%8D%E5%85%B8%E8%AF%AD%E7%A7%8D%E6%9D%A5%E5%88%86%E7%B1%BB/%E8%8B%B1%E8%AF%AD/%E6%99%AE%E9%80%9A%E8%AF%8D%E5%85%B8/%5B%E8%8B%B1-%E6%B1%89%5D/%5B%E8%8B%B1-%E6%B1%89%5D%20%E2%97%86%E3%80%90%E6%9C%97%E6%96%87%E5%BD%93%E4%BB%A3%E8%8B%B1%E8%AF%AD%E8%AF%8D%E5%85%B8%E8%8B%B1%E6%B1%89%E5%8F%8C%E8%A7%A3%E7%AC%AC4%E7%89%88%E3%80%91%E3%80%90%E5%AD%A4%E9%9B%B7%E6%8E%92%E7%89%88-%E5%BA%86%E5%A4%A7%E8%BF%90%E4%B8%93%E7%89%88%E3%80%91%E3%80%902011.8.12%E3%80%91%E5%B7%B2%E5%B0%8F%E6%94%B92011.8.15.mdx' },
  @{ Name = 'english-chinese-sentence-dictionary-v0.2.mdx'; Url = 'https://mdx.mdict.org/%E6%8C%89%E8%AF%8D%E5%85%B8%E8%AF%AD%E7%A7%8D%E6%9D%A5%E5%88%86%E7%B1%BB/%E8%8B%B1%E8%AF%AD/%E6%99%AE%E9%80%9A%E8%AF%8D%E5%85%B8/%5B%E8%8B%B1-%E6%B1%89%5D/%5B%E8%8B%B1-%E6%B1%89%5D%20%E2%97%86%E8%8B%B1%E6%B1%89%E5%8F%A5%E5%85%B8v0.2%E3%80%90%E7%89%88%E6%9C%AC%E6%97%A5%E6%9C%9F2009.2.20%E3%80%91.mdx' },
  @{ Name = 'common-english-phrases-zh.mdx'; Url = 'https://mdx.mdict.org/%E6%8C%89%E8%AF%8D%E5%85%B8%E8%AF%AD%E7%A7%8D%E6%9D%A5%E5%88%86%E7%B1%BB/%E8%8B%B1%E8%AF%AD/%E6%99%AE%E9%80%9A%E8%AF%8D%E5%85%B8/%5B%E8%8B%B1-%E6%B1%89%5D/%5B%E8%8B%B1-%E6%B1%89%5D%20%E2%97%86%E5%B8%B8%E7%94%A8%E8%8B%B1%E8%AF%AD%E7%9F%AD%E8%AF%AD%E8%AF%8D%E5%85%B8%E3%80%90Zhu1234%E5%8E%9F%E5%88%9B%E3%80%91%E3%80%90%E7%89%88%E6%9C%AC%E6%97%A5%E6%9C%9F20071111%E3%80%91.mdx' },
  @{ Name = 'cambridge-vocabulary-profile.rar'; Url = 'https://mdx.mdict.org/%E6%8C%89%E8%AF%8D%E5%85%B8%E8%AF%AD%E7%A7%8D%E6%9D%A5%E5%88%86%E7%B1%BB/%E8%8B%B1%E8%AF%AD/%E6%99%AE%E9%80%9A%E8%AF%8D%E5%85%B8/%5B%E8%8B%B1-%E6%B1%89%5D/CambridgeEnglishVocabularyProfile.rar' },
  @{ Name = 'coca-frequency-60000.mdx'; Url = 'https://mdx.mdict.org/%E6%8C%89%E8%AF%8D%E5%85%B8%E8%AF%AD%E7%A7%8D%E6%9D%A5%E5%88%86%E7%B1%BB/%E8%8B%B1%E8%AF%AD/%E6%99%AE%E9%80%9A%E8%AF%8D%E5%85%B8/%5B%E8%8B%B1-%E6%B1%89%5D/COCA%20Frequency%2060000,%2016-2-13/COCA%20Frequency%2060000.mdx' },
  @{ Name = 'collins-cobuild8-bilingual.mdx'; Url = 'https://mdx.mdict.org/%E6%8C%89%E8%AF%8D%E5%85%B8%E8%AF%AD%E7%A7%8D%E6%9D%A5%E5%88%86%E7%B1%BB/%E8%8B%B1%E8%AF%AD/%E6%99%AE%E9%80%9A%E8%AF%8D%E5%85%B8/%5B%E8%8B%B1-%E6%B1%89%5D/Collins%20COBUILD%20Advanced%20Learner%27s%20EN-CN%20Dictionary%208th%EF%BC%8C16-2-22/Collins%20COBUILD%20Advanced%20Learner%27s%20EN-CN%20Dictionary%20.%208th%20Edition.mdx' },
  @{ Name = 'ahd4-bilingual.mdx'; Url = 'https://mdx.mdict.org/%E6%8C%89%E8%AF%8D%E5%85%B8%E8%AF%AD%E7%A7%8D%E6%9D%A5%E5%88%86%E7%B1%BB/%E8%8B%B1%E8%AF%AD/%E6%99%AE%E9%80%9A%E8%AF%8D%E5%85%B8/%5B%E8%8B%B1-%E6%B1%89%5D/American%20Heritage%20Dictionary%204th%20%28CN%29/AHD4-Huge%20Mod.mdx' },
  @{ Name = 'new-oxford2-bilingual.mdx'; Url = 'https://mdx.mdict.org/%E6%8C%89%E8%AF%8D%E5%85%B8%E8%AF%AD%E7%A7%8D%E6%9D%A5%E5%88%86%E7%B1%BB/%E8%8B%B1%E8%AF%AD/%E6%99%AE%E9%80%9A%E8%AF%8D%E5%85%B8/%5B%E8%8B%B1-%E6%B1%89%5D/%E6%96%B0%E7%89%9B%E6%B4%A5%E8%8B%B1%E6%B1%89%E5%8F%8C%E8%A7%A3%E5%A4%A7%E8%AF%8D%E5%85%B8%20%E7%AC%AC2%E7%89%88/%E6%96%B0%E7%89%9B%E6%B4%A5%E8%8B%B1%E6%B1%89%E5%8F%8C%E8%A7%A3%E5%A4%A7%E8%AF%8D%E5%85%B8%20%E7%AC%AC2%E7%89%88.mdx' },
  @{ Name = 'longman-language-activator.mdx'; Url = 'https://mdx.mdict.org/%E6%8C%89%E8%AF%8D%E5%85%B8%E8%AF%AD%E7%A7%8D%E6%9D%A5%E5%88%86%E7%B1%BB/%E8%8B%B1%E8%AF%AD/%E6%99%AE%E9%80%9A%E8%AF%8D%E5%85%B8/%5B%E8%8B%B1-%E8%8B%B1%5D/%E6%9C%97%E6%96%87%E8%AF%8D%E5%85%B8/Longman%20Language%20Activator.mdx' },
  @{ Name = 'oxford-collocations2.mdd'; Url = 'https://mdx.mdict.org/%E6%8C%89%E8%AF%8D%E5%85%B8%E8%AF%AD%E7%A7%8D%E6%9D%A5%E5%88%86%E7%B1%BB/%E8%8B%B1%E8%AF%AD/%E6%99%AE%E9%80%9A%E8%AF%8D%E5%85%B8/%5B%E8%8B%B1-%E8%8B%B1%5D/%E7%89%9B%E6%B4%A5%E8%AF%8D%E5%85%B8/Oxford%20Collocations%20Dictionary%20for%20learners%20of%20English%202nd.mdd' },
  @{ Name = 'oxford-collocations2.mdx'; Url = 'https://mdx.mdict.org/%E6%8C%89%E8%AF%8D%E5%85%B8%E8%AF%AD%E7%A7%8D%E6%9D%A5%E5%88%86%E7%B1%BB/%E8%8B%B1%E8%AF%AD/%E6%99%AE%E9%80%9A%E8%AF%8D%E5%85%B8/%5B%E8%8B%B1-%E8%8B%B1%5D/%E7%89%9B%E6%B4%A5%E8%AF%8D%E5%85%B8/Oxford%20Collocations%20Dictionary%20for%20learners%20of%20English%202nd.mdx' },
  @{ Name = 'oxford-idioms.mdx'; Url = 'https://mdx.mdict.org/%E6%8C%89%E8%AF%8D%E5%85%B8%E8%AF%AD%E7%A7%8D%E6%9D%A5%E5%88%86%E7%B1%BB/%E8%8B%B1%E8%AF%AD/%E6%99%AE%E9%80%9A%E8%AF%8D%E5%85%B8/%5B%E8%8B%B1-%E8%8B%B1%5D/%E7%89%9B%E6%B4%A5%E8%AF%8D%E5%85%B8/Oxford%20Idiom%202004.mdx' },
  @{ Name = 'cambridge-phrasal-verbs.mdx'; Url = 'https://mdx.mdict.org/%E6%8C%89%E8%AF%8D%E5%85%B8%E8%AF%AD%E7%A7%8D%E6%9D%A5%E5%88%86%E7%B1%BB/%E8%8B%B1%E8%AF%AD/%E6%99%AE%E9%80%9A%E8%AF%8D%E5%85%B8/%5B%E8%8B%B1-%E8%8B%B1%5D/%E5%89%91%E6%A1%A5%E8%AF%8D%E5%85%B8/%5B%E8%8B%B1-%E8%8B%B1%5D%20Cambridge%20Phrasal%20Verbs%20Dictionary.mdx' },
  @{ Name = 'merriam-webster-pronunciation.mdx'; Url = 'https://mdx.mdict.org/Recommend/MW11sound.mdx' },
  @{ Name = 'merriam-webster-pronunciation.mdd'; Url = 'https://mdx.mdict.org/Recommend/MW11sound.mdd' },
  @{ Name = 'ode3-bilingual.mdx'; Url = 'https://dl.mdict.org/2/ODE_3e/ODE%203e%2020191231M.mdx' },
  @{ Name = 'ode3-bilingual-assets.mdd'; Url = 'https://dl.mdict.org/2/ODE_3e/ODE%203e%2020191231M.mdd' },
  @{ Name = 'ode3-bilingual-audio.mdd'; Url = 'https://dl.mdict.org/2/ODE_3e/ODE%203e%2020191231M.1.mdd' },
  @{ Name = 'ode3-bilingual.css'; Url = 'https://dl.mdict.org/2/ODE_3e/ODE.css' }
)

$selectedDownloads = if ($Only.Count) {
  $downloads | Where-Object { $Only -contains $_.Name }
} else {
  $downloads
}

$started = foreach ($download in $selectedDownloads) {
  $destination = Join-Path $target $download.Name
  $activeProcess = Get-CimInstance Win32_Process -Filter "Name='curl.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$destination*" } |
    Select-Object -First 1
  if ($activeProcess) {
    [pscustomobject]@{ Name = $download.Name; Status = 'downloading'; ProcessId = $activeProcess.ProcessId }
    continue
  }
  $headers = & curl.exe --silent --show-error --location --head --max-time 30 $download.Url
  $remoteLength = $headers |
    Select-String -Pattern '(?i)^content-length:\s*(\d+)' |
    Select-Object -Last 1 |
    ForEach-Object { [long]$_.Matches[0].Groups[1].Value }
  $localLength = if (Test-Path -LiteralPath $destination) { (Get-Item -LiteralPath $destination).Length } else { 0 }
  if ($remoteLength -and $localLength -eq $remoteLength) {
    [pscustomobject]@{ Name = $download.Name; Status = 'complete'; ProcessId = $null }
    continue
  }
  $arguments = @('--fail', '--location', '--retry', '5', '--continue-at', '-', '--output', $destination, $download.Url)
  if ($Foreground) {
    & curl.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $($download.Name)" }
    [pscustomobject]@{ Name = $download.Name; Status = 'complete'; ProcessId = $null }
  } else {
    $process = Start-Process -FilePath 'curl.exe' -ArgumentList $arguments -WindowStyle Hidden -PassThru
    [pscustomobject]@{ Name = $download.Name; Status = 'downloading'; ProcessId = $process.Id }
  }
}

$started
