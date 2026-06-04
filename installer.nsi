; SeverFoods Offline — NSIS Installer
; Автор: Пальченков Евгений Иванович · ООО «Север»

Unicode true

!define APP_NAME     "SeverFoods"
!define APP_VERSION  "1.0.0"
!define APP_EXE      "SeverFoods.exe"
!define APP_GUID     "{0E402777-487E-58D5-817C-42180FAB4AE7}"
!define INSTALL_DIR  "$LOCALAPPDATA\SeverFoods"

Name "${APP_NAME} ${APP_VERSION}"
OutFile "dist\SeverFoods-Setup-${APP_VERSION}.exe"
InstallDir "${INSTALL_DIR}"
InstallDirRegKey HKCU "Software\${APP_NAME}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

; Modern UI
!include "MUI2.nsh"

!define MUI_ICON     "public\assets\img\icon.ico"
!define MUI_UNICON   "public\assets\img\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE   "Установка ${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT    "Система учёта питания.$\n$\nАвтор: Пальченков Евгений Иванович$\nООО «Север»$\n$\nНажмите «Далее» для продолжения."
!define MUI_FINISHPAGE_RUN      "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить ${APP_NAME}"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "Russian"

; ── Install ──────────────────────────────────────────────────
Section "Основные файлы" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"

  ; Copy all files from win-unpacked
  File /r "dist\win-unpacked\*.*"

  ; Write uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Registry — Add/Remove Programs
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "DisplayName"          "${APP_NAME} ${APP_VERSION}"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "UninstallString"      '"$INSTDIR\Uninstall.exe"'
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "InstallLocation"      "$INSTDIR"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "DisplayIcon"          "$INSTDIR\${APP_EXE}"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "Publisher"            "OOO Sever"
  WriteRegStr   HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "DisplayVersion"       "${APP_VERSION}"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "NoModify"             1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "NoRepair"             1
  WriteRegStr   HKCU "Software\${APP_NAME}" "InstallDir" "$INSTDIR"

  ; Shortcuts
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut  "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}"
  CreateShortcut  "$SMPROGRAMS\${APP_NAME}\Удалить ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut  "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}"
SectionEnd

; ── Uninstall ────────────────────────────────────────────────
Section "Uninstall"
  ; Stop the app if running
  ExecWait 'taskkill /F /IM "${APP_EXE}"' $0

  ; Remove files
  RMDir /r "$INSTDIR"

  ; Remove shortcuts
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"

  ; Remove registry
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}"
  DeleteRegKey HKCU "Software\${APP_NAME}"
SectionEnd
