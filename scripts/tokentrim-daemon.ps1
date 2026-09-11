<#
.SYNOPSIS
  TokenTrim Windows Background Hotkey Daemon (Zero external dependencies).
.DESCRIPTION
  Listens for a global hotkey (default: Ctrl + Alt + T or Ctrl + Alt + L).
  When pressed anywhere in Windows (Cursor, VS Code, Browser, Slack, Notepad):
    1. Simulates Ctrl+C to copy selected text.
    2. Enriches the prompt through TokenTrim (workspace-aware, intent-gated, verified).
    3. Copies the optimized prompt back to the clipboard.
    4. Plays an audible confirmation chime and shows a tray notification.
#>

param(
    [string]$Key = "T",            # Hotkey key (e.g. T, L, P)
    [string]$Modifier = "Ctrl+Alt", # Modifiers: Ctrl, Alt, Shift, Win, Ctrl+Alt, Ctrl+Shift, Alt+Shift
    [string]$NodePath = "node",
    [string]$RepoDir = $PSScriptRoot + "\.."
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Win32 RegisterHotKey & Message Loop
$csharpSource = @'
using System;
using System.Windows.Forms;
using System.Runtime.InteropServices;

public class HotkeyWindow : Form {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    public event Action HotkeyPressed;

    public const int WM_HOTKEY = 0x0312;
    private int _hotkeyId = 9001;

    public bool Register(uint modifiers, uint vk) {
        return RegisterHotKey(this.Handle, _hotkeyId, modifiers, vk);
    }

    public void Unregister() {
        UnregisterHotKey(this.Handle, _hotkeyId);
    }

    protected override void WndProc(ref Message m) {
        if (m.Msg == WM_HOTKEY) {
            if (HotkeyPressed != null) {
                HotkeyPressed();
            }
        }
        base.WndProc(ref m);
    }
}
'@

Add-Type -ReferencedAssemblies "System.Windows.Forms" -TypeDefinition $csharpSource

# Modifier constants
$MOD_ALT = 0x0001
$MOD_CONTROL = 0x0002
$MOD_SHIFT = 0x0004
$MOD_WIN = 0x0008

$modVal = 0
if ($Modifier -match "alt")   { $modVal = $modVal -bor $MOD_ALT }
if ($Modifier -match "ctrl")  { $modVal = $modVal -bor $MOD_CONTROL }
if ($Modifier -match "shift") { $modVal = $modVal -bor $MOD_SHIFT }
if ($Modifier -match "win")   { $modVal = $modVal -bor $MOD_WIN }

# Convert Key letter to Virtual Key code
$vkCode = [int][char]($Key.ToUpper())

$window = New-Object HotkeyWindow
$window.ShowInTaskbar = $false
$window.WindowState = [System.Windows.Forms.FormWindowState]::Minimized

# Create NotifyIcon for system tray
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Information
$notifyIcon.Text = "TokenTrim Hotkey Daemon ($Modifier+$Key)"
$notifyIcon.Visible = $true

# Context menu for tray icon
$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$exitItem = $contextMenu.Items.Add("Exit TokenTrim Daemon")
$exitItem.Add_Click({
    $window.Unregister()
    $notifyIcon.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})
$notifyIcon.ContextMenuStrip = $contextMenu

# Hotkey action
$action = {
    try {
        # 1. Simulate Ctrl+C to copy selected text to clipboard
        [System.Windows.Forms.SendKeys]::SendWait("^c")
        Start-Sleep -Milliseconds 75

        # 2. Grab text from clipboard
        $selectedText = [System.Windows.Forms.Clipboard]::GetText()
        if ([string]::IsNullOrWhiteSpace($selectedText)) { return }

        # Don't re-optimize if already optimized
        if ($selectedText.StartsWith("## Goal")) { return }

        Write-Host "TokenTrim: Intercepted text -> '$($selectedText.Substring(0, [Math]::Min(40, $selectedText.Length)))...'"

        # 3. Call TokenTrim engine via Node.js
        $workerScript = Join-Path $RepoDir "demo\watch.js"
        $output = & $NodePath $workerScript $selectedText --quiet 2>&1

        # Read back optimized prompt (watch.js copies to clipboard automatically)
        # If clipboard wasn't updated, update it manually with output
        $clipText = [System.Windows.Forms.Clipboard]::GetText()
        if (-not $clipText.StartsWith("## Goal") -and $output) {
            [System.Windows.Forms.Clipboard]::SetText($output)
        }

        # 4. Confirmation chime + tray notification
        [System.Media.SystemSounds]::Asterisk.Play()
        $notifyIcon.ShowBalloonTip(1500, "TokenTrim", "Prompt optimized! Ready to paste (Ctrl+V).", [System.Windows.Forms.ToolTipIcon]::Info)
    } catch {
        Write-Warning "Error processing hotkey: $_"
    }
}

$window.add_HotkeyPressed($action)

# Register Hotkey
$registered = $window.Register($modVal, $vkCode)
if (-not $registered) {
    Write-Error "Failed to register global hotkey $Modifier+$Key. It may be in use by another application."
    $notifyIcon.Visible = $false
    exit 1
}

Write-Host "================================================="
Write-Host "TokenTrim Global Hotkey Daemon Active!"
Write-Host "  Hotkey:   $Modifier+$Key"
Write-Host "  Workflow: Select text anywhere -> Press $Modifier+$Key -> Paste (Ctrl+V)"
Write-Host "  Tray:     Right-click tray icon to Exit"
Write-Host "================================================="

# Start message pump
[System.Windows.Forms.Application]::Run($window)
