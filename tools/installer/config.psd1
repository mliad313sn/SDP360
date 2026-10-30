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
    PgMajor        = 17                        # version BUNDLED in payload\installers (installed only when no cluster exists)
    # Minimum major an EXISTING cluster must be for us to reuse it. 13, because
    # both the -ConfirmDataLoss path and Manage-SDP's restore use
    # 'DROP DATABASE ... WITH (FORCE)', which is PostgreSQL 13+. On an older
    # cluster the install would look fine and then a restore would fail on a
    # syntax error, long after anyone connects the two events.
    PgMinMajor     = 13
    PgHost         = 'localhost'
    PgPort         = 5432
    # Security review (2026-10-29): NO password is ever stored here — this file is in git and in
    # every package. The PostgreSQL superuser password comes from PG_SUPER_PASSWORD (environment),
    # EnvAnswers.PG_SUPER_PASSWORD (silent mode, a local copy never committed) or a masked prompt.
    StandardPgSuperPassword = ''
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
