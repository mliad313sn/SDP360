using System.Windows;

namespace Sdp.Manager
{
    /// <summary>Red confirmation screen: a destructive action runs only after the exact phrase is typed.</summary>
    public partial class ConfirmWindow : Window
    {
        private readonly string _phrase;
        public ConfirmWindow(string title, string message, string phrase)
        {
            InitializeComponent();
            Title = title; Message.Text = message; PhraseRun.Text = phrase; _phrase = phrase;
            Loaded += (s, e) => Typed.Focus();
        }
        private void OnTyped(object sender, System.Windows.Controls.TextChangedEventArgs e) => Go.IsEnabled = Typed.Text.Trim() == _phrase;
        private void OnGo(object sender, RoutedEventArgs e) { DialogResult = true; }
        private void OnCancel(object sender, RoutedEventArgs e) { DialogResult = false; }
        public string Phrase => Typed.Text.Trim();

        public static bool Ask(Window owner, string title, string message, string phrase)
        {
            var w = new ConfirmWindow(title, message, phrase) { Owner = owner };
            return w.ShowDialog() == true;
        }
    }
}
