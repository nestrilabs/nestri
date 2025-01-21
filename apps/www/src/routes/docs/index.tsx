import { component$ } from "@builder.io/qwik";
// import { ApiReference } from '@scalar/api-reference'
// import '@scalar/api-reference/style.css'
//FIXME: Fix the dropdowns
export default component$(() => {
    return (
        <div class="w-screen min-h-screen">
            {/* <style dangerouslySetInnerHTML={ scalar_styles } /> */}
            <script type="text/partytown" src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
            <script
                id="api-reference"
                data-configuration={JSON.stringify({
                    defaultOpenAllTags: true,
                    hideDownloadButton: true,
                })}
                data-url="https://api.nestri.io/doc"
                data-proxy-url="https://proxy.scalar.com" />
        </div>
    )
})