; Custom NSIS texts for the Minecraft Bot Panel installer
!macro customHeader
  BrandingText "Minecraft Bot Panel  |  by ancymon"

  !define MUI_WELCOMEPAGE_TITLE "Welcome to Minecraft Bot Panel"
  !define MUI_WELCOMEPAGE_TEXT "This wizard will install Minecraft Bot Panel (MCBP) on your computer.$\r$\n$\r$\nMineflayer and minecraft-data are automatically kept up to date on launch so new Minecraft versions work out of the box.$\r$\n$\r$\nClick Next to continue."

  !define MUI_FINISHPAGE_TITLE "Minecraft Bot Panel is ready"
  !define MUI_FINISHPAGE_TEXT "Installation finished successfully.$\r$\n$\r$\nLaunch MCBP to connect bots and run built-in or custom scripts."
  !define MUI_FINISHPAGE_LINK "Source code on GitHub"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/ancym0n/Minecraft-Bot-Panel"
  !define MUI_FINISHPAGE_LINK_COLOR "9171f8"

  !define MUI_UNCONFIRMPAGE_TEXT_TOP "Minecraft Bot Panel will be removed from your computer."
!macroend
