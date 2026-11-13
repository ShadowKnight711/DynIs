; DynIs installer hooks.
; The app registers itself as the "DynIs Downloads" native messaging host for
; Brave, Chrome, Edge and Firefox (per user) when it starts. Uninstalling removes it.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.kevin.dynis"
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.kevin.dynis"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.kevin.dynis"
  DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\com.kevin.dynis"
  Delete "$LOCALAPPDATA\com.kevin.dynis\native-host-firefox.json"
  Delete "$LOCALAPPDATA\com.kevin.dynis\native-host.json"
  Delete "$LOCALAPPDATA\com.kevin.dynis\browser-downloads.json"
!macroend
