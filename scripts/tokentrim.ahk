; TokenTrim AutoHotkey Script (Zero setup, native Windows).
; Press Ctrl+Alt+T anywhere to optimize highlighted prompt directly onto clipboard.

#NoEnv
#SingleInstance Force
SetWorkingDir %A_ScriptDir%

^!t::
    ; Save existing clipboard content
    ClipSaved := ClipboardAll
    Clipboard := ""
    
    ; Copy selected text
    SendInput ^c
    ClipWait, 1
    if ErrorLevel
    {
        Clipboard := ClipSaved
        return
    }

    rawText := Clipboard
    if (rawText = "" or SubStr(rawText, 1, 7) = "## Goal")
    {
        return
    }

    ; Execute TokenTrim watch in one-shot quiet mode
    nodePath := "node"
    watchScript := A_ScriptDir . "\..\demo\watch.js"
    RunWait, %ComSpec% /c %nodePath% "%watchScript%" "%rawText%" --quiet, , Hide

    ; Notify user with audible chime and tray tip
    SoundPlay, *64
    TrayTip, TokenTrim, Prompt optimized! Press Ctrl+V to paste., 2
return
