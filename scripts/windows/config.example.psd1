@{
    AppPath = 'C:\FinanceMAX\App'
    DataRoot = 'C:\ProgramData\FinanceMAX'
    BackupRoot = 'D:\FinanceMAXBackups'
    Hostname = 'FINANCEMAX_HOSTNAME'
    OfficeLanCidr = 'OFFICE_LAN_CIDR'
    AdminNetwork = 'ADMIN_NETWORK_CIDR'
    HttpsPort = 443
    AppPort = 3000
    PostgresPort = 5432
    Database = 'financemax_production'
    PostgresService = 'postgresql-x64-18'
    PgBin = 'C:\Program Files\PostgreSQL\18\bin'
    NodeExe = 'C:\Program Files\nodejs\node.exe'
    GitRepository = 'git@github.com:Rustam-RuKo/FinanceMAX.git'
    ExpectedCommit = '8ddbd94f7684679094dd2020f8f45a136bdbd2d2'
    WinSWSource = 'C:\Install\WinSW.NET461.exe'
    WinSWSha256 = 'REVIEWED_WINSW_SHA256'
    BackupTime = '02:00'
    BackupTaskUser = 'FINANCEMAX_BACKUP_LOCAL_ACCOUNT'
    EnableFirewallRule = $false
    BackupMaxAgeHours = 26
    MinimumFreeGB = 10
}
