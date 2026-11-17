


// modify it under the terms of the GNU General Public License

// of the License, or (at your option) any later version.




// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License



export function argbToRgba(src) {
    const dest = new Uint8Array(src.length);

    for (let j = 0; j < src.length; j += 4) {
        const srcAlpha = src[j];

        dest[j] = src[j + 1];
        dest[j + 1] = src[j + 2];
        dest[j + 2] = src[j + 3];
        dest[j + 3] = srcAlpha;
    }

    return dest;
}

export function getBestPixmap(pixmapsVariant, preferredSize) {
    if (!pixmapsVariant)
        throw new TypeError('null pixmapsVariant');

    const pixmapsVariantsArray = new Array(pixmapsVariant.n_children());
    if (!pixmapsVariantsArray.length)
        throw TypeError('Empty Icon found');

    for (let i = 0; i < pixmapsVariantsArray.length; ++i)
        pixmapsVariantsArray[i] = pixmapsVariant.get_child_value(i);

    const pixmapsSizedArray = pixmapsVariantsArray.map((pixmapVariant, index) => ({
        width: pixmapVariant.get_child_value(0).unpack(),
        height: pixmapVariant.get_child_value(1).unpack(),
        index,
    }));

    const sortedIconPixmapArray = pixmapsSizedArray.sort(
        ({width: widthA, height: heightA}, {width: widthB, height: heightB}) => {
            const areaA = widthA * heightA;
            const areaB = widthB * heightB;

            return areaA - areaB;
        });


    const qualifiedIconPixmapArray = sortedIconPixmapArray.filter(({width, height}) =>
        width >= preferredSize && height >= preferredSize);

    const {width, height, index} = qualifiedIconPixmapArray.length > 0
        ? qualifiedIconPixmapArray[0] : sortedIconPixmapArray.pop();

    const pixmapVariant = pixmapsVariantsArray[index].get_child_value(2);
    const rowStride = width * 4;

    return {pixmapVariant, width, height, rowStride};
}
