import { NavBar } from "@nestri/ui";
import { component$, Slot } from "@builder.io/qwik";

export default component$(() => {
    return (
        <>
            <NavBar />
            <Slot />
        </>
    )
})