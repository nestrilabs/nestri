import { styled } from "@macaron-css/solid";
import { theme } from "@nestri/www/ui/theme";

const Root = styled("div", {
    base: {
        top: "0",
        zIndex: 10,
        position: "sticky",
        display: "flex",
        alignItems: "center",
        backdropFilter: "blur(8px)",
        padding: `0 ${theme.space[4]}`,
        justifyContent: "space-between",
        height: theme.headerHeight.root,
        WebkitBackdropFilter: "blur(8px)",
        backgroundColor: theme.color.background.d100,
        borderBottom: `1px solid ${theme.color.gray.d300}`,
    },
});

export function Header() {
    return (
        <Root>
            Header
        </Root>
    )
}