@{
    # Test-instance overrides - MERGED over config.psd1 when a script is run
    # with  -Config config.test.psd1. The parallel test instance never touches
    # prod: its own dir, port, pm2 name, database and Task Scheduler suffix.
    ServiceName = 'sdp-test'
    InstallDir  = 'C:\Apps\SDP-Dashboard-TEST'
    AppPort     = 3457
    DbName      = 'sdp_dashboard_test'
    BackupDir   = '..\SDP-Backups-TEST'   # own restore points: prune never touches the main instance's
}
