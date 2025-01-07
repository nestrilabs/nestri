export function css() {
  return `
@import url("https://unpkg.com/tailwindcss@3.4.15/src/css/preflight.css");

:root {
  --color-background-dark: #0e0e11;
  --color-background-light: #ffffff;
  --color-primary-dark: #6772e5;
  --color-primary-light: #6772e5;
  --border-radius: 0;

  --color-background: var(--color-background-dark);
  --color-primary: var(--color-primary-dark);

  --spinner-size: 16px;
  --spinner-color: #FFF;

  @media (prefers-color-scheme: light) {
    --color-background: var(--color-background-light);
    --color-primary: var(--color-primary-light);
  }

  --color-high: oklch(
    from var(--color-background) clamp(0, calc((l - 0.714) * -1000), 1) 0 0
  );
  --color-low: oklch(from var(--color-background) clamp(0, calc((l - 0.714) * 1000), 1) 0 0);
  --lightness-high: color-mix(
    in oklch,
    var(--color-high) 0%,
    oklch(var(--color-high) 0 0)
  );
  --lightness-low: color-mix(
    in oklch,
    var(--color-low) 0%,
    oklch(var(--color-low) 0 0)
  );
  --font-family: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji",
    "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  --font-scale: 1;

  --font-size-xs: calc(0.75rem * var(--font-scale));
  --font-size-sm: calc(0.875rem * var(--font-scale));
  --font-size-md: calc(1rem * var(--font-scale));
  --font-size-lg: calc(1.125rem * var(--font-scale));
  --font-size-xl: calc(1.25rem * var(--font-scale));
  --font-size-2xl: calc(1.5rem * var(--font-scale));
}

html, html * {
 margin: 0;
 padding: 0;
}

[data-component="root"] {
  font-family: var(--font-family);
  background-color: var(--color-background);
  padding: 1rem 1rem 0;
  color: white;
  position: relative;
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  flex-direction: column;
  user-select: none;
  color: var(--color-high);
}

 [data-component="logo-footer"] {
    position: fixed;
    bottom: -1px;
    font-size: 100%;
    max-width: 1440px;
    width: 100%;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
    z-index: 10;
    overflow: hidden;

    & > svg {
        width: 100%;
        height: 100%;
        transform: translateY(40%);
        opacity: 70%;
    }
 }

[data-component="popup"] {
  display: flex;
  width: 100%;
  height: 100%;
  gap: 5px;
  justify-content: center;
  align-items: center;
  font-size: 1.3rem;
  line-height: 1rem;
  font-weight: 500;

  & [data-component="spinner"]{
    --spinner-size: 24px;
    display: block;
  }
}

[data-component="center"] {
  max-width: 380px;
  width: 100%;
  height: 100%;
  justify-content: center;
  display: flex;
  padding: 0 0 120px 0;
  flex-direction: column;
  gap: 1rem;

  &[data-size="small"] {
    width: 300px;
  }
}

[data-component="link"] {
  text-decoration: underline;
  font-weight: 600;
}

[data-component="label"] {
  display: flex;
  gap: 0.75rem;
  flex-direction: column;
  font-size: var(--font-size-xs);
}

[data-component="input"] {
  width: 100%;
  height: 2.5rem;
  padding: 0 1rem;
  padding-left: 36px;
  border: 1px solid transparent;
  --background: oklch(
    from var(--color-background) calc(l + (-0.06 * clamp(0, calc((l - 0.714) * 1000), 1) + 0.03)) c h
  );
  background: var(--background);
  border-color: #343434;
  border-radius: calc(var(--border-radius) * 0.25rem);
  font-size: 0.875rem;
  outline: none;

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px #161616,0 0 0 4px #707070
  }

 &:user-invalid:focus {
    box-shadow: 0 0 0 2px #161616,0 0 0 4px  #ff6369;
  }

  &:user-invalid:not(:focus) {
    border-color: #ff6369;
  }

  @media (prefers-color-scheme: light) {
    border-color: #e2e2e2;
    color: #171717;
    
    &:focus {
        outline: none;
        box-shadow: 0 0 0 2px #fcfcfc,0 0 0 4px #8f8f8f;
     }

    &:user-invalid:focus {
        box-shadow: 0 0 0 2px #fcfcfc, 0 0 0 4px  #cd2b31;
    }

    &:user-invalid:not(:focus) {
        border-color: #cd2b31;
    }
  }
}

[data-component="button"] {
  height: 2.5rem;
  cursor: pointer;
  margin-top: 3px;
  font-weight: 500;
  font-size: var(--font-size-sm);
  border-radius: calc(var(--border-radius) * 0.25rem);
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: center;
  background: var(--color-primary);
  color: oklch(from var(--color-primary) clamp(0, calc((l - 0.714) * -1000), 1) 0 0);

  &[data-color="ghost"] {
    background: transparent;
    color: var(--color-high);
    border: 1px solid
      oklch(
        from var(--color-background)
          calc(clamp(0.22, l + (-0.12 * clamp(0, calc((l - 0.714) * 1000), 1) + 0.06), 0.88)) c h
      );
  }
    
  &:focus [data-component="spinner"]{
    display: block;
  }

  [data-slot="icon"] {
    width: 16px;
    height: 16px;

    svg {
      width: 100%;
      height: 100%;
    }
  }
}

[data-component="button-root"] {
  transition-property: border-color,background,color,transform,box-shadow;
  transition-duration: .15s;
  transition-timing-function: ease;
  height: 48px;
  cursor: pointer;
  padding: 0px 14px;
  margin-top: 3px;
  font-weight: 500;
  font-size: 16px;
  border-radius: 8px;
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 2px solid #00000014;
   --spinner-color: #000;

  @media (prefers-color-scheme: dark) {
        border: 2px solid #ffffff24;
        --spinner-color: #FFF;
    }

  &[data-color="github"] {
    background: #24292e;
    color: #fff;
    border: 2px solid #1B1F22;
    &:hover {
      background: #434D56;
      border: 1px solid transparent;
    }
     @media (prefers-color-scheme: dark) {
        border: 1px solid transparent;
        background: #434D56;
        &:hover {
          background: #24292e;
        }
    }
  }
  
  &[data-color="discord"] {
    background: #4445e7;
    border: 2px solid #3836cc;
    color: #fff;
    &:hover {
      background: #5865F2;
      border: 1px solid transparent;
    }
    @media (prefers-color-scheme: dark) {
        border: 1px solid transparent;
        background: #5865F2;
        &:hover {
          background: #4445e7;
        }
    }
  }

  &:hover {
      background:rgb(229, 229, 229);
  }

  @media (prefers-color-scheme: dark) {
    &:hover {
      background:rgb(38, 38,38);
    }
  }

  [data-slot="icon"] {
    width: 20px;
    height: 20px;

    svg {
      width: 100%;
      height: 100%;
    }
  }
}

[data-component="form"] {
  max-width: 100%;
  display: flex;
  flex-direction: column;
  margin: 0;
}

[data-loading="true"]{
  & [data-component="spinner"]{
      display: block;
  }

  & [data-slot="icon"] {
    display: none;
  }
}

[data-disabled="true"] { 
   & button {
     background: rgb(229,229,229) !important;
     border: 2px solid #00000014 !important;
     opacity: .7 !important;
     color: inherit !important;
     cursor: not-allowed !important;
      @media (prefers-color-scheme: dark) {
        background: rgb(38, 38,38) !important;
        border: 2px solid #ffffff24 !important;
      }
  }
}

[data-component="form-root"] {
  max-width: 100%;
  display: flex;
  flex-direction: column;
  margin: 0;
  gap: 12px;
}

[data-component="form-header"] {
  display: flex;
  gap: 0.75rem;
  align-items: start;
  justify-content: center;
  flex-direction: column;
  color: #a0a0a0;
  max-width: 400px;
  font-weight: 400;
  font-size: 0.875rem;
  line-height: 1.25rem;

  @media (prefers-color-scheme: light) {
     color: #6f6f6f
  }

  & > hr {
    border:0;
    background: #282828;
    height:2px;
    width:100%;
    margin-top:4px;

    @media (prefers-color-scheme: light) {
      background: #e8e8e8
    }
 }

 & > h1 {
    color: #ededed;
    font-weight:500;
    font-size: 1.25rem;
    letter-spacing:-.020625rem;
    line-height:1.5rem;
    margin:0;
    overflow-wrap:break-word;

    @media (prefers-color-scheme: light) {
      color: #171717
    }
  }
}

[data-component="form-header-root"] {
  color: #FFF;
  max-width: 400px;
  font-weight: 700;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 2rem;
  line-height: 2.5rem;
  letter-spacing: -0.049375rem;

  @media (prefers-color-scheme: light) {
     color: #000
  }

  // & > hr {
  //   border:0;
  //   background: #282828;
  //   height:2px;
  //   width:100%;
  //   margin-top:4px;

  //   @media (prefers-color-scheme: light) {
  //     background: #e8e8e8
  //   }
  // }
}
    
[data-component="input-container"] {
  display: flex;
  gap: 0.5rem;
  align-items: start;
  justify-content: center;
  flex-direction: column;
  color: #a0a0a0;
  max-width: 400px;
  font-weight: 400px;
  font-size: 0.875rem;
  line-height: 1.25rem;
  
  @media (prefers-color-scheme: light) {
     color: #6f6f6f
  }

 & > small {
   color: #ff6369;
   display: block;
   line-height: 1rem;
   font-weight: 400;
   font-size: 0.75rem;

    @media (prefers-color-scheme: light) {
        color: #cd2b31;
    }
 }
}

[data-error="true"] {
 & input {
     border-color: #ff6369;
    &:focus {
        box-shadow: 0 0 0 2px #161616,0 0 0 4px  #ff6369;
        border-color: transparent;
    }

    @media (prefers-color-scheme: light) {
        border-color: #cd2b31;
        :focus {
            box-shadow: 0 0 0 2px #fcfcfc, 0 0 0 4px  #cd2b31;
            border-color: transparent;
        }
    }
 }
}

[data-component="input-wrapper"] {
  position: relative;
  width:100%;
}
  
[data-component="input-icon"] {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  left: 8px;
  width: 20px;
  height: 40px;
  display: flex;
  justify-content: center;
  align-items: center;
  pointer-events: none;

  & > svg {
        width:20px;
        height:20px;
        display:block;
        max-width:100%;
    }
}

input:-webkit-autofill,
  input:-webkit-autofill:focus {
    transition: background-color 0s 600000s, color 0s 600000s !important;
}


[data-component="spinner"] {
    height: var(--spinner-size,20px);
    width: var(--spinner-size,20px);
    margin-left: calc(var(--spinner-size,20px)*-1px);
    display: none;

    & > div {
        position: relative;
        top: 50%;
        left: 50%;
        height: var(--spinner-size,20px);
        width: var(--spinner-size,20px);
    }
    
    & > div > div {
        animation: spin 1.2s linear infinite;
        background: var(--spinner-color);
        border-radius: 9999px;
        height: 8%;
        left: -10%;
        position: absolute;
        top: -3.9%;
        width: 24%;
    }

    & > div > div:first-child {
        animation-delay: -1.2s;
        transform: rotate(.0001deg) translate(146%);
    }
    
    & > div > div:nth-child(2) {
        animation-delay: -1.1s;
        transform: rotate(30deg) translate(146%);
    }

   & > div > div:nth-child(3) {
        animation-delay: -1s;
        transform: rotate(60deg) translate(146%);
    }

    & > div > div:nth-child(4) {
        animation-delay: -.9s;
        transform: rotate(90deg) translate(146%);
    }

   & > div > div:nth-child(5) {
        animation-delay: -.8s;
        transform: rotate(120deg) translate(146%);
    }

   & > div > div:nth-child(6) {
        animation-delay: -.7s;
        transform: rotate(150deg) translate(146%);
    }
    
    & > div > div:nth-child(7) {
        animation-delay: -.6s;
        transform: rotate(180deg) translate(146%);
    }

    & > div > div:nth-child(8) {
        animation-delay: -.5s;
        transform: rotate(210deg) translate(146%);
    }
        
    & > div > div:nth-child(9) {
        animation-delay: -.4s;
        transform: rotate(240deg) translate(146%);
    }
    
    & > div > div:nth-child(10) {
        animation-delay: -.3s;
        transform: rotate(270deg) translate(146%);
    }
        
    & > div > div:nth-child(11) {
        animation-delay: -.2s;
        transform: rotate(300deg) translate(146%);
    }
        
    & > div > div:nth-child(12) {
        animation-delay: -.1s;
        transform: rotate(330deg) translate(146%);
    }
}

@keyframes spin {
0% {
    opacity: 1;
}

100% {
    opacity: .15;
}

}

    `
}