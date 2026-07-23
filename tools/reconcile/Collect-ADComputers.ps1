# =====================================================================
# Collect-ADComputers.ps1 - export des objets ordinateur du domaine.
#
#   powershell -ExecutionPolicy Bypass -File Collect-ADComputers.ps1
#   ... -OutFile C:\Temp\ad.csv     (defaut: AD-computers_<date>.csv ici)
#   ... -Quiet                      (pas de resume a l'ecran)
#
# N'UTILISE PAS Get-ADComputer : cette cmdlet exige RSAT, absent d'un poste
# courant, et le script echouerait chez la moitie des operateurs.
# DirectorySearcher est natif sur tout Windows joint au domaine.
#
# Aucun droit administrateur requis - lire les objets ordinateur est un droit
# de tout compte du domaine. LECTURE SEULE : ce script n'ecrit rien dans
# l'annuaire.
#
# Sortie : CSV UTF-8 AVEC BOM, a deposer sur Assets > Reconciliation.
#
# KEEP THIS FILE PURE ASCII (Windows PowerShell 5.1 ANSI parse pitfall).
# =====================================================================
param(
    [string]$OutFile,
    [switch]$Quiet
)
$ErrorActionPreference = 'Stop'

if (-not $OutFile) {
    $OutFile = Join-Path (Get-Location) ('AD-computers_' + (Get-Date -Format 'yyyyMMdd') + '.csv')
}

# --- rattachement au domaine ------------------------------------------------
# RootDSE echoue immediatement hors domaine : le dire clairement vaut mieux
# qu'une exception .NET brute que l'operateur ne saura pas interpreter.
try {
    $rootDse = [ADSI]'LDAP://RootDSE'
    $baseDn  = [string]$rootDse.defaultNamingContext
    if (-not $baseDn) { throw 'defaultNamingContext vide' }
} catch {
    Write-Host ''
    Write-Host '  [ERREUR] Annuaire injoignable.' -ForegroundColor Red
    Write-Host '  Cette machine est-elle bien jointe au domaine, et la session ouverte' -ForegroundColor Red
    Write-Host '  avec un compte du domaine (et non un compte local) ?' -ForegroundColor Red
    Write-Host ''
    exit 1
}

$searcher = $null
$results  = $null
$rows     = New-Object System.Collections.ArrayList
try {
    $searcher = New-Object System.DirectoryServices.DirectorySearcher
    $searcher.SearchRoot = New-Object System.DirectoryServices.DirectoryEntry("LDAP://$baseDn")
    $searcher.Filter     = '(objectCategory=computer)'
    # SANS pagination l'annuaire s'arrete a 1000 objets et le CSV serait
    # silencieusement tronque - le pire resultat possible pour un outil dont le
    # role est justement de reperer ce qui manque.
    $searcher.PageSize   = 1000
    $searcher.SizeLimit  = 0
    foreach ($p in @('name', 'dNSHostName', 'operatingSystem', 'operatingSystemVersion',
                     'lastLogonTimestamp', 'whenCreated', 'distinguishedName', 'userAccountControl')) {
        [void]$searcher.PropertiesToLoad.Add($p)
    }

    $results = $searcher.FindAll()
    foreach ($r in $results) {
        $p = $r.Properties
        $first = {
            param($key)
            if ($p.Contains($key) -and $p[$key].Count -gt 0) { [string]$p[$key][0] } else { '' }
        }

        # lastLogonTimestamp est un FILETIME 64 bits, PAS une date. Non converti
        # il sort en 133000000000000000 et toute comparaison de fraicheur est
        # fausse - donc tout le rapport d'ecarts avec.
        $lastLogon = ''
        if ($p.Contains('lastlogontimestamp') -and $p['lastlogontimestamp'].Count -gt 0) {
            try {
                $ticks = [Int64]$p['lastlogontimestamp'][0]
                if ($ticks -gt 0) { $lastLogon = [DateTime]::FromFileTimeUtc($ticks).ToString('yyyy-MM-ddTHH:mm:ssZ') }
            } catch { $lastLogon = '' }
        }

        $uac = 0
        if ($p.Contains('useraccountcontrol') -and $p['useraccountcontrol'].Count -gt 0) {
            $uac = [int]$p['useraccountcontrol'][0]
        }

        [void]$rows.Add([PSCustomObject]@{
            name                   = (& $first 'name')
            dNSHostName            = (& $first 'dnshostname')
            operatingSystem        = (& $first 'operatingsystem')
            operatingSystemVersion = (& $first 'operatingsystemversion')
            lastLogonTimestamp     = $lastLogon
            whenCreated            = (& $first 'whencreated')
            distinguishedName      = (& $first 'distinguishedname')
            enabled                = (-not ($uac -band 0x2))   # bit 2 = ACCOUNTDISABLE
        })
    }
} finally {
    # SearchResultCollection tient des handles COM non geres : sans Dispose
    # explicite ils fuient jusqu'a la fin du processus. Sur un annuaire de
    # 20 000 objets ce n'est plus anecdotique.
    if ($results)  { $results.Dispose() }
    if ($searcher) { $searcher.Dispose() }
}

# UTF-8 AVEC BOM : sans lui Excel ouvre les accents en mojibake sur un Windows
# francais, et l'operateur croit le fichier corrompu.
$csv = $rows | ConvertTo-Csv -NoTypeInformation
[System.IO.File]::WriteAllLines($OutFile, $csv, (New-Object System.Text.UTF8Encoding $true))

if (-not $Quiet) {
    $enabled = @($rows | Where-Object { $_.enabled }).Count
    Write-Host ''
    Write-Host ('  ' + $rows.Count + ' ordinateurs exportes') -ForegroundColor Green
    Write-Host ('  dont actifs (compte non desactive) : ' + $enabled)
    Write-Host ('  -> ' + $OutFile)
    Write-Host ''
    Write-Host '  Deposez ce fichier sur la page Assets > Reconciliation.'
    Write-Host ''
}
