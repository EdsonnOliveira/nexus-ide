!macro customCheckAppRunning
  ${IfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    Goto customCheckAppRunning_done
  ${EndIf}

  StrCpy $R1 0

  customCheckAppRunning_check:
    nsExec::Exec `"$SYSDIR\cmd.exe" /C tasklist /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""`
    Pop $R0
    ${if} $R0 != 0
      Goto customCheckAppRunning_done
    ${endIf}

    DetailPrint "$(appClosing)"
    nsExec::Exec `"$SYSDIR\cmd.exe" /C taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T`
    Pop $0
    Sleep 1000

    IntOp $R1 $R1 + 1
    ${if} $R1 > 2
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY customCheckAppRunning_check
      Quit
    ${endIf}

    Goto customCheckAppRunning_check

  customCheckAppRunning_done:
!macroend
