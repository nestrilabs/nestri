import { component$, useSignal } from "@builder.io/qwik";
import Avatar  from "./generate"

export default component$(() => {
    // const size = 40;
    // const titleId = "less"
    // const colors = DEFAULT_COLORS

    // const colorData = generateColors("Kmau", colors);
    // const colorsData = useSignal<ColorData>(generateColors("Kamau", colors))
    const text= useSignal("")
    // const colorData = colorsData.value

    return (
        <div>
            <Avatar text={text.value}/>

            <input
                class="w-30 h-20 bg-gray-300"
                onChange$={(v) => {
                    console.log("ev", v.target?.value)
                    text.value = v.target?.value
                }} />
        </div>
    );
})