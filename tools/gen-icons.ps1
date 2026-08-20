# Generate PWA icons: gradient background + "yi" (U+8B6F) glyph
# Usage: powershell -ExecutionPolicy Bypass -File tools\gen-icons.ps1
# ASCII-only on purpose: PowerShell 5.1 misreads BOM-less UTF-8 as ANSI.
Add-Type -AssemblyName System.Drawing

$iconDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\icons'))
New-Item -ItemType Directory -Force $iconDir | Out-Null
$glyph = [string][char]0x8B6F  # "translate" character

function New-Icon {
  param([int]$Size, [string]$Name, [double]$GlyphRatio)
  $path = Join-Path $iconDir $Name
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

  $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
  $c1 = [System.Drawing.ColorTranslator]::FromHtml('#0E9F8A')
  $c2 = [System.Drawing.ColorTranslator]::FromHtml('#2563EB')
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 45.0)
  $g.FillRectangle($brush, $rect)

  $fontSize = [float]($Size * $GlyphRatio)
  $font = New-Object System.Drawing.Font('Microsoft JhengHei', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $layout = New-Object System.Drawing.RectangleF(0, 0, $Size, $Size)
  $g.DrawString($glyph, $font, [System.Drawing.Brushes]::White, $layout, $sf)

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $font.Dispose(); $brush.Dispose()
  Write-Host "OK: $Name ($Size x $Size)"
}

New-Icon -Size 512 -Name 'icon-512.png' -GlyphRatio 0.55
New-Icon -Size 192 -Name 'icon-192.png' -GlyphRatio 0.55
New-Icon -Size 512 -Name 'icon-maskable-512.png' -GlyphRatio 0.42
New-Icon -Size 180 -Name 'apple-touch-icon.png' -GlyphRatio 0.55
New-Icon -Size 32  -Name 'favicon-32.png' -GlyphRatio 0.62
Write-Host 'All icons generated.'
