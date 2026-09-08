Set-StrictMode -Version Latest

$script:PrivateLanAutoValue = 'active-private-ipv4'

function Test-PrivateLanIPv4 {
  param([Parameter(Mandatory)][string]$Address)

  $parsed = $null
  if (-not [Net.IPAddress]::TryParse($Address, [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
    return $false
  }
  $bytes = $parsed.GetAddressBytes()
  return $bytes[0] -eq 10 `
    -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) `
    -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
}

function Get-ActivePrivateLanIPv4Candidates {
  $interfaces = @(
    Get-NetIPInterface -AddressFamily IPv4 -ConnectionState Connected -ErrorAction Stop |
      Where-Object { $_.InterfaceAlias -notmatch 'Loopback' }
  )
  $defaultRoutes = @(
    Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop |
      Where-Object { $_.State -eq 'Alive' }
  )
  $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction Stop)

  $candidates = foreach ($interface in $interfaces) {
    $routes = @($defaultRoutes | Where-Object { $_.InterfaceIndex -eq $interface.InterfaceIndex })
    if ($routes.Count -eq 0) { continue }
    $routeMetric = ($routes | Measure-Object -Property RouteMetric -Minimum).Minimum
    foreach ($address in @($addresses | Where-Object { $_.InterfaceIndex -eq $interface.InterfaceIndex })) {
      if (Test-PrivateLanIPv4 -Address ([string]$address.IPAddress)) {
        [pscustomobject]@{
          address = [string]$address.IPAddress
          interfaceIndex = [int]$interface.InterfaceIndex
          interfaceAlias = [string]$interface.InterfaceAlias
          priority = [int]$interface.InterfaceMetric + [int]$routeMetric
        }
      }
    }
  }
  return @($candidates | Sort-Object priority, interfaceIndex, address -Unique)
}

function Resolve-ActivePrivateLanIPv4 {
  param([string]$PreferredAddress = '')

  $candidates = @(Get-ActivePrivateLanIPv4Candidates)
  if ($candidates.Count -eq 0) {
    throw 'No active RFC1918 IPv4 address with a live default route is available for private-LAN mode.'
  }
  if ($PreferredAddress) {
    if (-not (Test-PrivateLanIPv4 -Address $PreferredAddress)) {
      throw "Requested private-LAN address is not an RFC1918 IPv4 address: $PreferredAddress"
    }
    $selected = @($candidates | Where-Object { $_.address -eq $PreferredAddress })
    if ($selected.Count -ne 1) {
      throw "Requested private-LAN address is not active on a connected default-route interface: $PreferredAddress"
    }
    return [string]$selected[0].address
  }
  return [string]$candidates[0].address
}

function New-ResolvedPrivateLanRuntimeConfig {
  param(
    [Parameter(Mandatory)][string]$TemplatePath,
    [string]$ResolvedLanAddress = ''
  )

  $template = Get-Content -Raw -LiteralPath $TemplatePath | ConvertFrom-Json
  if ([string]$template.transportMode -ne 'private-lan' `
    -or [string]$template.profileId -ne 'optimization' `
    -or [string]$template.configuredLanHost -ne $script:PrivateLanAutoValue `
    -or [string]$template.frontend.host -ne $script:PrivateLanAutoValue `
    -or [string]$template.frontend.publicUrl -ne $script:PrivateLanAutoValue) {
    throw 'Private-LAN template must use the active-private-ipv4 runtime placeholder for host and public URL.'
  }

  $address = Resolve-ActivePrivateLanIPv4 -PreferredAddress $ResolvedLanAddress
  $template.configuredLanHost = $address
  $template.frontend.host = $address
  $template.frontend.publicUrl = "http://${address}:$([int]$template.frontend.port)/"
  $temporaryPath = Join-Path ([IO.Path]::GetTempPath()) ("read-web-private-lan-$([Guid]::NewGuid().ToString('N')).json")
  [IO.File]::WriteAllText($temporaryPath, ($template | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))

  return [pscustomobject]@{
    path = $temporaryPath
    address = $address
    publicUrl = [string]$template.frontend.publicUrl
  }
}

Export-ModuleMember -Function Test-PrivateLanIPv4, Get-ActivePrivateLanIPv4Candidates, Resolve-ActivePrivateLanIPv4, New-ResolvedPrivateLanRuntimeConfig
