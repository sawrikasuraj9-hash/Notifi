package com.yashihalls.pay;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.PorterDuff;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.widget.ImageView;

public final class PayTheme {
    public final boolean isDark;
    public final String paletteId;
    public final String lang;

    public final int bg;
    public final int card;
    public final int cardBorder;
    public final int inputBg;
    public final int inputBorder;
    public final int navBg;
    public final int pillActiveBg;
    public final int accent;
    public final int accentDim;
    public final int accentBtnText;
    public final int textPrimary;
    public final int textSecondary;
    public final int textMuted;
    public final int success;
    public final int successBg;
    public final int warn;
    public final int warnBg;
    public final int danger;

    private PayTheme(boolean isDark, String paletteId, String lang) {
        this.isDark = isDark;
        this.paletteId = paletteId;
        this.lang = lang;

        this.success = isDark ? Color.parseColor("#34D399") : Color.parseColor("#059669");
        this.successBg = isDark ? Color.parseColor("#11291F") : Color.parseColor("#DCFCE7");
        this.warn = isDark ? Color.parseColor("#F59E0B") : Color.parseColor("#D97706");
        this.warnBg = isDark ? Color.parseColor("#2A2110") : Color.parseColor("#FEF3C7");
        this.danger = isDark ? Color.parseColor("#FB7185") : Color.parseColor("#E11D48");

        if ("midnight".equals(paletteId)) {
            if (isDark) {
                bg = Color.parseColor("#080D18");
                card = Color.parseColor("#0F1729");
                cardBorder = Color.parseColor("#1D2B48");
                inputBg = Color.parseColor("#0A101E");
                inputBorder = Color.parseColor("#263759");
                navBg = Color.parseColor("#0C1322");
                pillActiveBg = Color.parseColor("#182B52");
                accent = Color.parseColor("#4B89FF");
                accentDim = Color.parseColor("#182B52");
                accentBtnText = Color.parseColor("#FFFFFF");
                textPrimary = Color.parseColor("#F4F7FC");
                textSecondary = Color.parseColor("#92A1BE");
                textMuted = Color.parseColor("#667694");
            } else {
                bg = Color.parseColor("#F2F6FF");
                card = Color.parseColor("#FFFFFF");
                cardBorder = Color.parseColor("#D6E1F5");
                inputBg = Color.parseColor("#F7F9FE");
                inputBorder = Color.parseColor("#C5D4EE");
                navBg = Color.parseColor("#FFFFFF");
                pillActiveBg = Color.parseColor("#DCE8FF");
                accent = Color.parseColor("#2563EB");
                accentDim = Color.parseColor("#DBEAFE");
                accentBtnText = Color.parseColor("#FFFFFF");
                textPrimary = Color.parseColor("#0F172A");
                textSecondary = Color.parseColor("#475569");
                textMuted = Color.parseColor("#64748B");
            }
        } else if ("amethyst".equals(paletteId)) {
            if (isDark) {
                bg = Color.parseColor("#0F0A18");
                card = Color.parseColor("#181026");
                cardBorder = Color.parseColor("#2B1F42");
                inputBg = Color.parseColor("#110B1D");
                inputBorder = Color.parseColor("#382857");
                navBg = Color.parseColor("#130D1F");
                pillActiveBg = Color.parseColor("#2B1B47");
                accent = Color.parseColor("#A855F7");
                accentDim = Color.parseColor("#2D1A47");
                accentBtnText = Color.parseColor("#FFFFFF");
                textPrimary = Color.parseColor("#F7F3FD");
                textSecondary = Color.parseColor("#A191BD");
                textMuted = Color.parseColor("#71628C");
            } else {
                bg = Color.parseColor("#F8F4FF");
                card = Color.parseColor("#FFFFFF");
                cardBorder = Color.parseColor("#E6DAF8");
                inputBg = Color.parseColor("#FAF8FF");
                inputBorder = Color.parseColor("#D8C6F4");
                navBg = Color.parseColor("#FFFFFF");
                pillActiveBg = Color.parseColor("#EDE0FF");
                accent = Color.parseColor("#7E22CE");
                accentDim = Color.parseColor("#F3E8FF");
                accentBtnText = Color.parseColor("#FFFFFF");
                textPrimary = Color.parseColor("#1B0F2E");
                textSecondary = Color.parseColor("#574673");
                textMuted = Color.parseColor("#7B6B94");
            }
        } else {
            // Obsidian · Gold (Matches Screenshots 1, 2, 3)
            if (isDark) {
                bg = Color.parseColor("#0E0C08");
                card = Color.parseColor("#16130D");
                cardBorder = Color.parseColor("#292317");
                inputBg = Color.parseColor("#100E09");
                inputBorder = Color.parseColor("#312A1C");
                navBg = Color.parseColor("#13100A");
                pillActiveBg = Color.parseColor("#2E2511");
                accent = Color.parseColor("#E2B93B");
                accentDim = Color.parseColor("#332912");
                accentBtnText = Color.parseColor("#141007");
                textPrimary = Color.parseColor("#F7F4EC");
                textSecondary = Color.parseColor("#9E9686");
                textMuted = Color.parseColor("#70695C");
            } else {
                bg = Color.parseColor("#FAF6EC");
                card = Color.parseColor("#FFFFFF");
                cardBorder = Color.parseColor("#E6DEC8");
                inputBg = Color.parseColor("#FCF9F2");
                inputBorder = Color.parseColor("#D8CCB0");
                navBg = Color.parseColor("#FFFFFF");
                pillActiveBg = Color.parseColor("#F7ECCB");
                accent = Color.parseColor("#C28E11");
                accentDim = Color.parseColor("#FEF3C7");
                accentBtnText = Color.parseColor("#FFFFFF");
                textPrimary = Color.parseColor("#1A150B");
                textSecondary = Color.parseColor("#5E5440");
                textMuted = Color.parseColor("#857A64");
            }
        }
    }

    public static PayTheme resolve(Context ctx) {
        String mode = PayConfigStore.getTheme(ctx);
        boolean dark = true;
        if ("light".equals(mode)) {
            dark = false;
        } else if ("auto".equals(mode)) {
            int uiMode = ctx.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            dark = (uiMode != Configuration.UI_MODE_NIGHT_NO);
        }
        return new PayTheme(dark, PayConfigStore.getPalette(ctx), PayConfigStore.getLanguage(ctx));
    }

    public int dp(Context ctx, int val) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, val, ctx.getResources().getDisplayMetrics()));
    }

    public GradientDrawable rounded(Context ctx, int fill, int stroke, int radiusDp) {
        GradientDrawable gd = new GradientDrawable();
        gd.setColor(fill);
        if (stroke != Color.TRANSPARENT) {
            gd.setStroke(dp(ctx, 1), stroke);
        }
        gd.setCornerRadius(dp(ctx, radiusDp));
        return gd;
    }

    public GradientDrawable circle(int fill) {
        GradientDrawable gd = new GradientDrawable();
        gd.setShape(GradientDrawable.OVAL);
        gd.setColor(fill);
        return gd;
    }

    public ImageView icon(Context ctx, int resId, int sizeDp, int tintColor) {
        ImageView iv = new ImageView(ctx);
        Drawable d = ctx.getDrawable(resId);
        if (d != null) {
            Drawable copy = d.mutate();
            copy.setColorFilter(tintColor, PorterDuff.Mode.SRC_IN);
            iv.setImageDrawable(copy);
        }
        int px = dp(ctx, sizeDp);
        iv.setLayoutParams(new android.widget.LinearLayout.LayoutParams(px, px));
        return iv;
    }

    public String t(String en, String si, String ar) {
        if ("si".equals(lang)) return si;
        if ("ar".equals(lang)) return ar;
        return en;
    }
}
