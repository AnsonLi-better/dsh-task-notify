#requires -Version 5.1
<#
  DSH 任务通知 —— Windows 右下角置顶窗

  由 @local/dsh-task-notify 的 Host 半边按事件拉起。一次调用 = 一条通知，
  显示完自己退出；进程之间互不影响，所以 DSH 主窗口最小化、隐藏到托盘、
  甚至 Web 页面被关掉，通知都照常出现。

  用法（Host 侧就是这么调的）：
    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass `
      -File toast.ps1 -PayloadFile <json>

  Payload JSON：
    { state, theme, title, body, primary, secondary, durationMs,
      sound, soundVolume }
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadFile
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

# ─────────────────────────────────────────────── 入参
if (-not (Test-Path -LiteralPath $PayloadFile)) { exit 2 }

$payload = Get-Content -LiteralPath $PayloadFile -Raw -Encoding UTF8 | ConvertFrom-Json

# 规范化 state：去空白、转小写。JSON 里万一带了换行或大小写差异，
# 之前会静默落进 default 分支，表现为"标题对、图标错"。
$state = ([string]$payload.state).Trim().ToLowerInvariant()
if ($state -notin 'done', 'failed', 'approval') { $state = 'done' }

$theme = [string]$payload.theme
if ($theme -ne 'dark') { $theme = 'light' }

$title = [string]$payload.title
$body = [string]$payload.body
$primary = [string]$payload.primary
$secondary = [string]$payload.secondary
$durationMs = 0
if ($null -ne $payload.durationMs) { $durationMs = [int]$payload.durationMs }

$sound = $payload.sound -ne $false
$soundVolume = 0.35
if ($null -ne $payload.soundVolume) {
  $volumePercent = [int]$payload.soundVolume
  if ($volumePercent -lt 0) { $volumePercent = 0 }
  if ($volumePercent -gt 100) { $volumePercent = 100 }
  $soundVolume = $volumePercent / 100.0
}

# 点击主按钮要打开的地址。
#   navigateUrl —— 带一次性 token 的回跳接口；Host 收到后把目标 session
#                  交给页面里的 Client 半边执行真正的跳转（首选）
#   openUrl     —— 只打开 DSH 主页的兜底地址
$navigateUrl = [string]$payload.navigateUrl
$openUrl = [string]$payload.openUrl

if ([string]::IsNullOrWhiteSpace($title)) { $title = '任务已完成' }
if ([string]::IsNullOrWhiteSpace($primary)) { $primary = '打开会话' }
if ([string]::IsNullOrWhiteSpace($secondary)) { $secondary = '忽略' }

# ─────────────────────────────────────────────── 配色
if ($theme -eq 'dark') {
  $surface = '#2B2B2B'; $ink = '#F1F2F4'; $ink2 = '#A9AEB6'
  $line = '#33FFFFFF'; $btn = '#14FFFFFF'; $btnStrong = '#24FFFFFF'
  $markInk = '#F1F2F4'
} else {
  $surface = '#F9F9F9'; $ink = '#1B1B1C'; $ink2 = '#61666B'
  $line = '#170F1115'; $btn = '#0D0F1115'; $btnStrong = '#1A0F1115'
  $markInk = '#0F1115'
}

# 状态 → 颜色 / 图形。用一个 hashtable 查表，避免两个 switch 之间的变量耦合：
# 之前 $glyph 由第一个 switch 赋值、再喂给第二个 switch，一旦 $state 的取值
# 和预期不一致（比如 payload 里带了多余空白或大小写），两个 switch 会各走各的
# 默认分支，出现"标题是完成、图标却是感叹号"这种错位。
$STATES = @{
  'done' = @{
    main = '#22C55E'; soft = '#2622C55E'
    iconData = 'M5.2,12.4 L9.7,16.9 L18.8,7.6'
    dot = 'Collapsed'
  }
  'failed' = @{
    main = '#EC1313'; soft = '#24EC1313'
    iconData = 'M12,6.6 L12,13.8'
    dot = 'Visible'
  }
  'approval' = @{
    main = '#F59E0B'; soft = '#2EF59E0B'
    iconData = 'M8.9,9.1 A3.1,3.1 0 1 1 13.1,12 C12.25,12.35 12,13 12,13.9'
    dot = 'Visible'
  }
}

$look = $STATES[$state]
if ($null -eq $look) { $look = $STATES['done'] }

$accentMain = $look.main
$accentSoft = $look.soft
$iconData = $look.iconData
$dotVisibility = $look.dot
# 问号的点比感叹号略高，因为它的曲线末端在 13.9
if ($state -eq 'approval') { $dotX = 10.65; $dotY = 16.35 } else { $dotX = 10.65; $dotY = 16.25 }

# 官方鲸鱼标（取自 @deepseek-ai/dsh-client-ui-primitives 的 FishLogo），
# viewBox 23.16 × 17.04，等比缩放后高 12px。
$whalePath = 'M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z'

# 文案进 XAML 前必须转义
$titleEsc = [System.Security.SecurityElement]::Escape($title)
$bodyEsc = [System.Security.SecurityElement]::Escape($body)
$primaryEsc = [System.Security.SecurityElement]::Escape($primary)
$secondaryEsc = [System.Security.SecurityElement]::Escape($secondary)

$XAML = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        ShowInTaskbar="False" Topmost="True" ResizeMode="NoResize"
        SizeToContent="WidthAndHeight" UseLayoutRounding="True"
        TextOptions.TextFormattingMode="Ideal">

  <Window.Resources>
    <FontFamily x:Key="UiFont">Segoe UI Variable Text, Microsoft YaHei UI, Segoe UI</FontFamily>
  </Window.Resources>

  <!-- 非对称外边距：左/上留 28px 给投影，右/下只留 14/12px。
       窗口贴住工作区右下角后，卡片正好离屏幕边 14px / 12px。 -->
  <Border x:Name="Card" Width="364" CornerRadius="8"
          Background="$surface"
          BorderBrush="$line" BorderThickness="1"
          Margin="28,28,14,12">
    <Border.Effect>
      <DropShadowEffect BlurRadius="28" ShadowDepth="0" Opacity="0.30" Color="#0F1115"/>
    </Border.Effect>

    <StackPanel Margin="14,12,14,12">

      <!-- 应用标识行：官方鲸鱼标 + 产品名 -->
      <Grid Margin="0,0,0,10">
        <StackPanel Orientation="Horizontal" HorizontalAlignment="Left" VerticalAlignment="Center">
          <Viewbox Width="17" Height="12.5" HorizontalAlignment="Center" VerticalAlignment="Center">
            <Canvas Width="23.16" Height="17.04">
              <Path Data="$whalePath" Fill="$markInk"/>
            </Canvas>
          </Viewbox>
          <TextBlock Text="DeepSeek Harness" Margin="8,0,0,0" VerticalAlignment="Center"
                     Foreground="$ink2" FontFamily="{StaticResource UiFont}" FontSize="11"/>
        </StackPanel>
        <TextBlock Text="&#xE711;" HorizontalAlignment="Right" VerticalAlignment="Center"
                   FontFamily="Segoe Fluent Icons, Segoe MDL2 Assets" FontSize="9"
                   Foreground="$ink2" Opacity="0.7"/>
      </Grid>

      <Grid>
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="*"/>
        </Grid.ColumnDefinitions>

        <Border Width="34" Height="34" CornerRadius="17" Background="$accentSoft"
                VerticalAlignment="Top">
          <Viewbox Width="18" Height="18" HorizontalAlignment="Center" VerticalAlignment="Center">
            <Canvas Width="24" Height="24">
              <Path Data="$iconData" Stroke="$accentMain" StrokeThickness="2.6"
                    StrokeStartLineCap="Round" StrokeEndLineCap="Round" StrokeLineJoin="Round"/>
              <Ellipse Width="2.7" Height="2.7" Fill="$accentMain"
                       Canvas.Left="$dotX" Canvas.Top="$dotY"
                       Visibility="$dotVisibility"/>
            </Canvas>
          </Viewbox>
        </Border>

        <StackPanel Grid.Column="1" Margin="11,0,0,0">
          <TextBlock x:Name="TitleText" Text="$titleEsc" TextWrapping="Wrap"
                     Foreground="$ink" FontFamily="{StaticResource UiFont}"
                     FontSize="15" FontWeight="SemiBold" LineHeight="20" LineStackingStrategy="BlockLineHeight"/>
          <TextBlock x:Name="BodyText" Text="$bodyEsc" TextWrapping="Wrap" Margin="0,4,0,0"
                     Foreground="$ink2" FontFamily="{StaticResource UiFont}"
                     FontSize="13" LineHeight="19" LineStackingStrategy="BlockLineHeight"/>
        </StackPanel>
      </Grid>

      <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,11,0,0">
        <Border x:Name="SecondaryButton" CornerRadius="5" Background="$btn" Padding="13,6">
          <TextBlock Text="$secondaryEsc" Foreground="$ink"
                     FontFamily="{StaticResource UiFont}" FontSize="12"/>
        </Border>
        <Border x:Name="PrimaryButton" CornerRadius="5" Background="$btnStrong"
                Padding="13,6" Margin="6,0,0,0">
          <TextBlock Text="$primaryEsc" Foreground="$ink"
                     FontFamily="{StaticResource UiFont}" FontSize="12" FontWeight="SemiBold"/>
        </Border>
      </StackPanel>

    </StackPanel>
  </Border>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader ([xml]$XAML)
$window = [Windows.Markup.XamlReader]::Load($reader)

# 入场：淡入 + 上移 12px。
# 位移加在内容 Border 上，不加在 Window 上——Window 不接受 RenderTransform。
$card = $window.FindName('Card')
$transform = New-Object System.Windows.Media.TranslateTransform(0, 12)
$card.RenderTransform = $transform
$window.Opacity = 0

$window.WindowStartupLocation = 'Manual'
$window.Left = 0
$window.Top = 0

$script:closing = $false

function Close-Toast {
  if ($script:closing) { return }
  $script:closing = $true

  $fade = New-Object System.Windows.Media.Animation.DoubleAnimation(1, 0, [TimeSpan]::FromMilliseconds(160))
  $fade.Add_Completed({
    $window.Close()
  })
  $window.BeginAnimation([System.Windows.Window]::OpacityProperty, $fade)
}

$window.Add_ContentRendered({
  $window.UpdateLayout()

  # 定位：主屏工作区右下角。
  #
  # 坑：SystemParameters.WorkArea 在 125%/150% 缩放下返回设备像素，而
  # Window.Left/Top 和 ActualWidth/Height 用 DIP。统一用 Screen.WorkingArea
  # （设备像素）除以 DPI 缩放换算成 DIP，否则窗口会跑到屏幕外。
  Add-Type -AssemblyName System.Windows.Forms
  $workPx = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea

  $source = [System.Windows.PresentationSource]::FromVisual($window)
  $scaleX = 1.0
  $scaleY = 1.0
  if ($null -ne $source -and $null -ne $source.CompositionTarget) {
    $matrix = $source.CompositionTarget.TransformToDevice
    $scaleX = $matrix.M11
    $scaleY = $matrix.M22
  }

  $workRightDip = $workPx.Right / $scaleX
  $workBottomDip = $workPx.Bottom / $scaleY

  $window.Left = $workRightDip - $window.ActualWidth
  $window.Top = $workBottomDip - $window.ActualHeight

  $ease = New-Object System.Windows.Media.Animation.CubicEase
  $ease.EasingMode = [System.Windows.Media.Animation.EasingMode]::EaseOut

  $fadeIn = New-Object System.Windows.Media.Animation.DoubleAnimation(0, 1, [TimeSpan]::FromMilliseconds(220))
  $fadeIn.EasingFunction = $ease
  $window.BeginAnimation([System.Windows.Window]::OpacityProperty, $fadeIn)

  $slideIn = New-Object System.Windows.Media.Animation.DoubleAnimation(12, 0, [TimeSpan]::FromMilliseconds(220))
  $slideIn.EasingFunction = $ease
  $transform.BeginAnimation([System.Windows.Media.TranslateTransform]::YProperty, $slideIn)

  # 音效：用系统通知音，音量走 MediaPlayer。
  #
  # 关键：MediaPlayer 必须等 MediaOpened 之后才能 Play()。直接在 Open() 后
  # 立刻 Play()，音频会话还没建立，播放会被静默丢弃——这是之前"一直没声音"
  # 的真正原因。这里用 Dispatcher 轮询等 MediaOpened（通常 300–1200ms），
  # 超时就直接放弃，绝不阻塞通知显示。
  # 待审批用更轻的提示音，避免长任务被打断太多次。
  if ($sound) {
    $wav = 'C:\Windows\Media\Windows Notify.wav'
    if ($state -eq 'approval') { $wav = 'C:\Windows\Media\Windows Notify Messaging.wav' }
    if (-not (Test-Path -LiteralPath $wav)) { $wav = 'C:\Windows\Media\notify.wav' }
    if (Test-Path -LiteralPath $wav) {
      try {
        $script:mediaOpened = $false
        $script:player = New-Object System.Windows.Media.MediaPlayer
        $script:player.Add_MediaOpened({ $script:mediaOpened = $true })
        $script:player.Open([Uri]::new($wav))

        $script:player.Volume = $soundVolume
        $waitStarted = [Diagnostics.Stopwatch]::StartNew()
        while (-not $script:mediaOpened -and $waitStarted.ElapsedMilliseconds -lt 1500) {
          [System.Windows.Threading.Dispatcher]::CurrentDispatcher.Invoke(
            [Action]{}, [System.Windows.Threading.DispatcherPriority]::Background)
          Start-Sleep -Milliseconds 30
        }
        if ($script:mediaOpened) { $script:player.Play() }
      } catch {
        # 音频设备不可用（远程桌面、静音会话）时静默降级，不影响通知本身。
      }
    }
  }
})

# 悬停暂停自动关闭
$window.Add_MouseEnter({
  if ($null -ne $script:timer) { $script:timer.Stop() }
})
$window.Add_MouseLeave({
  if ($null -ne $script:timer -and $durationMs -gt 0) { $script:timer.Start() }
})

$window.Add_MouseLeftButtonUp({ Close-Toast })
$window.Add_KeyDown({ if ($_.Key -eq 'Escape') { Close-Toast } })

# 主按钮：把 DSH 叫到前台。
#
# 会话选择由 Host/SSE/Client 完成；窗口激活由通知进程在用户点击时直接完成。
# 协议只用于没有可激活窗口时的启动兜底，不能把 Start-Process 成功当作前台成功。
$primaryButton = $window.FindName('PrimaryButton')
$secondaryButton = $window.FindName('SecondaryButton')

# Resolve the existing desktop window rather than assuming a protocol launch focused it.
Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class DshToastWindow {
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int command);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindow callback, IntPtr param);
  delegate bool EnumWindow(IntPtr h, IntPtr param);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder name, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder name, int max);
  static IntPtr FindMainWindow(Process p) {
    IntPtr found = p.MainWindowHandle;
    if (found != IntPtr.Zero) return found;
    EnumWindows(delegate(IntPtr h, IntPtr unused) {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (pid != p.Id) return true;
      var name = new System.Text.StringBuilder(256);
      GetClassName(h, name, name.Capacity);
      if (name.ToString() != "Chrome_WidgetWin_1") return true;
      GetWindowText(h, name, name.Capacity);
      if (!name.ToString().Contains("DeepSeek Harness")) return true;
      found = h;
      return false;
    }, IntPtr.Zero);
    return found;
  }
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  public static bool FocusExisting() {
    foreach (Process p in Process.GetProcessesByName("DeepSeek Harness")) {
      using (p) {
        IntPtr h = FindMainWindow(p);
        if (h == IntPtr.Zero) continue;
        // ShowWindow can apply this hidden PowerShell process's STARTUPINFO
        // and hide the target. Async avoids that startup show-state override.
        if (IsIconic(h) || !IsWindowVisible(h)) {
          ShowWindowAsync(h, 9);
          for (int i = 0; i < 20 && (IsIconic(h) || !IsWindowVisible(h)); i++)
            System.Threading.Thread.Sleep(10);
        }
        BringWindowToTop(h);
        SetForegroundWindow(h);
        if (IsWindowVisible(h) && !IsIconic(h) && GetForegroundWindow() == h) return true;
      }
    }
    return false;
  }
}
"@

$primaryButton.Add_MouseEnter({ $this.Cursor = [System.Windows.Input.Cursors]::Hand })
$secondaryButton.Add_MouseEnter({ $this.Cursor = [System.Windows.Input.Cursors]::Hand })

$primaryButton.Add_MouseLeftButtonUp({
  # Do this synchronously during the user's click, before waiting on HTTP.
  $focused = [DshToastWindow]::FocusExisting()
  $queued = $false
  if (-not [string]::IsNullOrWhiteSpace($navigateUrl)) {
    $client = $null
    try {
      Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
      $client = New-Object System.Net.Http.HttpClient
      $client.Timeout = [TimeSpan]::FromSeconds(3)
      $response = $client.GetAsync($navigateUrl).GetAwaiter().GetResult()
      $queued = $response.IsSuccessStatusCode
      $response.Dispose()
    } catch { $queued = $false }
    finally { if ($null -ne $client) { $client.Dispose() } }
  }

  if (-not $focused) {
    # The Host runs Electron as Node. Its children must not launch the GUI in Node mode.
    $nodeMode = [Environment]::GetEnvironmentVariable('ELECTRON_RUN_AS_NODE', 'Process')
    try {
      [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $null, 'Process')
      Start-Process -FilePath 'dsh://open' -ErrorAction Stop | Out-Null
    } catch {
      if (-not [string]::IsNullOrWhiteSpace($openUrl)) {
        try { Start-Process -FilePath $openUrl -ErrorAction Stop | Out-Null } catch { }
      }
    } finally {
      [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', $nodeMode, 'Process')
    }
  }
  Close-Toast
})

$secondaryButton.Add_MouseLeftButtonUp({ Close-Toast })

if ($durationMs -gt 0) {
  $script:timer = New-Object System.Windows.Threading.DispatcherTimer
  $script:timer.Interval = [TimeSpan]::FromMilliseconds($durationMs)
  $script:timer.Add_Tick({
    $script:timer.Stop()
    Close-Toast
  })
  $script:timer.Start()
}

[void]$window.ShowDialog()
