import { component$ } from "@builder.io/qwik";
import { useLocation } from "@builder.io/qwik-city";

export default component$(() => {
    const user = useLocation().params.user;

    return (
        <div class="py-20 mx-auto max-w-xl w-full flex items-center">
            {user}
        </div>
    )
})