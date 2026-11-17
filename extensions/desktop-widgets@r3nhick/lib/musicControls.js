


import Cairo from 'cairo';










export function paintPlayIcon(cr, cx, cy, size, color, opacity) {
    const [r, g, b] = color;
    cr.setSourceRGBA(r, g, b, opacity);


    const h = size * 0.6;
    const w = h * 0.866;

    cr.moveTo(cx - w / 2, cy - h / 2);
    cr.lineTo(cx + w / 2, cy);
    cr.lineTo(cx - w / 2, cy + h / 2);
    cr.closePath();
    cr.fill();
}




export function paintPauseIcon(cr, cx, cy, size, color, opacity) {
    const [r, g, b] = color;
    cr.setSourceRGBA(r, g, b, opacity);

    const h = size * 0.6;
    const w = h * 0.3;
    const gap = w * 0.6;


    cr.rectangle(cx - gap / 2 - w, cy - h / 2, w, h);
    cr.fill();


    cr.rectangle(cx + gap / 2, cy - h / 2, w, h);
    cr.fill();
}




export function paintNextIcon(cr, cx, cy, size, color, opacity) {
    const [r, g, b] = color;
    cr.setSourceRGBA(r, g, b, opacity);

    const h = size * 0.5;
    const w = h * 0.6;
    const gap = w * 0.2;


    cr.moveTo(cx - gap / 2 - w, cy - h / 2);
    cr.lineTo(cx - gap / 2, cy);
    cr.lineTo(cx - gap / 2 - w, cy + h / 2);
    cr.closePath();
    cr.fill();


    cr.moveTo(cx + gap / 2, cy - h / 2);
    cr.lineTo(cx + gap / 2 + w, cy);
    cr.lineTo(cx + gap / 2, cy + h / 2);
    cr.closePath();
    cr.fill();
}




export function paintPreviousIcon(cr, cx, cy, size, color, opacity) {
    const [r, g, b] = color;
    cr.setSourceRGBA(r, g, b, opacity);

    const h = size * 0.5;
    const w = h * 0.6;
    const gap = w * 0.2;


    cr.moveTo(cx + gap / 2 + w, cy - h / 2);
    cr.lineTo(cx + gap / 2, cy);
    cr.lineTo(cx + gap / 2 + w, cy + h / 2);
    cr.closePath();
    cr.fill();


    cr.moveTo(cx - gap / 2, cy - h / 2);
    cr.lineTo(cx - gap / 2 - w, cy);
    cr.lineTo(cx - gap / 2, cy + h / 2);
    cr.closePath();
    cr.fill();
}




export function paintLoopIcon(cr, cx, cy, size, color, opacity) {
    const [r, g, b] = color;
    cr.setSourceRGBA(r, g, b, opacity);

    const r_circle = size * 0.25;
    const lineWidth = size * 0.08;

    cr.setLineWidth(lineWidth);
    cr.arc(cx, cy, r_circle, 0.3 * Math.PI, 1.7 * Math.PI);
    cr.stroke();


    const arrowSize = size * 0.15;
    const angle = 0.3 * Math.PI;
    const ax = cx + r_circle * Math.cos(angle);
    const ay = cy + r_circle * Math.sin(angle);

    cr.moveTo(ax, ay);
    cr.lineTo(ax - arrowSize * Math.cos(angle - 0.5), ay - arrowSize * Math.sin(angle - 0.5));
    cr.lineTo(ax - arrowSize * Math.cos(angle + 0.5), ay - arrowSize * Math.sin(angle + 0.5));
    cr.closePath();
    cr.fill();
}
