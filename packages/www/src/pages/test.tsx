import { styled } from "@macaron-css/solid";
import { theme } from "../ui/theme";


const Testing = styled("div", {
    base: {
        height: "100%",
        width: "100%",
        position: "fixed",
        backgroundColor: theme.color.blue.d600
    }
})

export default function TestComponent() {
    return (
        <Testing />
    )
}