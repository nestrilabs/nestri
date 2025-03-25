const DEFAULT_COLORS = ['#6A5ACD', '#E63525', '#20B2AA', '#E87D58'];

const getModulo = (value: number, divisor: number, useEvenCheck?: number) => {
    const remainder = value % divisor;
    if (useEvenCheck && Math.floor(value / Math.pow(10, useEvenCheck) % 10) % 2 === 0) {
        return -remainder;
    }
    return remainder;
};

const generateColors = (name: string, colors = DEFAULT_COLORS) => {
    const hashCode = name.split('').reduce((acc, char) => {
        acc = ((acc << 5) - acc) + char.charCodeAt(0);
        return acc & acc;
    }, 0);

    const hash = Math.abs(hashCode);
    const numColors = colors.length;

    return Array.from({ length: 3 }, (_, index) => ({
        color: colors[(hash + index) % numColors],
        translateX: getModulo(hash * (index + 1), 4, 1),
        translateY: getModulo(hash * (index + 1), 4, 2),
        scale: 1.2 + getModulo(hash * (index + 1), 2) / 10,
        rotate: getModulo(hash * (index + 1), 360, 1)
    }));
};
type Props = {
    name: string;
    size?: number;
    class?: string;
    colors?: string[]
}

export default function Avatar({ class: className, name, size = 80, colors = DEFAULT_COLORS }: Props) {
    const colorData = generateColors(name, colors);

    const blurValue = Math.max(1, Math.min(7, size / 10));

    return (
        <svg
            viewBox="0 0 80 80"
            fill="none"
            role="img"
            class={className}
            preserveAspectRatio="xMidYMid meet"
            aria-describedby={name}
            width={size}
            height={size}
        >
            <title id={name}>{`Fallback avatar for ${name}`}</title>
            <mask
                id="mask__marble"
                maskUnits="userSpaceOnUse"
                x={0}
                y={0}
                width={80}
                height={80}
            >
                <rect width={80} height={80} rx={160} fill="#FFFFFF" />
            </mask>
            <g mask="url(#mask__marble)">
                <rect width={80} height={80} rx={160} fill={colorData[0].color} />
                <path
                    filter="url(#prefix__filter0_f)"
                    d="M32.414 59.35L50.376 70.5H72.5v-71H33.728L26.5 13.381l19.057 27.08L32.414 59.35z"
                    fill={colorData[1].color}
                    transform={
                        `translate(${colorData[1].translateX} ${colorData[1].translateY})
                        rotate(${colorData[1].rotate} 40 40)
                        scale(${colorData[1].scale})`}
                />
                <path
                    filter="url(#prefix__filter0_f)"
                    style={{ "mix-blend-mode": "overlay" }}
                    d="M22.216 24L0 46.75l14.108 38.129L78 86l-3.081-59.276-22.378 4.005 12.972 20.186-23.35 27.395L22.215 24z"
                    fill={colorData[2].color}
                    transform={
                        `translate(${colorData[2].translateX} ${colorData[2].translateY})
                        rotate(${colorData[2].rotate} 40 40)
                        scale(${colorData[2].scale})`}
                />
            </g>
            <defs>
                <filter
                    id="prefix__filter0_f"
                    filterUnits="userSpaceOnUse"
                    color-interpolation-filters="s-rGB"
                >
                    <feFlood flood-opacity={0} result="BackgroundImageFix" />
                    <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
                    <feGaussianBlur stdDeviation={blurValue} result="effect1_foregroundBlur" />
                </filter>
            </defs>
        </svg>
    )
}