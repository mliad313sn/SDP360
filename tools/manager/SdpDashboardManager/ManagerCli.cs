// Thin bridge to tools/sdp-manager.js — the Manager never reimplements an action.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace Sdp.Manager
{
    public sealed class CliResult
    {
        public int ExitCode;
        public string Output = "";
        public string Error = "";
        public bool Ok => ExitCode == 0;
        /// <summary>The last JSON object printed on stdout (the --json commands print exactly one).</summary>
        public Dictionary<string, object> Json
        {
            get
            {
                var line = Output.Split('\n').Select(l => l.Trim()).LastOrDefault(l => l.StartsWith("{"));
                if (line == null) return null;
                try { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(line); } catch { return null; }
            }
        }
    }

    public static class ManagerCli
    {
        /// <summary>&lt;app&gt; — the Manager lives in &lt;app&gt;\manager\.</summary>
        public static string AppDir
        {
            get
            {
                var exeDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
                var parent = Directory.GetParent(exeDir).FullName;
                return File.Exists(Path.Combine(parent, "server.js")) ? parent : exeDir;
            }
        }
        public static string Node
        {
            get
            {
                var bundled = Path.Combine(AppDir, "runtime", "node", "node.exe");
                return File.Exists(bundled) ? bundled : "node.exe";
            }
        }
        public static string Script => Path.Combine(AppDir, "tools", "sdp-manager.js");
        public static string LogDir => Path.Combine(AppDir, "logs");

        public static string Url
        {
            get
            {
                var port = ReadEnvKey("PORT") ?? "3456";
                return "http://localhost:" + port;
            }
        }

        /// <summary>Reads one non-secret key of .env (PORT, SDP_BACKUP_DIR …). Never used for a secret.</summary>
        public static string ReadEnvKey(string key)
        {
            try
            {
                foreach (var raw in File.ReadAllLines(Path.Combine(AppDir, ".env")))
                {
                    var line = raw.Trim();
                    if (line.StartsWith(key + "=")) return line.Substring(key.Length + 1).Trim().Trim('"');
                }
            }
            catch { /* no .env */ }
            return null;
        }

        private static string Quote(string a) => a.IndexOfAny(new[] { ' ', '"', '\t' }) >= 0 ? "\"" + a.Replace("\"", "\\\"") + "\"" : a;

        public static Task<CliResult> Run(params string[] args) => Task.Run(() =>
        {
            var all = new List<string> { Script };
            all.AddRange(args);
            all.Add("--dir"); all.Add(AppDir);
            var psi = new ProcessStartInfo(Node, string.Join(" ", all.Select(Quote)))
            {
                WorkingDirectory = AppDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            var res = new CliResult();
            try
            {
                using (var p = Process.Start(psi))
                {
                    var outTask = p.StandardOutput.ReadToEndAsync();
                    var errTask = p.StandardError.ReadToEndAsync();
                    if (!p.WaitForExit(60 * 60 * 1000)) { try { p.Kill(); } catch { } res.ExitCode = -1; res.Error = "timed out"; return res; }
                    res.Output = outTask.Result; res.Error = errTask.Result; res.ExitCode = p.ExitCode;
                }
            }
            catch (Exception e) { res.ExitCode = -1; res.Error = "could not run Node.js (" + e.Message + ")"; }
            return res;
        });

        public static string S(Dictionary<string, object> o, string key) => o != null && o.TryGetValue(key, out var v) && v != null ? Convert.ToString(v) : null;
        public static Dictionary<string, object> D(Dictionary<string, object> o, string key) => o != null && o.TryGetValue(key, out var v) ? v as Dictionary<string, object> : null;
    }
}
