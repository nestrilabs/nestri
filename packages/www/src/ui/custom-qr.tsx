import QRCodeUtil from 'qrcode';
import { createMemo, type JSXElement } from "solid-js"

const generateMatrix = (
    value: string,
    errorCorrectionLevel: QRCodeUtil.QRCodeErrorCorrectionLevel
) => {
    const arr = Array.prototype.slice.call(
        QRCodeUtil.create(value, { errorCorrectionLevel }).modules.data,
        0
    );
    const sqrt = Math.sqrt(arr.length);
    return arr.reduce(
        (rows, key, index) =>
            (index % sqrt === 0
                ? rows.push([key])
                : rows[rows.length - 1].push(key)) && rows,
        []
    );
};

type Props = {
    ecl?: QRCodeUtil.QRCodeErrorCorrectionLevel;
    size?: number;
    uri: string;
    clearArea?: boolean;
    image?: HTMLImageElement;
    imageBackground?: string;
};

/**
 * Renders an SVG element displaying a QR code generated from a URI.
 *
 * This component creates a QR code matrix based on the provided URI and error correction level, then renders
 * the QR code using SVG elements. It highlights finder patterns and conditionally renders QR code dots,
 * while optionally embedding a logo in the center with a specified background and an adjustable clear area.
 *
 * @param ecl - The error correction level for the QR code (defaults to 'M').
 * @param size - The overall size (in pixels) of the QR code, including margins (defaults to 200).
 * @param uri - The URI to encode into the QR code.
 * @param clearArea - When true, reserves extra space in the QR code for an embedded logo.
 * @param image - An optional JSX element to render as a central logo within the QR code.
 * @param imageBackground - The background color for the logo area (defaults to 'transparent').
 *
 * @returns An SVG element representing the generated QR code.
 */
export function QRCode({
    ecl = 'M',
    size: sizeProp = 200,
    uri,
    clearArea = false,
    image,
    imageBackground = 'transparent',
}: Props) {
    const logoSize = clearArea ? 38 : 0;
    const size = sizeProp - 10 * 2;

    const dots = createMemo(() => {
        const dots: JSXElement[] = [];
        const matrix = generateMatrix(uri, ecl);
        const cellSize = size / matrix.length;
        let qrList = [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
        ];

        qrList.forEach(({ x, y }) => {
            const x1 = (matrix.length - 7) * cellSize * x;
            const y1 = (matrix.length - 7) * cellSize * y;
            for (let i = 0; i < 3; i++) {
                dots.push(
                    <rect
                        id={`${i}-${x}-${y}`}
                        fill={
                            i % 2 !== 0
                                ? 'var(--nestri-qr-background, var(--nestri-body-background))'
                                : 'var(--nestri-qr-dot-color)'
                        }
                        rx={(i - 2) * -5 + (i === 0 ? 2 : 3)}
                        ry={(i - 2) * -5 + (i === 0 ? 2 : 3)}
                        width={cellSize * (7 - i * 2)}
                        height={cellSize * (7 - i * 2)}
                        x={x1 + cellSize * i}
                        y={y1 + cellSize * i}
                    />
                );
            }
        });

        if (image) {
            const x1 = (matrix.length - 7) * cellSize * 1;
            const y1 = (matrix.length - 7) * cellSize * 1;
            dots.push(
                <>
                    <rect
                        fill={imageBackground}
                        rx={(0 - 2) * -5 + 2}
                        ry={(0 - 2) * -5 + 2}
                        width={cellSize * (7 - 0 * 2)}
                        height={cellSize * (7 - 0 * 2)}
                        x={x1 + cellSize * 0}
                        y={y1 + cellSize * 0}
                    />
                    <foreignObject
                        width={cellSize * (7 - 0 * 2)}
                        height={cellSize * (7 - 0 * 2)}
                        x={x1 + cellSize * 0}
                        y={y1 + cellSize * 0}
                    >
                        <div style={{ "border-radius": `${(0 - 2) * -5 + 2}px`, overflow: 'hidden' }}>
                            {image}
                        </div>
                    </foreignObject>
                </>
            );
        }

        const clearArenaSize = Math.floor((logoSize + 25) / cellSize);
        const matrixMiddleStart = matrix.length / 2 - clearArenaSize / 2;
        const matrixMiddleEnd = matrix.length / 2 + clearArenaSize / 2 - 1;

        matrix.forEach((row: QRCodeUtil.QRCode[], i: number) => {
            row.forEach((_: any, j: number) => {
                if (matrix[i][j]) {
                    // Do not render dots under position squares
                    if (
                        !(
                            (i < 7 && j < 7) ||
                            (i > matrix.length - 8 && j < 7) ||
                            (i < 7 && j > matrix.length - 8)
                        )
                    ) {
                        if (
                            image ||
                            !(
                                i > matrixMiddleStart &&
                                i < matrixMiddleEnd &&
                                j > matrixMiddleStart &&
                                j < matrixMiddleEnd
                            )
                        ) {
                            dots.push(
                                <circle
                                    id={`circle-${i}-${j}`}
                                    cx={i * cellSize + cellSize / 2}
                                    cy={j * cellSize + cellSize / 2}
                                    fill="var(--nestri-qr-dot-color)"
                                    r={cellSize / 3}
                                />
                            );
                        }
                    }
                }
            });
        });

        return dots;
    }, [ecl, size, uri]);

    return (
        <svg
            height={size}
            width={size}
            viewBox={`0 0 ${size} ${size}`}
            style={{
                width: `${size}px`,
                height: `${size}px`,
            }}
        >
            <rect fill="transparent" height={size} width={size} />
            {dots()}
        </svg>
    );
}