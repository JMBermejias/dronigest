# Generador de iconos PNG para Dronigest PWA
# Usa System.Drawing de .NET para crear iconos de alta calidad

Add-Type -AssemblyName System.Drawing

function Crear-Icono {
    param(
        [int]$Tamano,
        [string]$RutaArchivo
    )
    
    $bitmap = New-Object System.Drawing.Bitmap($Tamano, $Tamano)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    
    $rect = New-Object System.Drawing.Rectangle(0, 0, $Tamano, $Tamano)
    
    # Fondo con gradiente azul
    $point1 = New-Object System.Drawing.Point(0, 0)
    $point2 = New-Object System.Drawing.Point($Tamano, $Tamano)
    $brushGradiente = New-Object System.Drawing.Drawing2D.LinearGradientBrush($point1, $point2, [System.Drawing.Color]::FromArgb(1, 87, 155), [System.Drawing.Color]::FromArgb(2, 136, 209))
    $graphics.FillRectangle($brushGradiente, $rect)
    
    # Circulo blanco exterior
    $m = [int]($Tamano * 0.08)
    $d = $Tamano - ($m * 2)
    $graphics.FillEllipse([System.Drawing.Brushes]::White, $m, $m, $d, $d)
    
    # Circulo azul oscuro interior
    $mi = [int]($Tamano * 0.13)
    $di = $Tamano - ($mi * 2)
    $brushAzul = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(1, 87, 155))
    $graphics.FillEllipse($brushAzul, $mi, $mi, $di, $di)
    
    # Centro
    $cx = $Tamano / 2
    $cy = $Tamano / 2
    $escala = $Tamano / 512.0
    
    # Drone - cuerpo blanco
    $brushDrone = [System.Drawing.Brushes]::White
    $bw = [int](60 * $escala)
    $bh = [int](24 * $escala)
    $graphics.FillRectangle($brushDrone, [int]($cx - $bw/2), [int]($cy - $bh/2), $bw, $bh)
    
    # Drone - centro
    $cr = [int](8 * $escala)
    $brushCentro = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(179, 229, 252))
    $graphics.FillEllipse($brushCentro, [int]($cx - $cr), [int]($cy - $cr), $cr * 2, $cr * 2)
    
    # Drone - brazos y helices
    $penBrazo = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [int](8 * $escala))
    $penBrazo.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $penBrazo.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    
    $armLen = [int](110 * $escala)
    $helR = [int](50 * $escala)
    $brushHel = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(100, 179, 229, 252))
    
    # 4 brazos con helices
    $dx = @(-1, 1, -1, 1)
    $dy = @(-1, -1, 1, 1)
    
    for ($i = 0; $i -lt 4; $i++) {
        $ex = [int]($cx + $dx[$i] * $armLen)
        $ey = [int]($cy + $dy[$i] * $armLen)
        $sx = [int]($cx + $dx[$i] * $bw/2 * 0.8)
        $sy = [int]($cy + $dy[$i] * $bh/2 * 0.8)
        $graphics.DrawLine($penBrazo, $sx, $sy, $ex, $ey)
        $graphics.FillEllipse($brushHel, $ex - $helR, $ey - $helR, $helR * 2, $helR * 2)
    }
    
    # Texto DRONIGEST abajo
    if ($Tamano -ge 192) {
        $fSize = [int](28 * $escala)
        if ($fSize -lt 10) { $fSize = 10 }
        $font = New-Object System.Drawing.Font("Arial", $fSize, [System.Drawing.FontStyle]::Bold)
        $brushTexto = [System.Drawing.Brushes]::White
        $ts = $graphics.MeasureString("D", $font)
        $graphics.DrawString("D", $font, $brushTexto, [int]($cx - $ts.Width/2), [int]($cy + 120 * $escala))
    }
    
    # Guardar PNG
    $bitmap.Save($RutaArchivo, [System.Drawing.Imaging.ImageFormat]::Png)
    
    # Limpiar recursos
    $graphics.Dispose()
    $bitmap.Dispose()
    $brushGradiente.Dispose()
    $brushAzul.Dispose()
    $brushCentro.Dispose()
    $penBrazo.Dispose()
    $brushHel.Dispose()
    
    $size = (Get-Item $RutaArchivo).Length
    Write-Host "  OK: $RutaArchivo (${Tamano}x${Tamano}, ${size} bytes)" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Dronigest - Generador de iconos PNG" -ForegroundColor Cyan
Write-Host ""

$iconsDir = Join-Path $PSScriptRoot "icons"
if (-not (Test-Path $iconsDir)) { New-Item -ItemType Directory -Path $iconsDir -Force | Out-Null }

Crear-Icono -Tamano 192 -RutaArchivo (Join-Path $iconsDir "icon-192.png")
Crear-Icono -Tamano 512 -RutaArchivo (Join-Path $iconsDir "icon-512.png")

Write-Host ""
Write-Host "  Listo - Iconos generados." -ForegroundColor Green
Write-Host ""
pause
