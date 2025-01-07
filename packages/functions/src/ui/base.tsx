/** @jsxImportSource hono/jsx */
import { css } from "./css"
import { type PropsWithChildren } from "hono/jsx"
import { getTheme } from "@openauthjs/openauth/ui/theme"

export function Layout(
    props: PropsWithChildren<{
        size?: "small",
        page?: "root" | "password" | "popup"
    }>,
) {
    const theme = getTheme()
    function get(key: "primary" | "background" | "logo", mode: "light" | "dark") {
        if (!theme) return
        if (!theme[key]) return
        if (typeof theme[key] === "string") return theme[key]

        return theme[key][mode] as string | undefined
    }

    const radius = (() => {
        if (theme?.radius === "none") return "0"
        if (theme?.radius === "sm") return "1"
        if (theme?.radius === "md") return "1.25"
        if (theme?.radius === "lg") return "1.5"
        if (theme?.radius === "full") return "1000000000001"
        return "1"
    })()

    const script = "const DEFAULT_COLORS = ['#6A5ACD', '#E63525','#20B2AA', '#E87D58'];" +
        "const getModulo = (value, divisor, useEvenCheck) => {" +
        "const remainder = value % divisor;" +
        "if (useEvenCheck && Math.floor(value / Math.pow(10, useEvenCheck) % 10) % 2 === 0) {" +
        " return -remainder;" +
        " }" +
        " return remainder;" +
        " };" +
        "const generateColors = (name, colors = DEFAULT_COLORS) => {" +
        "const hashCode = name.split('').reduce((acc, char) => {" +
        "acc = ((acc << 5) - acc) + char.charCodeAt(0);" +
        " return acc & acc;" +
        " }, 0);" +
        "const hash = Math.abs(hashCode);" +
        "const numColors = colors.length;" +
        "return Array.from({ length: 3 }, (_, index) => ({" +
        "color: colors[(hash + index) % numColors]," +
        "translateX: getModulo(hash * (index + 1), 4, 1)," +
        "translateY: getModulo(hash * (index + 1), 4, 2)," +
        " scale: 1.2 + getModulo(hash * (index + 1), 2) / 10," +
        " rotate: getModulo(hash * (index + 1), 360, 1)" +
        "}));" +
        "};" +
        "const generateFallbackAvatar = (text = 'wanjohi', size = 80, colors = DEFAULT_COLORS) => {" +
        "  const colorData = generateColors(text, colors);" +
        "  return '<svg viewBox=\"0 0 ' + size + ' ' + size + '\" fill=\"none\" role=\"img\" aria-describedby=\"' + text + '\" width=\"' + size + '\" height=\"' + size + '\">' +" +
        "    '<title id=\"' + text + '\">Fallback avatar for ' + text + '</title>' +" +
        "    '<mask id=\"mask__marble\" maskUnits=\"userSpaceOnUse\" x=\"0\" y=\"0\" width=\"' + size + '\" height=\"' + size + '\">' +" +
        "      '<rect width=\"' + size + '\" height=\"' + size + '\" rx=\"' + (size * 2) + '\" fill=\"#FFFFFF\" />' +" +
        "    '</mask>' +" +
        "    '<g mask=\"url(#mask__marble)\">' +" +
        "      '<rect width=\"' + size + '\" height=\"' + size + '\" fill=\"' + colorData[0].color + '\" />' +" +
        "      '<path filter=\"url(#prefix__filter0_f)\" d=\"M32.414 59.35L50.376 70.5H72.5v-71H33.728L26.5 13.381l19.057 27.08L32.414 59.35z\" fill=\"' + colorData[1].color + '\" transform=\"translate(' + colorData[1].translateX + ' ' + colorData[1].translateY + ') rotate(' + colorData[1].rotate + ' ' + (size / 2) + ' ' + (size / 2) + ') scale(' + colorData[1].scale + ')\" />' +" +
        "      '<path filter=\"url(#prefix__filter0_f)\" style=\"mix-blend-mode: overlay\" d=\"M22.216 24L0 46.75l14.108 38.129L78 86l-3.081-59.276-22.378 4.005 12.972 20.186-23.35 27.395L22.215 24z\" fill=\"' + colorData[2].color + '\" transform=\"translate(' + colorData[2].translateX + ' ' + colorData[2].translateY + ') rotate(' + colorData[2].rotate + ' ' + (size / 2) + ' ' + (size / 2) + ') scale(' + colorData[2].scale + ')\" />' +" +
        "    '</g>' +" +
        "    '<defs>' +" +
        "      '<filter id=\"prefix__filter0_f\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\">' +" +
        "        '<feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\" />' +" +
        "        '<feBlend in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\" />' +" +
        "        '<feGaussianBlur stdDeviation=\"7\" result=\"effect1_foregroundBlur\" />' +" +
        "      '</filter>' +" +
        "    '</defs>' +" +
        "  '</svg>';" +
        "};" +
        "const input = document.getElementById('username');" +
        "const avatarSpan = document.getElementById('username-icon');" +
        "input.addEventListener('input', (e) => {" +
        "  avatarSpan.innerHTML = generateFallbackAvatar(e.target.value);" +
        "});";

    const authWindowScript = `
        const openAuthWindow = async (provider) => {
          const POLL_INTERVAL = 300;
          const BASE_URL = window.location.origin;
          
          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
            navigator.userAgent
          );
        
          const createDesktopWindow = (authUrl) => {
            const config = {
              width: 700,
              height: 700,
              features: "toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=no,resizable=no,copyhistory=no"
            };
        
            const top = window.top.outerHeight / 2 + window.top.screenY - (config.height / 2);
            const left = window.top.outerWidth / 2 + window.top.screenX - (config.width / 2);
        
            return window.open(
              authUrl,
              'Auth Popup',
              \`width=\${config.width},height=\${config.height},left=\${left},top=\${top},\${config.features}\`
            );
          };
        
          const monitorAuthWindow = (targetWindow) => {
            return new Promise((resolve, reject) => {
              const handleAuthSuccess = (event) => {
                if (event.origin !== BASE_URL) return;
                
                try {
                  const data = JSON.parse(event.data);
                  if (data.type === 'auth_success') {
                    cleanup();
                    window.location.href = window.location.origin + "/" + provider + "/callback" + data.searchParams;
                    resolve();
                  }
                } catch (e) {
                  // Ignore invalid JSON messages
                }
              };
        
            window.addEventListener('message', handleAuthSuccess);
        
              const timer = setInterval(() => {
                if (targetWindow.closed) {
                  cleanup();
                  reject(new Error('Authentication window was closed'));
                } 
              }, POLL_INTERVAL);
        
              function cleanup() {
                clearInterval(timer);
                window.removeEventListener('message', handleAuthSuccess);
                if (!targetWindow.closed) {
                    targetWindow.location.href = 'about:blank'
                    targetWindow.close();
                }
                window.focus();
              }
            });
          };
        
          const authUrl = \`\${BASE_URL}/\${provider}/authorize\`;
          const newWindow = isMobile ? window.open(authUrl, '_blank') : createDesktopWindow(authUrl);
          
          if (!newWindow) {
            throw new Error('Failed to open authentication window');
          }
        
          return monitorAuthWindow(newWindow);
        };


        const buttons = document.querySelectorAll('button[id^="button-"]');
        const formRoot = document.querySelector('[data-component="form-root"]');

        const setLoadingState = (activeProvider) => {
            formRoot.setAttribute('data-disabled', 'true');

            buttons.forEach(button => {
                button.style.pointerEvents = 'none';

                const provider = button.id.replace('button-', '');
                if (provider === activeProvider) {
                    button.setAttribute('data-loading', 'true');
                }
            });
        };

        const resetState = () => {
            formRoot.removeAttribute('data-disabled');

            buttons.forEach(button => {
                button.style.pointerEvents = '';
                button.removeAttribute('data-loading');
            });
        };
        
        buttons.forEach(button => {
            const provider = button.id.replace('button-', '');

            if (provider === "password"){
                button.addEventListener('click', async (e) => {
                    window.location.href = window.location.origin + "/" + provider + "/authorize";
                })
            } else {
                button.addEventListener('click', async (e) => {
                    try {
                         setLoadingState(provider);
                         await openAuthWindow(provider);
                    } catch (error) {
                        resetState();
                        console.error(\`Authentication failed for \${provider}:\`, error);
                    } 
                    //     finally {
                    //     resetState();
                    //  }
                }); 
            }
        });`;

    const callbackScript = `
        if (window.opener == null) {
            window.location.href = "about:blank";
        }

        const searchParams = window.location.search;

        try {
            window.opener.postMessage(
                JSON.stringify({
                    type: 'auth_success',
                    searchParams: searchParams
                }), 
                window.location.origin
            );
        } catch (e) {
            console.error('Failed to send message to parent window:', e);
        }`;
    return (
        <html
            style={{
                "--color-background-light": get("background", "light"),
                "--color-background-dark": get("background", "dark"),
                "--color-primary-light": get("primary", "light"),
                "--color-primary-dark": get("primary", "dark"),
                "--font-family": theme?.font?.family,
                "--font-scale": theme?.font?.scale,
                "--border-radius": radius,
                backgroundColor: get("background", "dark"),
            }}
        >
            <head>
                <meta charset="utf-8" />
                <title>{theme?.title || "OpenAuthJS"}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <link rel="icon" href={theme?.favicon} />
                <style dangerouslySetInnerHTML={{ __html: css() }} />
                {theme?.css && (
                    <style dangerouslySetInnerHTML={{ __html: theme.css }} />
                )}
            </head>
            <body>
                <div data-component="root">
                    <main data-component="center" data-size={props.size}>
                        {props.children}
                    </main>
                    <section data-component="logo-footer" >
                        <svg viewBox="0 0 498.05 70.508" xmlns="http://www.w3.org/2000/svg" height={157} width={695} >
                            <g stroke-linecap="round" fill-rule="evenodd" font-size="9pt" stroke="currentColor" stroke-width="0.25mm" fill="currentColor" style="stroke:currentColor;stroke-width:0.25mm;fill:currentColor">
                                <path
                                    fill="url(#paint1)"
                                    pathLength="1"
                                    stroke="url(#paint1)"
                                    d="M 261.23 41.65 L 212.402 41.65 Q 195.313 41.65 195.313 27.002 L 195.313 14.795 A 17.814 17.814 0 0 1 196.311 8.57 Q 199.443 0.146 212.402 0.146 L 283.203 0.146 L 283.203 14.844 L 217.236 14.844 Q 215.337 14.844 214.945 16.383 A 3.67 3.67 0 0 0 214.844 17.285 L 214.844 24.561 Q 214.844 27.002 217.236 27.002 L 266.113 27.002 Q 283.203 27.002 283.203 41.65 L 283.203 53.857 A 17.814 17.814 0 0 1 282.205 60.083 Q 279.073 68.506 266.113 68.506 L 195.313 68.506 L 195.313 53.809 L 261.23 53.809 A 3.515 3.515 0 0 0 262.197 53.688 Q 263.672 53.265 263.672 51.367 L 263.672 44.092 A 3.515 3.515 0 0 0 263.551 43.126 Q 263.128 41.65 261.23 41.65 Z M 185.547 53.906 L 185.547 68.506 L 114.746 68.506 Q 97.656 68.506 97.656 53.857 L 97.656 14.795 A 17.814 17.814 0 0 1 98.655 8.57 Q 101.787 0.146 114.746 0.146 L 168.457 0.146 Q 185.547 0.146 185.547 14.795 L 185.547 31.885 A 17.827 17.827 0 0 1 184.544 38.124 Q 181.621 45.972 170.174 46.538 A 36.906 36.906 0 0 1 168.457 46.582 L 117.188 46.582 L 117.236 51.465 Q 117.236 53.906 119.629 53.955 L 185.547 53.906 Z M 19.531 14.795 L 19.531 68.506 L 0 68.506 L 0 0.146 L 70.801 0.146 Q 87.891 0.146 87.891 14.795 L 87.891 68.506 L 68.359 68.506 L 68.359 17.236 Q 68.359 14.795 65.967 14.795 L 19.531 14.795 Z M 449.219 68.506 L 430.176 46.533 L 400.391 46.533 L 400.391 68.506 L 380.859 68.506 L 380.859 0.146 L 451.66 0.146 A 24.602 24.602 0 0 1 458.423 0.994 Q 466.007 3.166 468.021 10.907 A 25.178 25.178 0 0 1 468.75 17.236 L 468.75 31.885 A 18.217 18.217 0 0 1 467.887 37.73 Q 465.954 43.444 459.698 45.455 A 23.245 23.245 0 0 1 454.492 46.436 L 473.633 68.506 L 449.219 68.506 Z M 292.969 0 L 371.094 0.098 L 371.094 14.795 L 341.846 14.795 L 341.846 68.506 L 322.266 68.506 L 322.217 14.795 L 292.969 14.844 L 292.969 0 Z M 478.516 0.146 L 498.047 0.146 L 498.047 68.506 L 478.516 68.506 L 478.516 0.146 Z M 400.391 14.844 L 400.391 31.885 L 446.826 31.885 Q 448.726 31.885 449.117 30.345 A 3.67 3.67 0 0 0 449.219 29.443 L 449.219 17.285 Q 449.219 14.844 446.826 14.844 L 400.391 14.844 Z M 117.188 31.836 L 163.574 31.934 Q 165.528 31.895 165.918 30.355 A 3.514 3.514 0 0 0 166.016 29.492 L 166.016 17.236 Q 166.016 15.337 164.476 14.945 A 3.67 3.67 0 0 0 163.574 14.844 L 119.629 14.795 Q 117.188 14.795 117.188 17.188 L 117.188 31.836 Z" />
                            </g>
                            <defs>
                                <linearGradient gradientUnits="userSpaceOnUse" id="paint1" x1="317.5" x2="314.007" y1="-51.5" y2="126">
                                    <stop stop-color="white"></stop>
                                    <stop offset="1" stop-opacity="0"></stop>
                                </linearGradient>
                            </defs>
                        </svg>
                    </section>
                </div>
                {props.page === "password" && (
                    <script dangerouslySetInnerHTML={{ __html: script }} />
                )}
                {props.page === "root" && (
                    <script dangerouslySetInnerHTML={{ __html: authWindowScript }} />
                )}
                {props.page === "popup" && (
                    <script dangerouslySetInnerHTML={{ __html: callbackScript }} />
                )}
            </body>
        </html>
    )
}
