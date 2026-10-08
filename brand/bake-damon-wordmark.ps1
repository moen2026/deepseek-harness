<#
  Bakes the white-background "Damon" word art into a tight-cropped alpha mask:
  luminance is inverted into the alpha channel (white -> transparent, ink ->
  opaque) so the result can be tinted with `currentColor` and follow the light
  and dark themes. Prints the cropped size and aspect ratio for the CSS box.
#>
param(
  [string]$Source = 'E:\DSH2026\word\Damon logo3.png',
  [string]$Target = 'E:\DSHqoder\packages\client\ui-sidebar\src\client\assets\damon-wordmark.png',
  # The mask is embedded as a base64 data URI by the sidebar bundle, so it is
  # baked near its on-screen size (17px ink) rather than at source resolution.
  [int]$MaxHeight = 68
)

Add-Type -AssemblyName System.Drawing

$cpp = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class WordmarkBake
{
  public static string Run(string source, string target, int maxHeight)
  {
    using (var src = new Bitmap(source))
    {
      int w = src.Width, h = src.Height;
      var data = src.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      int[] px = new int[w * h];
      Marshal.Copy(data.Scan0, px, 0, px.Length);
      src.UnlockBits(data);

      int minX = w, minY = h, maxX = -1, maxY = -1;
      for (int y = 0; y < h; y++)
      {
        int row = y * w;
        for (int x = 0; x < w; x++)
        {
          int c = px[row + x];
          double lum = 0.299 * ((c >> 16) & 0xFF) + 0.587 * ((c >> 8) & 0xFF) + 0.114 * (c & 0xFF);
          if (lum < 200)
          {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return "no ink found";

      // Keep one pixel of margin so the anti-aliased edge survives the crop.
      minX = Math.Max(0, minX - 1);
      minY = Math.Max(0, minY - 1);
      maxX = Math.Min(w - 1, maxX + 1);
      maxY = Math.Min(h - 1, maxY + 1);
      int cw = maxX - minX + 1, ch = maxY - minY + 1;

      byte[] outData = new byte[cw * ch * 4];
      for (int y = 0; y < ch; y++)
      {
        int srcRow = (minY + y) * w;
        for (int x = 0; x < cw; x++)
        {
          int c = px[srcRow + minX + x];
          double lum = 0.299 * ((c >> 16) & 0xFF) + 0.587 * ((c >> 8) & 0xFF) + 0.114 * (c & 0xFF);
          int a = (int)Math.Round(255 - lum);
          if (a < 0) a = 0;
          else if (a > 255) a = 255;
          int o = (y * cw + x) * 4;
          outData[o] = 0;
          outData[o + 1] = 0;
          outData[o + 2] = 0;
          outData[o + 3] = (byte)a;
        }
      }

      using (var outBmp = new Bitmap(cw, ch, PixelFormat.Format32bppArgb))
      {
        var odata = outBmp.LockBits(new Rectangle(0, 0, cw, ch), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(outData, 0, odata.Scan0, outData.Length);
        outBmp.UnlockBits(odata);
        string dir = System.IO.Path.GetDirectoryName(target);
        if (!System.IO.Directory.Exists(dir)) System.IO.Directory.CreateDirectory(dir);
        if (maxHeight <= 0 || ch <= maxHeight)
        {
          outBmp.Save(target, ImageFormat.Png);
          return cw + "x" + ch + "  aspect=" + ((double)cw / ch).ToString("0.000");
        }

        int nw = (int)Math.Round((double)cw * maxHeight / ch);
        using (var small = new Bitmap(nw, maxHeight, PixelFormat.Format32bppArgb))
        {
          using (var g = Graphics.FromImage(small))
          {
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            g.DrawImage(outBmp, new Rectangle(0, 0, nw, maxHeight));
          }
          small.Save(target, ImageFormat.Png);
        }
        return cw + "x" + ch + " -> " + nw + "x" + maxHeight
          + "  aspect=" + ((double)cw / ch).ToString("0.000");
      }
    }
  }
}
'@

Add-Type -TypeDefinition $cpp -ReferencedAssemblies System.Drawing
[WordmarkBake]::Run($Source, $Target, $MaxHeight)
