@{
    # =====================================================================
    # SDP Dashboard installer - declarative configuration.
    # KEEP THIS FILE PURE ASCII (Windows ANSI parse pitfall).
    # Values here are DEFAULTS; config.test.psd1 merges over them for the
    # parallel test instance. Every questionnaire answer can be pre-filled
    # in EnvAnswers for a fully silent install (scripted DR).
    # =====================================================================
    AppName        = 'SDP Dashboard'
    ServiceName    = 'endeavour-dashboard'     # pm2 process name
    InstallDir     = 'C:\Apps\SDP-Dashboard'
    AppPort        = 3456
    HeapMB         = 4096                      # --max-old-space-size (OOM crash-loop guard)

    NodeMinMajor   = 24
    PgMajor        = 17
    PgHost         = 'localhost'
    PgPort         = 5432
    # Same appliance convention as the 4MyPeople installer: a BLANK password
    # prompt resolves to this standard value.
    StandardPgSuperPassword = 'OneEDV4all!2026Production#IT'
    DbName         = 'sdp_dashboard'
    DbUser         = 'sdp_app'
    BackendsDefault = 'postgres'               # TRACKER/MEETINGS/INSPECTION/REPORTS on fresh installs

    BackupDir       = '..\SDP-Backups'        # relative to InstallDir
    RetentionFull   = 8
    RetentionDbOnly = 14

    # Silent-mode questionnaire answers (empty hash = interactive prompts).
    # Keys mirror .env keys, e.g. @{ DASH_USER = 'admin'; PORT = '3456' }
    EnvAnswers = @{}
}
