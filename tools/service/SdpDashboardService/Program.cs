// SDP Dashboard — Windows service host.
//
// Layout (installed by Setup.exe):
//   <app>\service\SdpDashboardService.exe   this program
//   <app>\runtime\node\node.exe             the Node.js runtime shipped with Setup (else node.exe on PATH)
//   <app>\server.js                         the application
//   <app>\logs\service-yyyyMMdd.log         Node's console output + this host's own lines (kept 30 days)
//
// Commands (an administrator console):
//   SdpDashboardService.exe install [--account DOMAIN\user]   register "SDPDashboard" (automatic, delayed start,
//                                                             restart on failure); the account password is read
//                                                             from the SDP_SETUP_SVCPASS environment variable,
//                                                             never from the command line
//   SdpDashboardService.exe uninstall                         stop and remove the service
//   SdpDashboardService.exe console                           run in this window (diagnosis), Ctrl+C to stop
// Without a command it runs as the service (started by Windows).
//
// The host restarts Node when it exits unexpectedly (5 s, 10 s, 30 s, then every 60 s) and stops the whole
// process tree on service stop (Node may have started a renderer). It never edits the application.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Text;
using System.Threading;

namespace Sdp.Service
{
    internal static class Paths
    {
        public static string ExeDir => AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        public static string AppDir => Directory.GetParent(ExeDir).FullName;
        public static string LogDir => Path.Combine(AppDir, "logs");
        public static string Node
        {
            get
            {
                var bundled = Path.Combine(AppDir, "runtime", "node", "node.exe");
                if (File.Exists(bundled)) return bundled;
                foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
                {
                    try { var p = Path.Combine(dir.Trim(), "node.exe"); if (File.Exists(p)) return p; } catch { /* bad PATH entry */ }
                }
                var pf = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
                return File.Exists(pf) ? pf : "node.exe";
            }
        }
    }

    internal sealed class Log
    {
        private static readonly object Gate = new object();
        public static void Line(string text)
        {
            try
            {
                Directory.CreateDirectory(Paths.LogDir);
                var file = Path.Combine(Paths.LogDir, "service-" + DateTime.Now.ToString("yyyyMMdd") + ".log");
                lock (Gate) File.AppendAllText(file, text.EndsWith("\n") ? text : text + Environment.NewLine, Encoding.UTF8);
            }
            catch { /* logging must never stop the service */ }
        }
        public static void Host(string text) => Line("[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] [service] " + text);
        public static void Prune(int days)
        {
            try
            {
                foreach (var f in Directory.GetFiles(Paths.LogDir, "service-*.log"))
                    if (File.GetLastWriteTime(f) < DateTime.Now.AddDays(-days)) File.Delete(f);
            }
            catch { /* best effort */ }
        }
    }

    internal sealed class DashboardService : ServiceBase
    {
        public const string Name = "SDPDashboard";
        private Process _node;
        private volatile bool _stopping;
        private Thread _watch;
        private int _failures;

        public DashboardService() { ServiceName = Name; CanStop = true; CanShutdown = true; AutoLog = true; }

        protected override void OnStart(string[] args) { Begin(); }
        protected override void OnStop() { End(); }
        protected override void OnShutdown() { End(); }

        public void Begin()
        {
            _stopping = false;
            Log.Prune(30);
            Log.Host("starting — app " + Paths.AppDir + ", node " + Paths.Node);
            StartNode();
            _watch = new Thread(Watch) { IsBackground = true, Name = "sdp-watch" };
            _watch.Start();
        }

        private void StartNode()
        {
            var psi = new ProcessStartInfo
            {
                FileName = Paths.Node,
                Arguments = "--max-old-space-size=4096 server.js",
                WorkingDirectory = Paths.AppDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            psi.EnvironmentVariables["SDP_SERVICE"] = "windows";
            var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
            p.OutputDataReceived += (s, e) => { if (e.Data != null) Log.Line(e.Data); };
            p.ErrorDataReceived += (s, e) => { if (e.Data != null) Log.Line(e.Data); };
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            _node = p;
            Log.Host("node started, pid " + p.Id);
        }

        private void Watch()
        {
            while (!_stopping)
            {
                var p = _node;
                if (p == null) { Thread.Sleep(1000); continue; }
                p.WaitForExit();
                if (_stopping) break;
                _failures++;
                var wait = _failures == 1 ? 5 : _failures == 2 ? 10 : _failures == 3 ? 30 : 60;
                Log.Host("node exited with code " + SafeExit(p) + " — restarting in " + wait + " s (failure " + _failures + ")");
                for (var i = 0; i < wait * 10 && !_stopping; i++) Thread.Sleep(100);
                if (_stopping) break;
                try { StartNode(); }
                catch (Exception e) { Log.Host("restart failed: " + e.Message); }
                // a run that lasted 10 minutes resets the back-off
                var started = DateTime.Now;
                while (!_stopping && _node != null && !_node.HasExited && (DateTime.Now - started).TotalMinutes < 10) Thread.Sleep(1000);
                if (!_stopping && _node != null && !_node.HasExited) _failures = 0;
            }
        }

        private static string SafeExit(Process p) { try { return p.ExitCode.ToString(); } catch { return "?"; } }

        public void End()
        {
            _stopping = true;
            var p = _node;
            if (p == null) return;
            try
            {
                if (!p.HasExited)
                {
                    Log.Host("stopping node (pid " + p.Id + ") and its children");
                    // the whole tree: Node may have started a renderer (python / chromium)
                    var kill = Process.Start(new ProcessStartInfo("taskkill", "/T /F /PID " + p.Id) { CreateNoWindow = true, UseShellExecute = false });
                    kill?.WaitForExit(15000);
                    if (!p.HasExited) p.Kill();
                    p.WaitForExit(10000);
                }
            }
            catch (Exception e) { Log.Host("stop: " + e.Message); }
            Log.Host("stopped");
        }
    }

    internal static class Scm
    {
        private const uint SC_MANAGER_ALL_ACCESS = 0xF003F;
        private const uint SERVICE_ALL_ACCESS = 0xF01FF;
        private const uint SERVICE_WIN32_OWN_PROCESS = 0x10;
        private const uint SERVICE_AUTO_START = 0x2;
        private const uint SERVICE_ERROR_NORMAL = 0x1;
        private const uint SERVICE_NO_CHANGE = 0xFFFFFFFF;
        private const int SERVICE_CONFIG_DESCRIPTION = 1;
        private const int SERVICE_CONFIG_FAILURE_ACTIONS = 2;
        private const int SERVICE_CONFIG_DELAYED_AUTO_START_INFO = 3;
        private const int ERROR_SERVICE_EXISTS = 1073;

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr OpenSCManager(string machine, string db, uint access);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateService(IntPtr scm, string name, string display, uint access, uint type, uint start, uint error,
            string binPath, string group, IntPtr tag, string deps, string account, string password);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr OpenService(IntPtr scm, string name, uint access);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool ChangeServiceConfig(IntPtr svc, uint type, uint start, uint error, string binPath, string group, IntPtr tag,
            string deps, string account, string password, string display);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool ChangeServiceConfig2(IntPtr svc, int level, ref ServiceDescription info);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool ChangeServiceConfig2(IntPtr svc, int level, ref DelayedAutoStart info);
        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool ChangeServiceConfig2(IntPtr svc, int level, ref FailureActions info);
        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool DeleteService(IntPtr svc);
        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool CloseServiceHandle(IntPtr h);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct ServiceDescription { public string Description; }
        [StructLayout(LayoutKind.Sequential)]
        private struct DelayedAutoStart { public bool Delayed; }
        [StructLayout(LayoutKind.Sequential)]
        private struct ScAction { public int Type; public uint Delay; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct FailureActions { public uint ResetPeriod; public string RebootMsg; public string Command; public uint Count; public IntPtr Actions; }

        private static Win32Exception Err(string what) => new Win32Exception(Marshal.GetLastWin32Error(), what);

        public static void Install(string account, string password)
        {
            var bin = "\"" + Path.Combine(Paths.ExeDir, "SdpDashboardService.exe") + "\"";
            var scm = OpenSCManager(null, null, SC_MANAGER_ALL_ACCESS);
            if (scm == IntPtr.Zero) throw Err("OpenSCManager (run as Administrator)");
            try
            {
                var acct = string.IsNullOrWhiteSpace(account) ? null : account.Trim();
                var pwd = acct == null ? null : password;
                var svc = CreateService(scm, DashboardService.Name, "SDP Dashboard", SERVICE_ALL_ACCESS, SERVICE_WIN32_OWN_PROCESS,
                    SERVICE_AUTO_START, SERVICE_ERROR_NORMAL, bin, null, IntPtr.Zero, null, acct, pwd);
                if (svc == IntPtr.Zero)
                {
                    if (Marshal.GetLastWin32Error() != ERROR_SERVICE_EXISTS) throw Err("CreateService");
                    svc = OpenService(scm, DashboardService.Name, SERVICE_ALL_ACCESS);
                    if (svc == IntPtr.Zero) throw Err("OpenService");
                    if (!ChangeServiceConfig(svc, SERVICE_WIN32_OWN_PROCESS, SERVICE_AUTO_START, SERVICE_ERROR_NORMAL, bin, null, IntPtr.Zero, null, acct, pwd, "SDP Dashboard"))
                        throw Err("ChangeServiceConfig");
                    Console.WriteLine("service updated");
                }
                else Console.WriteLine("service created");
                try
                {
                    var d = new ServiceDescription { Description = "Endeavour Mining IT operations dashboard (Node.js). Logs: " + Paths.LogDir };
                    ChangeServiceConfig2(svc, SERVICE_CONFIG_DESCRIPTION, ref d);
                    var delayed = new DelayedAutoStart { Delayed = true };   // after PostgreSQL and the network
                    ChangeServiceConfig2(svc, SERVICE_CONFIG_DELAYED_AUTO_START_INFO, ref delayed);
                    var acts = new[] { new ScAction { Type = 1, Delay = 5000 }, new ScAction { Type = 1, Delay = 10000 }, new ScAction { Type = 1, Delay = 60000 } };
                    var size = Marshal.SizeOf(typeof(ScAction));
                    var buf = Marshal.AllocHGlobal(size * acts.Length);
                    try
                    {
                        for (var i = 0; i < acts.Length; i++) Marshal.StructureToPtr(acts[i], buf + i * size, false);
                        var fa = new FailureActions { ResetPeriod = 86400, Count = (uint)acts.Length, Actions = buf };
                        if (!ChangeServiceConfig2(svc, SERVICE_CONFIG_FAILURE_ACTIONS, ref fa)) Console.WriteLine("warning: failure actions not set (" + Marshal.GetLastWin32Error() + ")");
                    }
                    finally { Marshal.FreeHGlobal(buf); }
                }
                finally { CloseServiceHandle(svc); }
            }
            finally { CloseServiceHandle(scm); }
        }

        public static void Uninstall()
        {
            using (var sc = ServiceController.GetServices().FirstOrDefault(s => s.ServiceName == DashboardService.Name))
            {
                if (sc == null) { Console.WriteLine("service not installed"); return; }
                if (sc.Status != ServiceControllerStatus.Stopped)
                {
                    try { sc.Stop(); sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(60)); } catch (Exception e) { Console.WriteLine("stop: " + e.Message); }
                }
            }
            var scm = OpenSCManager(null, null, SC_MANAGER_ALL_ACCESS);
            if (scm == IntPtr.Zero) throw Err("OpenSCManager (run as Administrator)");
            try
            {
                var svc = OpenService(scm, DashboardService.Name, SERVICE_ALL_ACCESS);
                if (svc == IntPtr.Zero) throw Err("OpenService");
                try { if (!DeleteService(svc)) throw Err("DeleteService"); Console.WriteLine("service removed"); }
                finally { CloseServiceHandle(svc); }
            }
            finally { CloseServiceHandle(scm); }
        }
    }

    internal static class Program
    {
        private static int Main(string[] args)
        {
            var cmd = args.Length > 0 ? args[0].ToLowerInvariant() : "";
            try
            {
                switch (cmd)
                {
                    case "install":
                    {
                        var i = Array.FindIndex(args, a => a.Equals("--account", StringComparison.OrdinalIgnoreCase));
                        var account = i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
                        Scm.Install(account, Environment.GetEnvironmentVariable("SDP_SETUP_SVCPASS"));
                        return 0;
                    }
                    case "uninstall": Scm.Uninstall(); return 0;
                    case "console":
                    {
                        var s = new DashboardService();
                        Console.CancelKeyPress += (o, e) => { e.Cancel = true; s.End(); Environment.Exit(0); };
                        s.Begin();
                        Console.WriteLine("SDP Dashboard running in this window — logs in " + Paths.LogDir + " — Ctrl+C to stop");
                        Thread.Sleep(Timeout.Infinite);
                        return 0;
                    }
                    case "":
                        ServiceBase.Run(new DashboardService());
                        return 0;
                    default:
                        Console.WriteLine("usage: SdpDashboardService.exe [install [--account DOMAIN\\user] | uninstall | console]");
                        return 2;
                }
            }
            catch (Exception e)
            {
                Console.Error.WriteLine("error: " + e.Message);
                return 1;
            }
        }
    }
}
