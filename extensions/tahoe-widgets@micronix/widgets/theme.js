// Tahoe widget theming: glass / dark / light, per-widget surfaces.
// Container gets paintBox(), content inherits paintInk(). Cairo widgets
// use cairoInk(). Weather is blue in light mode, stocks always near-black
// (like macOS Tahoe).

function glassCard() {
    return 'background-color: rgba(64,60,58,0.55);' +
        'border: 1px solid rgba(255,255,255,0.22);' +
        'border-radius: 26px;';
}

function darkCard() {
    return 'background-color: rgba(28,28,32,0.90);' +
        'border: 1px solid rgba(255,255,255,0.10);' +
        'border-radius: 26px;';
}

function lightCard() {
    return 'background-color: rgba(255,255,255,0.94);' +
        'border: 1px solid rgba(0,0,0,0.06);' +
        'border-radius: 26px;';
}

export function paintBox(theme, kind) {
    if (kind === 'stocks')
        return 'background-color: rgba(12,12,14,0.94);' +
            'border: 1px solid rgba(255,255,255,0.12);' +
            'border-radius: 26px;';
    if (kind === 'weather') {
        if (theme === 'light')
            return 'background-gradient-direction: vertical;' +
                'background-gradient-start: rgba(58,123,213,0.96);' +
                'background-gradient-end: rgba(38,80,160,0.96);' +
                'border: 1px solid rgba(255,255,255,0.25);' +
                'border-radius: 26px;';
        if (theme === 'dark')
            return 'background-gradient-direction: vertical;' +
                'background-gradient-start: rgba(36,40,58,0.94);' +
                'background-gradient-end: rgba(20,22,34,0.94);' +
                'border: 1px solid rgba(255,255,255,0.12);' +
                'border-radius: 26px;';
        return glassCard();
    }
    if (theme === 'dark')
        return darkCard();
    if (theme === 'light')
        return lightCard();
    return glassCard();
}

// true = dark ink (light card), false = white ink
export function usesDarkInk(theme, kind) {
    if (kind === 'stocks')
        return false;
    if (kind === 'weather' && theme === 'light')
        return false;
    return theme === 'light';
}

export function paintInk(theme, kind, pad) {
    const ink = usesDarkInk(theme, kind) ? 'rgba(29,29,31,0.92)' : '#f5f5f7';
    return `color: ${ink};` + (pad ? ' padding: 16px;' : '');
}

// [r,g,b] triple for Cairo drawing.
export function cairoInk(theme, kind) {
    return usesDarkInk(theme, kind) ? [0.13, 0.13, 0.15] : [0.96, 0.96, 0.98];
}

export function cairoSub(theme, kind) {
    return usesDarkInk(theme, kind) ? [0.4, 0.4, 0.42] : [0.75, 0.75, 0.78];
}
