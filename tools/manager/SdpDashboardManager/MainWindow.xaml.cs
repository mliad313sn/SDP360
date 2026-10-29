using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Win32;

namespace Sdp.Manager
{
    public partial class MainWindow : Window
    {
        private readonly DispatcherTimer _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
        private string _package;
        private string _backupDir;
        private bool _busy;

        private static readonly Brush Green = new SolidColorBrush(Color.FromRgb(0x1E, 0x7B, 0x45));
        private static readonly Brush Amber = new SolidColorBrush(Color.FromRgb(0xB4, 0x53, 0x09));
        private static readonly Brush Red = new SolidColorBrush(Color.FromRgb(0xB9, 0x1C, 0x1C));
        private static readonly Brush Grey = new SolidColorBrush(Color.FromRgb(0x9A, 0xA4, 0xB2));

        public MainWindow()
        {
            InitializeComponent();
            SideDir.Text = ManagerCli.AppDir;
            _timer.Tick += async (s, e) => { if (PageOverview.Visibility == Visibility.Visible && !_busy) await RefreshStatus(quiet: true); };
            Loaded += async (s, e) =>
            {
                if (!File.Exists(ManagerCli.Script))
                {
                    Say("tools\\sdp-manager.js not found next to the Manager — is this an SDP Dashboard install folder?", error: true);
                    return;
                }
                await RefreshStatus();
                _timer.Start();
            };
        }

        // ── helpers ────────────────────────────────────────────────────────────
        private void Say(string text, bool error = false)
        {
            StatusText.Text = text;
            StatusText.Foreground = error ? Red : (Brush)FindResource("Muted");
        }
        private async Task<CliResult> Run(string label, params string[] args)
        {
            _busy = true; Busy.Visibility = Visibility.Visible; Say(label + "…");
            foreach (var b in FindButtons(this)) b.IsEnabled = false;
            try
            {
                var r = await ManagerCli.Run(args);
                OutputBox.Text = (r.Output + (string.IsNullOrWhiteSpace(r.Error) ? "" : Environment.NewLine + r.Error)).Trim();
                OutputBox.ScrollToEnd();
                Say(r.Ok ? label + " — done" : label + " — failed (see the output below)", !r.Ok);
                return r;
            }
            finally
            {
                foreach (var b in FindButtons(this)) b.IsEnabled = true;
                BtnVerify.IsEnabled = BtnApply.IsEnabled = _package != null;
                Busy.Visibility = Visibility.Collapsed; _busy = false;
            }
        }
        private static IEnumerable<Button> FindButtons(DependencyObject root)
        {
            for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
            {
                var c = VisualTreeHelper.GetChild(root, i);
                if (c is Button b) yield return b;
                foreach (var x in FindButtons(c)) yield return x;
            }
        }
        private static string Bytes(object v)
        {
            if (v == null) return "—";
            var n = Convert.ToDouble(v);
            return n >= 1073741824 ? (n / 1073741824).ToString("0.0") + " GB" : n >= 1048576 ? (n / 1048576).ToString("0.0") + " MB" : (n / 1024).ToString("0") + " KB";
        }
        private static string When(string iso) => string.IsNullOrEmpty(iso) ? "—" : iso.Replace("T", " ").Replace("Z", "").Substring(0, Math.Min(16, iso.Length));

        // ── navigation ─────────────────────────────────────────────────────────
        private async void OnNav(object sender, RoutedEventArgs e)
        {
            if (!IsLoaded) return;
            var tag = (string)((FrameworkElement)sender).Tag;
            foreach (var p in new[] { PageOverview, PageService, PageBackups, PageUpdates, PageDiagnostics }) p.Visibility = Visibility.Collapsed;
            ((FrameworkElement)FindName("Page" + tag)).Visibility = Visibility.Visible;
            if (tag == "Backups") await ListBackups();
            if (tag == "Overview" || tag == "Service" || tag == "Updates") await RefreshStatus(quiet: true);
        }

        // ── overview ───────────────────────────────────────────────────────────
        private async Task RefreshStatus(bool quiet = false)
        {
            var r = quiet ? await ManagerCli.Run("status", "--json") : await Run("Reading status", "status", "--json");
            var j = r.Json;
            if (j == null) { if (!quiet) Say("Status unreadable — see the output", true); return; }
            var svc = ManagerCli.D(j, "service"); var http = ManagerCli.D(j, "http"); var bk = ManagerCli.D(j, "backups"); var disk = ManagerCli.D(j, "disk");
            var state = ManagerCli.S(svc, "state") ?? "unknown"; var kind = ManagerCli.S(svc, "kind") ?? "none";
            SvcText.Text = kind == "none" ? "Not installed" : char.ToUpper(state[0]) + state.Substring(1);
            SvcDot.Fill = state == "running" ? Green : state == "stopped" || kind == "none" ? Red : Amber;
            SvcKind.Text = kind == "windows" ? "Windows service SDPDashboard" : kind == "pm2" ? "pm2 process " + (ManagerCli.S(svc, "name") ?? "") : "Run Setup again (Repair) to register it";
            SvcLine.Text = SvcText.Text + " — " + SvcKind.Text;
            var webOk = http != null && Convert.ToBoolean(http["ok"]);
            WebText.Text = webOk ? "Answers" : "No answer"; WebDot.Fill = webOk ? Green : Red;
            WebUrl.Text = webOk ? ManagerCli.S(j, "url") : (ManagerCli.S(http, "reason") ?? "");
            var ver = ManagerCli.S(j, "version") ?? "unknown";
            VerText.Text = ver; VerSub.Text = "commit " + (ManagerCli.S(j, "commit") ?? "?") + " · built " + When(ManagerCli.S(j, "built_at"));
            SideVersion.Text = "Version " + ver; UpdCurrent.Text = "Installed version: " + ver;
            var latest = ManagerCli.D(bk, "latest");
            BkText.Text = latest == null ? "None yet" : When(ManagerCli.S(latest, "at"));
            BkText.Foreground = latest == null ? Red : (Brush)FindResource("Text");
            BkSub.Text = (ManagerCli.S(bk, "count") ?? "0") + " kept in " + (ManagerCli.S(bk, "dir") ?? "?") + (ManagerCli.S(bk, "encrypted_key_set") == "True" ? " · encrypted" : " · NOT encrypted (set SDP_BACKUP_KEY)");
            _backupDir = ManagerCli.S(bk, "dir");
            if (disk != null)
            {
                var free = Convert.ToDouble(disk["free_bytes"]); var total = Convert.ToDouble(disk["total_bytes"]);
                DiskText.Text = Bytes(free) + " free"; DiskSub.Text = "of " + Bytes(total);
                DiskText.Foreground = free < 5368709120 ? Red : (Brush)FindResource("Text");
            }
            else { DiskText.Text = "—"; DiskSub.Text = ""; }
            RbText.Text = ManagerCli.S(j, "rollback_available") == "True" ? "Yes" : "No";
            var sync = j.TryGetValue("sync", out var s) ? s as ArrayList : null;
            SyncEmpty.Visibility = sync == null || sync.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            SyncList.ItemsSource = sync?.Cast<Dictionary<string, object>>().Select(x =>
            {
                var st = (ManagerCli.S(x, "state") ?? "").ToUpperInvariant();
                return new { Id = ManagerCli.S(x, "id"), State = st == "" ? "—" : st, LastOk = "last ok " + When(ManagerCli.S(x, "last_ok")), Dot = st == "OK" || st == "GREEN" ? Green : st == "STALE" || st == "AMBER" || st == "WARN" ? Amber : st == "" ? Grey : Red };
            }).ToList();
            if (!quiet) Say("Status read at " + DateTime.Now.ToString("HH:mm:ss"));
        }
        private async void OnRefresh(object sender, RoutedEventArgs e) => await RefreshStatus();
        private void OnOpenDashboard(object sender, RoutedEventArgs e) => Process.Start(new ProcessStartInfo(ManagerCli.Url) { UseShellExecute = true });

        // ── service ────────────────────────────────────────────────────────────
        private async void OnRestart(object sender, RoutedEventArgs e) { await Run("Restarting the service", "service", "restart", "--json"); await RefreshStatus(quiet: true); }
        private async void OnStart(object sender, RoutedEventArgs e) { await Run("Starting the service", "service", "start", "--json"); await RefreshStatus(quiet: true); }
        private async void OnStop(object sender, RoutedEventArgs e)
        {
            if (MessageBox.Show(this, "Stop SDP Dashboard? Nobody can use it until it is started again.", "Stop the service", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
            await Run("Stopping the service", "service", "stop", "--json"); await RefreshStatus(quiet: true);
        }
        private void OnOpenLogs(object sender, RoutedEventArgs e) { Directory.CreateDirectory(ManagerCli.LogDir); Process.Start("explorer.exe", "\"" + ManagerCli.LogDir + "\""); }
        private void OnOpenInstall(object sender, RoutedEventArgs e) => Process.Start("explorer.exe", "\"" + ManagerCli.AppDir + "\"");

        // ── backups ────────────────────────────────────────────────────────────
        private sealed class BackupRow { public string At { get; set; } public string Size { get; set; } public string Enc { get; set; } public string Name { get; set; } public string Confirm { get; set; } }
        private async Task ListBackups()
        {
            var r = await ManagerCli.Run("backups", "--json");
            var j = r.Json;
            _backupDir = ManagerCli.S(j, "dir") ?? _backupDir;
            BkIntro.Text = "Backups are PostgreSQL dumps in " + (_backupDir ?? "the backup folder") + ". The nightly job keeps the last 14; keep a copy off the server (Admin ▸ backup off-site path).";
            var list = j != null && j.TryGetValue("backups", out var b) ? b as ArrayList : null;
            BackupList.ItemsSource = list?.Cast<Dictionary<string, object>>().Select(x => new BackupRow
            {
                At = When(ManagerCli.S(x, "at")), Size = Bytes(x.TryGetValue("bytes", out var by) ? by : null),
                Enc = ManagerCli.S(x, "encrypted") == "True" ? "yes" : "no", Name = ManagerCli.S(x, "name"), Confirm = ManagerCli.S(x, "confirm"),
            }).ToList();
        }
        private async void OnListBackups(object sender, RoutedEventArgs e) => await ListBackups();
        private async void OnBackup(object sender, RoutedEventArgs e) { await Run("Backing up the database", "backup", "--json"); await ListBackups(); }
        private async void OnRestore(object sender, RoutedEventArgs e)
        {
            if (!(BackupList.SelectedItem is BackupRow row)) { Say("Select a backup in the list first", true); return; }
            if (string.IsNullOrEmpty(row.Confirm) || string.IsNullOrEmpty(_backupDir)) { Say("This file is not a dashboard backup", true); return; }
            var ok = ConfirmWindow.Ask(this, "Restore the database",
                "The whole database is replaced by the backup taken " + row.At + " UTC. Everything entered since then is lost (a backup of the current database is taken first, so you can come back). The service stops during the restore.",
                row.Confirm);
            if (!ok) return;
            await Run("Restoring the database", "restore", Path.Combine(_backupDir, row.Name), "--confirm", row.Confirm);
            await ListBackups(); await RefreshStatus(quiet: true);
        }

        // ── updates ────────────────────────────────────────────────────────────
        private void OnChoosePackage(object sender, RoutedEventArgs e)
        {
            var d = new OpenFileDialog { Filter = "SDP Dashboard package (sdp-dashboard-*.zip)|sdp-dashboard-*.zip|Zip files (*.zip)|*.zip", Title = "Choose an update package" };
            if (d.ShowDialog(this) != true) return;
            _package = d.FileName; PkgPath.Text = _package; BtnVerify.IsEnabled = BtnApply.IsEnabled = true;
        }
        private string[] UnsignedFlag() => AllowUnsigned.IsChecked == true ? new[] { "--allow-unsigned" } : new string[0];
        private async void OnVerify(object sender, RoutedEventArgs e)
        {
            if (_package == null) return;
            await Run("Checking the package", new[] { "verify", _package }.Concat(UnsignedFlag()).ToArray());
        }
        private async void OnApply(object sender, RoutedEventArgs e)
        {
            if (_package == null) return;
            if (!ConfirmWindow.Ask(this, "Apply the update",
                "The package is checked, the database backed up, the current version kept, then the files are replaced and the service restarted (about a minute without service). A failed update rolls itself back.",
                "UPDATE")) return;
            await Run("Applying the update", new[] { "update", _package }.Concat(UnsignedFlag()).ToArray());
            await RefreshStatus(quiet: true);
        }
        private async void OnRollback(object sender, RoutedEventArgs e)
        {
            if (!ConfirmWindow.Ask(this, "Roll back", "The application files kept before the last update are put back and the service restarts. The database is not changed.", "ROLLBACK")) return;
            await Run("Rolling back", "rollback");
            await RefreshStatus(quiet: true);
        }

        // ── diagnostics ────────────────────────────────────────────────────────
        private async void OnSupportBundle(object sender, RoutedEventArgs e)
        {
            var d = new SaveFileDialog { Filter = "Zip (*.zip)|*.zip", FileName = "sdp-support-" + DateTime.Now.ToString("yyyyMMdd-HHmm") + ".zip", Title = "Save the support bundle" };
            if (d.ShowDialog(this) != true) return;
            var r = await Run("Creating the support bundle", "support-bundle", "--out", d.FileName);
            if (r.Ok) Process.Start("explorer.exe", "/select,\"" + d.FileName + "\"");
        }
    }
}
